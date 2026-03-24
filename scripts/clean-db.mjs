import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dbPath = path.join(projectRoot, "pharmacy.db");
const dryRun = process.argv.includes("--dry-run");

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

  return path.join(projectRoot, `pharmacy.db.pre_clean_db_${timestamp}.bak`);
}

function getDuplicatePlan(database) {
  const rows = database
    .prepare(
      `
      SELECT
        c.id,
        TRIM(c.name) AS name,
        c.age,
        COUNT(f.id) AS followup_count,
        MAX(f.date) AS latest_followup_date
      FROM clients c
      LEFT JOIN followups f ON f.client_id = c.id
      GROUP BY c.id, TRIM(c.name), c.age
      ORDER BY c.id
      `
    )
    .all();

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.name}||${row.age}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  const keepIds = [];
  const deleteIds = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      continue;
    }

    group.sort((a, b) => {
      const aDate = a.latest_followup_date || "";
      const bDate = b.latest_followup_date || "";
      if (aDate !== bDate) {
        return bDate.localeCompare(aDate);
      }

      if (a.followup_count !== b.followup_count) {
        return b.followup_count - a.followup_count;
      }

      return a.id - b.id;
    });

    keepIds.push(group[0].id);
    deleteIds.push(...group.slice(1).map((row) => row.id));
  }

  return { keepIds, deleteIds };
}

