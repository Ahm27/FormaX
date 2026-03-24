import Database from "better-sqlite3";
import fs from "fs";

const taskFilePath = process.argv[2];

if (!taskFilePath || !fs.existsSync(taskFilePath)) {
  process.stderr.write("Cleanup task file not found.");
  process.exit(1);
}

const rawTask = fs.readFileSync(taskFilePath, "utf8");
const task = JSON.parse(rawTask);
const db = new Database(task.dbPath);

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
    return null;
  }

  const text = normalizeArabicDigits(value).trim();
  return text === "" ? null : text;
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

function normalizeClientName(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(text)) {
    return null;
  }

  return text.replace(/\s+/g, " ").trim();
}

function normalizeChronicDiseaseImport(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(text)) {
    return null;
  }

  return text;
}

function normalizeMedicineDisplay(value) {
  const text = normalizeText(value);

  if (!text) {
    return "None";
  }

  if (/^x{5,}$/i.test(text)) {
    return "None";
  }

  return text;
}

function normalizeFollowupNotes(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const normalized = normalizeArabicDigits(text).replace(/\s+/g, " ").trim();
  if (/^\d+\s*\|\s*\d+$/.test(normalized)) {
    return null;
  }

  return text;
}

function buildComparableFollowupEntry(followup) {
  return {
    date: normalizeText(followup.date) ?? "",
    weight: normalizeComparableNumber(followup.weight),
    treatment: normalizeComparableText(
      normalizeMedicineDisplay(
        followup.treatment ?? followup.medicine_name ?? followup.medicine_taken
      )
    ),
  };
}

function buildComparableFollowupSignature(followups) {
  return [...followups]
    .map((followup) => buildComparableFollowupEntry(followup))
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

function buildLegacyClientSignature(clientPayload, followups) {
  return [
    normalizeComparableText(clientPayload.name),
    String(toNumber(clientPayload.age) ?? ""),
    normalizeComparableText(clientPayload.program_type),
    buildComparableFollowupSignature(followups),
  ].join("::");
}

function runCleanup(taskPayload) {
  const clientIds = taskPayload.all
    ? db.prepare("SELECT id FROM clients").all().map((row) => row.id)
    : Array.from(taskPayload.clientIds ?? []);
  const followupIds = taskPayload.all
    ? db.prepare("SELECT id FROM followups").all().map((row) => row.id)
    : Array.from(taskPayload.followupIds ?? []);

  if (clientIds.length > 0) {
    const clientRows = db
      .prepare(
        `SELECT id, name, chronic_diseases FROM clients WHERE id IN (${clientIds.map(() => "?").join(",")})`
      )
      .all(...clientIds);

    const updateClient = db.prepare(
      `
      UPDATE clients
      SET name = ?, chronic_diseases = ?
      WHERE id = ?
      `
    );
    const deleteClient = db.prepare("DELETE FROM clients WHERE id = ?");

    for (const client of clientRows) {
      const normalizedName = normalizeClientName(client.name);
      if (!normalizedName) {
        deleteClient.run(client.id);
        continue;
      }

      updateClient.run(
        normalizedName,
        normalizeChronicDiseaseImport(client.chronic_diseases),
        client.id
      );
    }
  }

  if (followupIds.length > 0) {
    const followupRows = db
      .prepare(
        `SELECT id, medicine_name, medicine_taken, notes FROM followups WHERE id IN (${followupIds.map(() => "?").join(",")})`
      )
      .all(...followupIds);

    const updateFollowup = db.prepare(
      `
      UPDATE followups
      SET medicine_name = ?, notes = ?
      WHERE id = ?
      `
    );

    for (const followup of followupRows) {
      const normalizedMedicine = normalizeMedicineDisplay(
        followup.medicine_name ?? followup.medicine_taken
      );
      updateFollowup.run(
        normalizedMedicine === "None" ? null : normalizedMedicine,
        normalizeFollowupNotes(followup.notes),
        followup.id
      );
    }
  }

  let deletedDuplicates = 0;
  if (taskPayload.dedupeImportedClients && clientIds.length > 0) {
    const importedClientIdSet = new Set(clientIds);
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
        SELECT client_id, date, weight, COALESCE(medicine_name, medicine_taken) AS treatment
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
    const deleteClient = db.prepare("DELETE FROM clients WHERE id = ?");

    for (const client of clients) {
      const clientFollowups = followupsByClientId.get(client.id) ?? [];
      const signature = buildLegacyClientSignature(client, clientFollowups);
      const ownerId = signatureOwners.get(signature);

      if (!ownerId) {
        signatureOwners.set(signature, client.id);
        continue;
      }

      if (importedClientIdSet.has(client.id)) {
        deleteClient.run(client.id);
        deletedDuplicates += 1;
      }
    }
  }

  db.pragma("wal_checkpoint(PASSIVE)");

  return {
    cleanedClients: clientIds.length,
    cleanedFollowups: followupIds.length,
    deletedDuplicates,
  };
}

try {
  const result = runCleanup(task);
  process.stdout.write(JSON.stringify(result));
  fs.unlinkSync(taskFilePath);
  process.exit(0);
} catch (error) {
  try {
    fs.unlinkSync(taskFilePath);
  } catch {}
  process.stderr.write(error instanceof Error ? error.message : "Cleanup worker failed.");
  process.exit(1);
}
