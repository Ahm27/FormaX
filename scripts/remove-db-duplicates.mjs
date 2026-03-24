import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.join(projectRoot, "pharmacy.db");

const dryRun = process.argv.includes("--dry-run");

const arabicDigitMap = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function normalizeArabicDigits(value) {
  return String(value).replace(/[٠-٩۰-۹]/g, (digit) => arabicDigitMap[digit] ?? digit);
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = normalizeArabicDigits(value).trim();
  return text === "" ? "" : text;
}

function normalizeComparableText(value) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(normalizeArabicDigits(value));
  return Number.isFinite(number) ? number : null;
}

function normalizeComparableNumber(value) {
  const number = toNumber(value);
  return number === null ? "" : number.toFixed(2);
}

function normalizeMedicineDisplay(value) {
  const text = normalizeText(value);

  if (!text || /^x{5,}$/i.test(text)) {
    return "None";
  }

  return text;
}

function buildComparableFollowupEntry(followup) {
  const treatment = normalizeComparableText(
    normalizeMedicineDisplay(followup.treatment ?? followup.medicine_name ?? followup.medicine_taken)
  );

  return {
    date: normalizeText(followup.date),
    weight: normalizeComparableNumber(followup.weight),
    treatment,
  };
}

function buildComparableFollowupSignature(followups) {
  return [...followups]
    .map(buildComparableFollowupEntry)
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      const weightCompare = left.weight.localeCompare(right.weight);
      if (weightCompare !== 0) {
        return weightCompare;
      }

      return left.treatment.localeCompare(right.treatment);
    })
    .map((followup) => `${followup.date}|${followup.weight}|${followup.treatment}`)
    .join("||");
}

function buildClientDuplicateSignature(client, followups) {
  return [
    normalizeComparableText(client.name),
    String(toNumber(client.age) ?? ""),
    normalizeComparableText(client.program_type),
    buildComparableFollowupSignature(followups),
  ].join("::");
}

function buildBackupPath() {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return path.join(projectRoot, `pharmacy.db.pre_remove_duplicates_${timestamp}.bak`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const clients = db
  .prepare(
    `
    SELECT id, name, age, program_type
    FROM clients
    ORDER BY id ASC
    `
  )
  .all();

const followups = db
  .prepare(
    `
    SELECT
      id,
      client_id,
      date,
      weight,
      COALESCE(medicine_name, medicine_taken) AS treatment
    FROM followups
    ORDER BY client_id ASC, date ASC, id ASC
    `
  )
  .all();

const followupsByClientId = new Map();
for (const followup of followups) {
  if (!followupsByClientId.has(followup.client_id)) {
    followupsByClientId.set(followup.client_id, []);
  }

  followupsByClientId.get(followup.client_id).push(followup);
}

const signatureOwners = new Map();
const duplicateClientIds = [];

for (const client of clients) {
  const signature = buildClientDuplicateSignature(
    client,
    followupsByClientId.get(client.id) ?? []
  );
  const ownerId = signatureOwners.get(signature);

  if (!ownerId) {
    signatureOwners.set(signature, client.id);
    continue;
  }

  duplicateClientIds.push(client.id);
}

if (duplicateClientIds.length === 0) {
  console.log(
    JSON.stringify({
      dryRun,
      backupCreated: false,
      deletedClients: 0,
      deletedFollowups: 0,
      message: "No exact duplicate client groups were found.",
    })
  );
  process.exit(0);
}

if (dryRun) {
  const followupCount = db
    .prepare(
      `SELECT COUNT(*) AS count FROM followups WHERE client_id IN (${duplicateClientIds
        .map(() => "?")
        .join(",")})`
    )
    .get(...duplicateClientIds).count;

  console.log(
    JSON.stringify({
      dryRun: true,
      backupCreated: false,
      deletedClients: duplicateClientIds.length,
      deletedFollowups: followupCount,
      duplicateClientIds,
    })
  );
  process.exit(0);
}

const backupPath = buildBackupPath();
db.pragma("wal_checkpoint(FULL)");
fs.copyFileSync(dbPath, backupPath);

const deleteDuplicates = db.transaction((ids) => {
  const deleteClient = db.prepare("DELETE FROM clients WHERE id = ?");
  let deletedClients = 0;
  let deletedFollowups = 0;

  for (const clientId of ids) {
    deletedFollowups +=
      db.prepare("SELECT COUNT(*) AS count FROM followups WHERE client_id = ?").get(clientId).count;
    deletedClients += deleteClient.run(clientId).changes;
  }

  return { deletedClients, deletedFollowups };
});

const result = deleteDuplicates(duplicateClientIds);

console.log(
  JSON.stringify({
    dryRun: false,
    backupCreated: true,
    backupPath,
    deletedClients: result.deletedClients,
    deletedFollowups: result.deletedFollowups,
    duplicateClientIds,
  })
);