function getFollowupNoteStats(database) {
  const rows = database
    .prepare(
      `
      SELECT id, notes
      FROM followups
      WHERE notes IS NOT NULL AND TRIM(notes) <> ''
      `
    )
    .all();

  const onlyNumber = /^\d+(?:\.\d+)?$/;
  const numberPipeNumber = /^\d+(?:\.\d+)?\s*\|\s*\d+(?:\.\d+)?$/;
  const numberPipeText = /^\d+(?:\.\d+)?\s*\|\s*(.+)$/;
  const textPipeNumber = /^(.+?)\s*\|\s*\d+(?:\.\d+)?$/;

  let pureNumberCount = 0;
  let numberPipeNumberCount = 0;
  let numberPipeTextCount = 0;
  let textPipeNumberCount = 0;

  for (const row of rows) {
    const note = String(row.notes).trim();

    if (onlyNumber.test(note)) {
      pureNumberCount += 1;
      continue;
    }

    if (numberPipeNumber.test(note)) {
      numberPipeNumberCount += 1;
      continue;
    }

    if (numberPipeText.test(note)) {
      numberPipeTextCount += 1;
      continue;
    }

    if (textPipeNumber.test(note)) {
      textPipeNumberCount += 1;
    }
  }

  return {
    pureNumberCount,
    numberPipeNumberCount,
    numberPipeTextCount,
    textPipeNumberCount,
  };
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const duplicatePlan = getDuplicatePlan(db);
const duplicateFollowupCount =
  duplicatePlan.deleteIds.length > 0
    ? db
        .prepare(
          `SELECT COUNT(*) AS count FROM followups WHERE client_id IN (${duplicatePlan.deleteIds
            .map(() => "?")
            .join(",")})`
        )
        .get(...duplicatePlan.deleteIds).count
    : 0;

const weightLossChronicBefore = db
  .prepare(
    `
    SELECT COUNT(*) AS count
    FROM clients
    WHERE program_type = 'Weight Loss'
      AND COALESCE(TRIM(chronic_diseases), '') <> ''
    `
  )
  .get().count;

const noteStats = getFollowupNoteStats(db);

if (dryRun) {
  const remainingDuplicateGroups = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM (
        SELECT TRIM(name) AS name, age
        FROM clients
        GROUP BY TRIM(name), age
        HAVING COUNT(*) > 1
      )
      `
    )
    .get().count;

  const totals = {
    clients: db.prepare("SELECT COUNT(*) AS count FROM clients").get().count,
    followups: db.prepare("SELECT COUNT(*) AS count FROM followups").get().count,
  };

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        backupCreated: false,
        duplicateClientsToDelete: duplicatePlan.deleteIds.length,
        duplicateFollowupsToDelete: duplicateFollowupCount,
        weightLossChronicToClear: weightLossChronicBefore,
        pureNumberNotesToClear: noteStats.pureNumberCount,
        numberPipeNumberNotesToClear: noteStats.numberPipeNumberCount,
        numberPipeTextNotesToTrim: noteStats.numberPipeTextCount,
        textPipeNumberNotesToTrim: noteStats.textPipeNumberCount,
        remainingDuplicateGroups,
        totals,
      },
      null,
      2
    )
  );
  process.exit(0);
}

const backupPath = buildBackupPath();
db.pragma("wal_checkpoint(FULL)");
fs.copyFileSync(dbPath, backupPath);

const updateNote = db.prepare("UPDATE followups SET notes = ? WHERE id = ?");
const deleteFollowups = db.prepare("DELETE FROM followups WHERE client_id = ?");
const deleteClient = db.prepare("DELETE FROM clients WHERE id = ?");

const cleanTx = db.transaction(() => {
  let deletedClients = 0;
  let deletedFollowups = 0;
  let clearedWeightLossChronic = 0;
  let clearedPureNumberNotes = 0;
  let clearedNumberPipeNumberNotes = 0;
  let trimmedNumberPipeTextNotes = 0;
  let trimmedTextPipeNumberNotes = 0;

  const rows = db
    .prepare(
      `
      SELECT id, notes
      FROM followups
      WHERE notes IS NOT NULL AND TRIM(notes) <> ''
      `
    )
    .all();

  const onlyNumber = /^\d+(?:\.\d+)?$/;
  const numberPipeNumber = /^\d+(?:\.\d+)?\s*\|\s*\d+(?:\.\d+)?$/;
  const numberPipeText = /^\d+(?:\.\d+)?\s*\|\s*(.+)$/;
  const textPipeNumber = /^(.+?)\s*\|\s*\d+(?:\.\d+)?$/;

  for (const row of rows) {
    const note = String(row.notes).trim();

    if (onlyNumber.test(note)) {
      updateNote.run(null, row.id);
      clearedPureNumberNotes += 1;
      continue;
    }

    if (numberPipeNumber.test(note)) {
      updateNote.run(null, row.id);
      clearedNumberPipeNumberNotes += 1;
      continue;
    }

    const prefixMatch = note.match(numberPipeText);
    if (prefixMatch) {
      const remaining = prefixMatch[1].trim();
      updateNote.run(remaining || null, row.id);
      trimmedNumberPipeTextNotes += 1;
      continue;
    }

    const suffixMatch = note.match(textPipeNumber);
    if (suffixMatch) {
      const remaining = suffixMatch[1].trim();
      updateNote.run(remaining || null, row.id);
      trimmedTextPipeNumberNotes += 1;
    }
  }

  clearedWeightLossChronic = db
    .prepare("UPDATE clients SET chronic_diseases = NULL WHERE program_type = 'Weight Loss'")
    .run().changes;

  for (const clientId of duplicatePlan.deleteIds) {
    deletedFollowups += deleteFollowups.run(clientId).changes;
    deletedClients += deleteClient.run(clientId).changes;
  }

  return {
    deletedClients,
    deletedFollowups,
    clearedWeightLossChronic,
    clearedPureNumberNotes,
    clearedNumberPipeNumberNotes,
    trimmedNumberPipeTextNotes,
    trimmedTextPipeNumberNotes,
  };
});

const result = cleanTx();

const remainingDuplicateGroups = db
  .prepare(
    `
    SELECT COUNT(*) AS count
    FROM (
      SELECT TRIM(name) AS name, age
      FROM clients
      GROUP BY TRIM(name), age
      HAVING COUNT(*) > 1
    )
    `
  )
  .get().count;

const remainingWeightLossChronic = db
  .prepare(
    `
    SELECT COUNT(*) AS count
    FROM clients
    WHERE program_type = 'Weight Loss'
      AND COALESCE(TRIM(chronic_diseases), '') <> ''
    `
  )
  .get().count;

const totals = {
  clients: db.prepare("SELECT COUNT(*) AS count FROM clients").get().count,
  followups: db.prepare("SELECT COUNT(*) AS count FROM followups").get().count,
};

console.log(
  JSON.stringify(
    {
      dryRun: false,
      backupCreated: true,
      backupPath,
      deletedDuplicateClients: result.deletedClients,
      deletedDuplicateFollowups: result.deletedFollowups,
      clearedWeightLossChronic,
      clearedPureNumberNotes: result.clearedPureNumberNotes,
      clearedNumberPipeNumberNotes: result.clearedNumberPipeNumberNotes,
      trimmedNumberPipeTextNotes: result.trimmedNumberPipeTextNotes,
      trimmedTextPipeNumberNotes: result.trimmedTextPipeNumberNotes,
      remainingDuplicateGroups,
      remainingWeightLossChronic,
      totals,
    },
    null,
    2
  )
);
