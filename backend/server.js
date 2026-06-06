import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const app = express();
const DEFAULT_PORT = Number(process.env.PORT || 3001);
const PROGRAM_TYPES = new Set(["Weight Loss", "Weight Gain"]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.env.PHARMACY_PROJECT_ROOT || path.resolve(__dirname, "..");
const runtimeDataRoot = process.env.PHARMACY_DATA_ROOT || projectRoot;
const scriptRoot = process.env.PHARMACY_SCRIPT_ROOT || projectRoot;
const dbPath = process.env.PHARMACY_DB_PATH || path.join(runtimeDataRoot, "pharmacy.db");
const backupDirectory = process.env.PHARMACY_BACKUP_DIR || path.join(runtimeDataRoot, "backups");
const cleanupJobsDirectory = process.env.PHARMACY_CLEANUP_DIR || path.join(runtimeDataRoot, "cleanup-jobs");
const syncDataDirectory = process.env.PHARMACY_SYNC_DIR || path.join(runtimeDataRoot, "sync-data");
const googleDriveStatePath = path.join(syncDataDirectory, "google-drive-state.json");
const localBackupSchedulePath = path.join(syncDataDirectory, "local-backup-schedule.json");
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_DRIVE_FOLDER_NAME = "Dr Sherin Pharmacy Sync";
const GOOGLE_DRIVE_FRONTEND_URL = process.env.GOOGLE_DRIVE_FRONTEND_URL || "http://localhost:5173";

function getActiveBackendPort() {
  return Number(process.env.PORT || DEFAULT_PORT);
}

app.use(
  cors({
    exposedHeaders: ["X-Total-Count", "X-Limit", "X-Offset", "Content-Disposition"],
  })
);
app.use(express.json({ limit: "25mb" }));

fs.mkdirSync(backupDirectory, { recursive: true });
fs.mkdirSync(cleanupJobsDirectory, { recursive: true });
fs.mkdirSync(syncDataDirectory, { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("temp_store = MEMORY");
db.pragma("cache_size = -64000");
db.pragma("mmap_size = 268435456");
db.pragma("busy_timeout = 5000");
db.pragma("optimize");

db.prepare(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  age INTEGER NOT NULL,
  phone TEXT,
  program_type TEXT NOT NULL,
  chronic_diseases TEXT,
  starting_weight REAL NOT NULL,
  target_weight REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  weight REAL NOT NULL,
  medicine_taken TEXT,
  medicine_name TEXT,
  adherence_status TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_clients_created_at
ON clients(created_at DESC, id DESC)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_clients_program_type
ON clients(program_type)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_clients_name_nocase
ON clients(name COLLATE NOCASE)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_clients_age_program_type
ON clients(age, program_type, id)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_clients_phone
ON clients(phone)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_followups_client_date_id
ON followups(client_id, date DESC, id DESC)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_followups_date
ON followups(date)
`).run();

db.prepare(`
CREATE INDEX IF NOT EXISTS idx_followups_created_at
ON followups(created_at DESC, id DESC)
`).run();

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

ensureColumn("clients", "target_weight", "REAL");
ensureColumn("followups", "medicine_name", "TEXT");
ensureColumn("followups", "adherence_status", "TEXT");
ensureColumn("followups", "created_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");

const clientSummaryCte = `
  WITH ranked_followups AS (
    SELECT
      f.client_id,
      f.date,
      f.weight,
      f.id,
      ROW_NUMBER() OVER (
        PARTITION BY f.client_id
        ORDER BY f.date DESC, f.id DESC
      ) AS rn
    FROM followups f
  ),
  latest_followups AS (
    SELECT
      client_id,
      date AS last_followup_date,
      weight AS current_weight
    FROM ranked_followups
    WHERE rn = 1
  ),
  earliest_followups AS (
    SELECT
      client_id,
      MIN(date) AS first_followup_date
    FROM followups
    GROUP BY client_id
  ),
  followup_stats AS (
    SELECT
      client_id,
      COUNT(*) AS followup_count
    FROM followups
    GROUP BY client_id
  )
`;

const clientListQuery = `
  ${clientSummaryCte}
  SELECT
    c.*,
    COUNT(*) OVER (PARTITION BY TRIM(c.name)) AS same_name_group_count,
    lf.current_weight,
    lf.last_followup_date,
    ef.first_followup_date,
    COALESCE(ef.first_followup_date || ' 00:00:00', c.created_at) AS effective_created_at,
    COALESCE(fs.followup_count, 0) AS followup_count
  FROM clients c
  LEFT JOIN latest_followups lf ON lf.client_id = c.id
  LEFT JOIN earliest_followups ef ON ef.client_id = c.id
  LEFT JOIN followup_stats fs ON fs.client_id = c.id
`;

const followupListBaseQuery = `
  SELECT
    f.id,
    f.client_id,
    f.date,
    f.weight,
    f.created_at,
    COALESCE(f.medicine_name, f.medicine_taken) AS medicine_name,
    COALESCE(f.adherence_status, f.medicine_taken, 'Yes') AS adherence_status,
    f.notes,
    c.name AS client_name,
    COUNT(*) OVER (PARTITION BY TRIM(c.name)) AS same_name_group_count,
    c.program_type,
    c.starting_weight,
    LAG(f.weight) OVER (
      PARTITION BY f.client_id
      ORDER BY f.date, f.id
    ) AS previous_weight
  FROM followups f
  INNER JOIN clients c ON c.id = f.client_id
`;

const analyticsCache = {
  dashboard: { expiresAt: 0, value: null },
  progress: { expiresAt: 0, value: null },
};
const analyticsDatasetCache = {
  expiresAt: 0,
  clients: null,
  followups: null,
};
const listQueryCache = {
  clients: new Map(),
  followups: new Map(),
};
const displayIdCache = {
  expiresAt: 0,
  clientMinId: 1,
  followupMinId: 1,
};
const systemInfoCache = {
  expiresAt: 0,
  value: null,
};
const systemLogs = [];

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

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(normalizeArabicDigits(value));
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = normalizeArabicDigits(value).trim();
  return text === "" ? null : text;
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

function normalizeComparableNumber(value) {
  const number = toNumber(value);
  return number === null ? "" : number.toFixed(2);
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

function logSystemEvent(action, status, details) {
  systemLogs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    status,
    details,
  });

  if (systemLogs.length > 50) {
    systemLogs.length = 50;
  }
}

function runImportCleanupTask(task) {
  const clientIds = Array.from(task.clientIds ?? []);
  const followupIds = Array.from(task.followupIds ?? []);

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

  if (task.dedupeImportedClients && clientIds.length > 0) {
    const importedClientIdSet = new Set(clientIds);
    const allClients = db.prepare(`${clientListQuery} ORDER BY c.id ASC`).all().map(getClientSummary);
    const signatureOwners = new Map();
    const deleteClient = db.prepare("DELETE FROM clients WHERE id = ?");
    let deletedDuplicates = 0;

    for (const client of allClients) {
      const clientFollowups = getFollowupsForClient(client.id);
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

    if (deletedDuplicates > 0) {
      logSystemEvent(
        "Import cleanup",
        "success",
        `Removed ${deletedDuplicates} duplicate imported client row(s) after import.`
      );
    }
  }

  invalidateAnalyticsCache();
  logSystemEvent(
    "Import cleanup",
    "success",
    `Post-import cleanup completed for ${clientIds.length} client row(s) and ${followupIds.length} follow-up row(s).`
  );
}

function scheduleImportCleanup(task) {
  const taskFilePath = path.join(
    cleanupJobsDirectory,
    `cleanup-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`
  );
  fs.writeFileSync(taskFilePath, JSON.stringify({ ...task, dbPath }), "utf8");

  const workerPath = path.join(__dirname, "cleanup-worker.js");
  const nodeExec = getNodeExecConfig();
  const child = spawn(nodeExec.command, [workerPath, taskFilePath], {
    detached: true,
    env: nodeExec.env,
    stdio: "ignore",
  });
  child.unref();
}

function sendJsonThenScheduleCleanup(res, payload, cleanupTask) {
  res.status(201).json(payload);
  setTimeout(() => {
    scheduleImportCleanup(cleanupTask);
  }, 0);
}

function runCleanupInWorker(task) {
  return new Promise((resolve, reject) => {
    const taskFilePath = path.join(
      cleanupJobsDirectory,
      `cleanup-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.json`
    );
    fs.writeFileSync(taskFilePath, JSON.stringify({ ...task, dbPath }), "utf8");

    const workerPath = path.join(__dirname, "cleanup-worker.js");
    const nodeExec = getNodeExecConfig();
    execFile(nodeExec.command, [workerPath, taskFilePath], { env: nodeExec.env }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}"));
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function runFullDataCleanup() {
  const clientIds = db.prepare("SELECT id FROM clients").all().map((row) => row.id);
  const followupIds = db.prepare("SELECT id FROM followups").all().map((row) => row.id);

  runImportCleanupTask({
    clientIds: new Set(clientIds),
    followupIds: new Set(followupIds),
    dedupeImportedClients: false,
  });

  return {
    cleanedClients: clientIds.length,
    cleanedFollowups: followupIds.length,
  };
}

function getNodeExecConfig() {
  if (process.versions.electron) {
    return {
      command: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  return {
    command: process.execPath,
    env: process.env,
  };
}

function normalizeChronicDiseaseDisplay(value) {
  const text = normalizeText(value);

  if (!text) {
    return "None";
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(text)) {
    return "None";
  }

  return text;
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

function isValidDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parsePositiveInteger(value) {
  const parsed = toNumber(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function applyPaginationToQuery(baseQuery, limit, offset) {
  if (limit === null) {
    return baseQuery;
  }

  return `${baseQuery} LIMIT ${limit} OFFSET ${offset ?? 0}`;
}

function getClientSortClause(sort) {
  const sortMap = {
    id_desc: "c.id DESC",
    id_asc: "c.id ASC",
    created_desc: "effective_created_at DESC, c.id DESC",
    created_asc: "effective_created_at ASC, c.id ASC",
    same_name:
      "same_name_group_count DESC, c.name COLLATE NOCASE ASC, c.age ASC, c.id ASC",
    name_asc: "c.name COLLATE NOCASE ASC, c.id ASC",
    name_desc: "c.name COLLATE NOCASE DESC, c.id DESC",
    progress_desc:
      "CASE WHEN c.program_type = 'Weight Loss' THEN c.starting_weight - COALESCE(lf.current_weight, c.starting_weight) ELSE COALESCE(lf.current_weight, c.starting_weight) - c.starting_weight END DESC, c.id DESC",
    progress_asc:
      "CASE WHEN c.program_type = 'Weight Loss' THEN c.starting_weight - COALESCE(lf.current_weight, c.starting_weight) ELSE COALESCE(lf.current_weight, c.starting_weight) - c.starting_weight END ASC, c.id ASC",
    followups_desc: "COALESCE(fs.followup_count, 0) DESC, effective_created_at DESC, c.id DESC",
    followups_asc: "COALESCE(fs.followup_count, 0) ASC, effective_created_at ASC, c.id ASC",
  };

  return sortMap[sort] ?? sortMap.id_desc;
}

function getFollowupSortClause(sort) {
  const sortMap = {
    id_desc: "ranked_followups.id DESC",
    id_asc: "ranked_followups.id ASC",
    date_desc: "ranked_followups.date DESC, ranked_followups.id DESC",
    date_asc: "ranked_followups.date ASC, ranked_followups.id ASC",
    same_name:
      "ranked_followups.same_name_group_count DESC, ranked_followups.client_name COLLATE NOCASE ASC, ranked_followups.client_id ASC, ranked_followups.date DESC, ranked_followups.id DESC",
    weight_desc: "ranked_followups.weight DESC, ranked_followups.date DESC, ranked_followups.id DESC",
    weight_asc: "ranked_followups.weight ASC, ranked_followups.date ASC, ranked_followups.id ASC",
    client_asc: "ranked_followups.client_name COLLATE NOCASE ASC, ranked_followups.date DESC, ranked_followups.id DESC",
    client_desc:
      "ranked_followups.client_name COLLATE NOCASE DESC, ranked_followups.date DESC, ranked_followups.id DESC",
  };

  return sortMap[sort] ?? sortMap.id_desc;
}

function validateClientPayload(payload) {
  const name = normalizeClientName(payload.name);
  const age = toNumber(payload.age);
  const startingWeight = toNumber(payload.starting_weight);
  const targetWeight = toNumber(payload.target_weight);
  const programType = normalizeText(payload.program_type);

  if (!name) {
    return { error: "Client name must contain real Arabic or English text." };
  }

  if (!Number.isInteger(age) || age <= 0) {
    return { error: "Age must be a positive integer." };
  }

  if (!PROGRAM_TYPES.has(programType)) {
    return { error: "Program type must be Weight Loss or Weight Gain." };
  }

  if (startingWeight === null || startingWeight <= 0) {
    return { error: "Starting weight must be a positive number." };
  }

  if (targetWeight !== null && targetWeight <= 0) {
    return { error: "Target weight must be a positive number when provided." };
  }

  return {
    value: {
      name,
      age,
      phone: normalizeText(payload.phone),
      program_type: programType,
      chronic_diseases: normalizeChronicDiseaseImport(payload.chronic_diseases),
      starting_weight: startingWeight,
      target_weight: targetWeight,
    },
  };
}

function createClientRecord(payload, options = {}) {
  const validation = validateClientPayload(payload);

  if (validation.error) {
    return { error: validation.error };
  }

  const result = db
    .prepare(
      `
      INSERT INTO clients
      (name, age, phone, program_type, chronic_diseases, starting_weight, target_weight)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      validation.value.name,
      validation.value.age,
      validation.value.phone,
      validation.value.program_type,
      validation.value.chronic_diseases,
      validation.value.starting_weight,
      validation.value.target_weight
    );

  if (!options.skipInvalidate) {
    invalidateAnalyticsCache();
  }

  if (options.skipFetchSummary) {
    return {
      value: {
        id: result.lastInsertRowid,
      },
    };
  }

  return {
    value: getClientSummary(getClientById(result.lastInsertRowid)),
  };
}

function createClientRecordFast(payload) {
  const validation = validateClientPayload(payload);

  if (validation.error) {
    return { error: validation.error };
  }

  const result = db
    .prepare(
      `
      INSERT INTO clients
      (name, age, phone, program_type, chronic_diseases, starting_weight, target_weight)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      validation.value.name,
      validation.value.age,
      validation.value.phone,
      validation.value.program_type,
      validation.value.chronic_diseases,
      validation.value.starting_weight,
      validation.value.target_weight
    );

  return {
    value: {
      id: result.lastInsertRowid,
      validatedClient: validation.value,
    },
  };
}

function createFollowupRecord(payload, options = {}) {
  const validation = validateFollowupPayload(payload);

  if (validation.error) {
    return { error: validation.error };
  }

  const client = getClientById(validation.value.client_id);

  if (!client) {
    return { error: "Client not found." };
  }

  const result = db
    .prepare(
      `
      INSERT INTO followups
      (client_id, date, weight, medicine_name, adherence_status, medicine_taken, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      validation.value.client_id,
      validation.value.date,
      validation.value.weight,
      validation.value.medicine_name,
      validation.value.adherence_status,
      validation.value.adherence_status,
      validation.value.notes
    );

  if (!options.skipInvalidate) {
    invalidateAnalyticsCache();
  }

  if (options.skipFetchSummary) {
    return {
      value: {
        id: result.lastInsertRowid,
        client_id: validation.value.client_id,
      },
    };
  }

  return {
    value: (() => {
      const followup = db
        .prepare(
          `
          SELECT
            f.id,
            f.client_id,
            f.date,
            f.weight,
            COALESCE(f.medicine_name, f.medicine_taken) AS medicine_name,
            COALESCE(f.adherence_status, f.medicine_taken, 'Yes') AS adherence_status,
            f.notes,
            c.name AS client_name,
            c.program_type
          FROM followups f
          INNER JOIN clients c ON c.id = f.client_id
          WHERE f.id = ?
          `
        )
        .get(result.lastInsertRowid);

      return {
        ...followup,
        medicine_name: normalizeMedicineDisplay(followup.medicine_name),
      };
    })(),
  };
}

function createFollowupRecordFast(payload) {
  const validation = validateFollowupPayload(payload);

  if (validation.error) {
    return { error: validation.error };
  }

  const result = db
    .prepare(
      `
      INSERT INTO followups
      (client_id, date, weight, medicine_name, adherence_status, medicine_taken, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      validation.value.client_id,
      validation.value.date,
      validation.value.weight,
      validation.value.medicine_name,
      validation.value.adherence_status,
      validation.value.adherence_status,
      validation.value.notes
    );

  return {
    value: {
      id: result.lastInsertRowid,
      client_id: validation.value.client_id,
    },
  };
}

function validateFollowupPayload(payload) {
  const clientId = toNumber(payload.client_id);
  const weight = toNumber(payload.weight);
  const date = normalizeText(payload.date);

  if (!Number.isInteger(clientId) || clientId <= 0) {
    return { error: "A valid client is required." };
  }

  if (!isValidDate(date)) {
    return { error: "Date must be in YYYY-MM-DD format." };
  }

  if (weight === null || weight <= 0) {
    return { error: "Weight must be a positive number." };
  }

  return {
    value: {
      client_id: clientId,
      date,
      weight,
      medicine_name: normalizeText(payload.medicine_name),
      adherence_status:
        normalizeText(payload.adherence_status) ??
        normalizeText(payload.medicine_taken) ??
        "Yes",
      notes: normalizeFollowupNotes(payload.notes),
    },
  };
}

function getClientById(id) {
  return db.prepare(`${clientListQuery} WHERE c.id = ?`).get(id);
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

function buildComparableFollowupKey(followup) {
  const entry = buildComparableFollowupEntry(followup);
  return `${entry.date}|${entry.weight}|${entry.treatment}`;
}

function buildLegacyClientSignature(clientPayload, followups) {
  return [
    normalizeComparableText(clientPayload.name),
    String(toNumber(clientPayload.age) ?? ""),
    normalizeComparableText(clientPayload.program_type),
    buildComparableFollowupSignature(followups),
  ].join("::");
}

function buildClientIdentitySignature(clientPayload) {
  return [
    normalizeComparableText(clientPayload.name),
    String(toNumber(clientPayload.age) ?? ""),
    normalizeComparableText(clientPayload.program_type),
  ].join("::");
}

function buildClientSignature(clientPayload) {
  return [
    normalizeComparableText(clientPayload.name),
    String(toNumber(clientPayload.age) ?? ""),
    normalizeComparableText(clientPayload.program_type),
    normalizeComparableNumber(clientPayload.starting_weight),
    normalizeComparableNumber(clientPayload.target_weight),
    normalizeComparableText(clientPayload.chronic_diseases),
    normalizeComparableText(clientPayload.phone),
  ].join("::");
}

function buildClientImportIndex() {
  const index = new Map();
  const clients = db.prepare(`${clientListQuery} ORDER BY c.id ASC`).all().map(getClientSummary);

  for (const client of clients) {
    index.set(buildClientSignature(client), client);
  }

  return index;
}

function buildLegacyRuntimeContext() {
  const clients = db.prepare(`${clientListQuery} ORDER BY c.id ASC`).all().map(getClientSummary);
  const followups = db
    .prepare(
      `
      SELECT
        f.client_id,
        f.date,
        f.weight,
        COALESCE(f.medicine_name, f.medicine_taken) AS treatment
      FROM followups f
      ORDER BY f.client_id ASC, f.date ASC, f.id ASC
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

  const exactSignatureToClient = new Map();
  const identityToClient = new Map();
  const followupKeysByClientId = new Map();
  const clientSummaryById = new Map();

  for (const client of clients) {
    const clientFollowups = followupsByClientId.get(client.id) ?? [];
    clientSummaryById.set(client.id, client);
    identityToClient.set(buildClientIdentitySignature(client), client);
    exactSignatureToClient.set(buildLegacyClientSignature(client, clientFollowups), client);
    followupKeysByClientId.set(
      client.id,
      new Set(clientFollowups.map((followup) => buildComparableFollowupKey(followup)))
    );
  }

  return {
    exactSignatureToClient,
    identityToClient,
    followupsByClientId,
    followupKeysByClientId,
    clientSummaryById,
  };
}

function analyzeClientImportRows(rows, dbSignatureIndex = buildClientImportIndex()) {
  const seenSignatures = new Set();
  let validRows = 0;
  let duplicatesInFile = 0;
  let duplicatesInDatabase = 0;

  rows.forEach((row) => {
    const validation = validateClientPayload(row);
    if (validation.error) {
      return;
    }

    validRows += 1;
    const signature = buildClientSignature(validation.value);

    if (seenSignatures.has(signature)) {
      duplicatesInFile += 1;
      return;
    }

    seenSignatures.add(signature);
    if (dbSignatureIndex.has(signature)) {
      duplicatesInDatabase += 1;
    }
  });

  return {
    totalRows: rows.length,
    validRows,
    duplicatesInFile,
    duplicatesInDatabase,
    uniqueReady: Math.max(0, validRows - duplicatesInFile - duplicatesInDatabase),
  };
}

function findMatchingClientImport(clientPayload) {
  const candidates = db
    .prepare(
      `
      SELECT id
      FROM clients
      WHERE age = ?
        AND program_type = ?
      `
    )
    .all(clientPayload.age, clientPayload.program_type);

  const importSignature = buildClientSignature(clientPayload);

  for (const candidate of candidates) {
    const existingClient = getClientById(candidate.id);
    const existingSignature = buildClientSignature(existingClient);

    if (existingSignature === importSignature) {
      return getClientSummary(existingClient);
    }
  }

  return null;
}

function findMatchingLegacyImport(clientPayload, followups) {
  const candidates = db
    .prepare(
      `
      SELECT id
      FROM clients
      WHERE age = ?
        AND program_type = ?
      `
    )
    .all(clientPayload.age, clientPayload.program_type);

  const importSignature = buildLegacyClientSignature(clientPayload, followups);

  for (const candidate of candidates) {
    const existingClient = getClientById(candidate.id);
    const existingFollowups = getFollowupsForClient(candidate.id);
    const existingSignature = buildLegacyClientSignature(existingClient, existingFollowups);

    if (existingSignature === importSignature) {
      return getClientSummary(existingClient);
    }
  }

  return null;
}

function findMatchingLegacyClientIdentity(clientPayload) {
  const candidates = db
    .prepare(
      `
      SELECT id
      FROM clients
      WHERE age = ?
        AND program_type = ?
      `
    )
    .all(clientPayload.age, clientPayload.program_type);

  const identitySignature = buildClientIdentitySignature(clientPayload);

  for (const candidate of candidates) {
    const existingClient = getClientById(candidate.id);
    if (buildClientIdentitySignature(existingClient) === identitySignature) {
      return getClientSummary(existingClient);
    }
  }

  return null;
}

function buildNormalizedLegacyBlock(block) {
  const followups = Array.isArray(block.followups) ? block.followups : [];
  const earliestFollowup = [...followups].sort((left, right) =>
    String(left.date).localeCompare(String(right.date))
  )[0];

  const clientPayload = {
    ...block.client,
    program_type: block.client?.program_type,
    chronic_diseases:
      normalizeText(block.client?.chronic_diseases) ?? normalizeText(block.clientNotes),
    starting_weight: block.client?.starting_weight ?? earliestFollowup?.weight,
  };

  const validatedClient = validateClientPayload(clientPayload);
  if (validatedClient.error) {
    return { error: validatedClient.error };
  }

  const normalizedFollowups = followups.map((followup) => ({
    date: normalizeText(followup.date),
    weight: toNumber(followup.weight),
    treatment: normalizeText(followup.treatment),
  }));

  return {
    value: {
      clientPayload,
      validatedClient: validatedClient.value,
      normalizedFollowups,
      signature: buildLegacyClientSignature(validatedClient.value, normalizedFollowups),
    },
  };
}

function analyzeLegacyBlocks(blocks, legacyContext = buildLegacyRuntimeContext()) {
  const seenSignatures = new Set();
  let validBlocks = 0;
  let duplicatesInFile = 0;
  let duplicatesInDatabase = 0;
  let mergesIntoExisting = 0;

  blocks.forEach((block) => {
    const followups = Array.isArray(block.followups) ? block.followups : [];
    if (followups.length === 0) {
      return;
    }

    const normalized = buildNormalizedLegacyBlock(block);
    if (normalized.error) {
      return;
    }

    validBlocks += 1;

    if (seenSignatures.has(normalized.value.signature)) {
      duplicatesInFile += 1;
      return;
    }

    seenSignatures.add(normalized.value.signature);
    if (legacyContext.exactSignatureToClient.has(normalized.value.signature)) {
      duplicatesInDatabase += 1;
    } else if (
      legacyContext.identityToClient.has(
        buildClientIdentitySignature(normalized.value.validatedClient)
      )
    ) {
      mergesIntoExisting += 1;
    }
  });

  return {
    totalBlocks: blocks.length,
    validBlocks,
    duplicatesInFile,
    duplicatesInDatabase,
    mergesIntoExisting,
    uniqueReady: Math.max(0, validBlocks - duplicatesInFile - duplicatesInDatabase),
  };
}

function importClientBlock(block, index, results, counters, seenSignatures, options = {}) {
  const duplicateStrategy = options.duplicateStrategy === "include" ? "include" : "skip";
  const legacyContext = options.legacyContext ?? null;
  const followups = Array.isArray(block.followups) ? block.followups : [];

  if (followups.length === 0) {
    throw new Error("This client block does not contain any valid follow-ups.");
  }

  const normalized = buildNormalizedLegacyBlock(block);
  if (normalized.error) {
    throw new Error(normalized.error);
  }

  const { clientPayload, validatedClient, normalizedFollowups, signature } = normalized.value;

  if (duplicateStrategy === "skip" && seenSignatures.has(signature)) {
    counters.skippedBlocks += 1;
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: true,
      duplicate: true,
      skipped: true,
      importedFollowups: 0,
    });
    return;
  }

  const existingDuplicate =
    duplicateStrategy === "skip"
      ? legacyContext?.exactSignatureToClient.get(signature) ??
        findMatchingLegacyImport(validatedClient, normalizedFollowups)
      : null;
  if (duplicateStrategy === "skip" && existingDuplicate) {
    seenSignatures.add(signature);
    counters.skippedBlocks += 1;
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: true,
      duplicate: true,
      skipped: true,
      client: existingDuplicate,
      importedFollowups: 0,
    });
    return;
  }

  const identitySignature = buildClientIdentitySignature(validatedClient);
  const existingClientIdentity =
    duplicateStrategy === "skip"
      ? legacyContext?.identityToClient.get(identitySignature) ??
        findMatchingLegacyClientIdentity(validatedClient)
      : null;
  if (existingClientIdentity) {
    const existingFollowups =
      legacyContext?.followupsByClientId.get(existingClientIdentity.id) ??
      getFollowupsForClient(existingClientIdentity.id);
    const existingFollowupKeys =
      legacyContext?.followupKeysByClientId.get(existingClientIdentity.id) ??
      new Set(existingFollowups.map((followup) => buildComparableFollowupKey(followup)));
    let importedFollowups = 0;

    for (const followup of followups) {
      const comparableKey = buildComparableFollowupKey(followup);
      if (existingFollowupKeys.has(comparableKey)) {
        continue;
      }

      const createdFollowup = createFollowupRecord({
        client_id: existingClientIdentity.id,
        date: followup.date,
        weight: followup.weight,
        medicine_name: followup.treatment,
        adherence_status: "Imported",
        notes: [block.statusLabel, block.clientNotes].filter(Boolean).join(" | ") || null,
      }, { skipInvalidate: true, skipFetchSummary: true });

      if (createdFollowup.error) {
        throw new Error(createdFollowup.error);
      }

      existingFollowupKeys.add(comparableKey);
      existingFollowups.push({
        client_id: existingClientIdentity.id,
        date: followup.date,
        weight: followup.weight,
        treatment: followup.treatment,
      });
      importedFollowups += 1;
      counters.followupIds.add(createdFollowup.value.id);
    }

    if (legacyContext) {
      const updatedClientSummary =
        getClientSummary(getClientById(existingClientIdentity.id)) ?? existingClientIdentity;
      legacyContext.clientSummaryById.set(existingClientIdentity.id, updatedClientSummary);
      legacyContext.identityToClient.set(identitySignature, updatedClientSummary);
      legacyContext.followupsByClientId.set(existingClientIdentity.id, existingFollowups);
      legacyContext.followupKeysByClientId.set(existingClientIdentity.id, existingFollowupKeys);
      legacyContext.exactSignatureToClient.set(
        buildLegacyClientSignature(updatedClientSummary, existingFollowups),
        updatedClientSummary
      );
    }

    counters.mergedBlocks += 1;
    counters.importedFollowups += importedFollowups;
    counters.clientIds.add(existingClientIdentity.id);
    seenSignatures.add(signature);
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: true,
      merged: true,
      client:
        legacyContext?.clientSummaryById.get(existingClientIdentity.id) ??
        getClientSummary(getClientById(existingClientIdentity.id)),
      importedFollowups,
    });
    return;
  }

  const createdClient = createClientRecord(clientPayload, {
    skipInvalidate: true,
    skipFetchSummary: true,
  });

  if (createdClient.error) {
    throw new Error(createdClient.error);
  }

  let blockFollowups = 0;
  for (const followup of followups) {
      const createdFollowup = createFollowupRecord({
      client_id: createdClient.value.id,
      date: followup.date,
      weight: followup.weight,
      medicine_name: followup.treatment,
      adherence_status: "Imported",
      notes: [block.statusLabel, block.clientNotes].filter(Boolean).join(" | ") || null,
    }, { skipInvalidate: true, skipFetchSummary: true });

    if (createdFollowup.error) {
      throw new Error(createdFollowup.error);
    }

    blockFollowups += 1;
    counters.followupIds.add(createdFollowup.value.id);
  }

  counters.importedClients += 1;
  counters.importedFollowups += blockFollowups;
  counters.clientIds.add(createdClient.value.id);
  seenSignatures.add(signature);
  const createdClientSummary = getClientSummary(getClientById(createdClient.value.id));
  if (legacyContext && createdClientSummary) {
    legacyContext.clientSummaryById.set(createdClient.value.id, createdClientSummary);
    legacyContext.identityToClient.set(identitySignature, createdClientSummary);
    legacyContext.followupsByClientId.set(createdClient.value.id, normalizedFollowups);
    legacyContext.followupKeysByClientId.set(
      createdClient.value.id,
      new Set(normalizedFollowups.map((followup) => buildComparableFollowupKey(followup)))
    );
    legacyContext.exactSignatureToClient.set(signature, createdClientSummary);
  }
  results.push({
    blockNumber: block.blockNumber ?? index + 1,
    sheetName: block.sheetName ?? "Unknown",
    success: true,
    client: createdClientSummary,
    importedFollowups: blockFollowups,
  });
}

function importClientBlockFast(block, index, results, counters) {
  const followups = Array.isArray(block.followups) ? block.followups : [];

  if (followups.length === 0) {
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: false,
      error: "This client block does not contain any valid follow-ups.",
    });
    return;
  }

  const normalized = buildNormalizedLegacyBlock(block);
  if (normalized.error) {
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: false,
      error: normalized.error,
    });
    return;
  }

  const notes = [block.statusLabel, block.clientNotes].filter(Boolean).join(" | ") || null;
  const createdClient = createClientRecordFast(normalized.value.clientPayload);

  if (createdClient.error) {
    results.push({
      blockNumber: block.blockNumber ?? index + 1,
      sheetName: block.sheetName ?? "Unknown",
      success: false,
      error: createdClient.error,
    });
    return;
  }

  let importedFollowups = 0;

  for (const followup of normalized.value.normalizedFollowups) {
    const createdFollowup = createFollowupRecordFast({
      client_id: createdClient.value.id,
      date: followup.date,
      weight: followup.weight,
      medicine_name: followup.treatment,
      adherence_status: "Imported",
      notes,
    });

    if (createdFollowup.error) {
      results.push({
        blockNumber: block.blockNumber ?? index + 1,
        sheetName: block.sheetName ?? "Unknown",
        success: false,
        error: createdFollowup.error,
      });
      db.prepare("DELETE FROM clients WHERE id = ?").run(createdClient.value.id);
      return;
    }

    importedFollowups += 1;
  }

  counters.importedClients += 1;
  counters.importedFollowups += importedFollowups;
  results.push({
    blockNumber: block.blockNumber ?? index + 1,
    sheetName: block.sheetName ?? "Unknown",
    success: true,
    client: getClientSummary(getClientById(createdClient.value.id)),
    importedFollowups,
  });
}

function getClientSummary(client) {
  if (!client) {
    return null;
  }

  const createdAt = client.effective_created_at ?? client.created_at;
  const currentWeight = client.current_weight ?? client.starting_weight;
  const progressRaw =
    client.program_type === "Weight Loss"
      ? client.starting_weight - currentWeight
      : currentWeight - client.starting_weight;
  const progress = Number(progressRaw.toFixed(1));

  return {
    ...client,
    display_id: toClientDisplayId(client.id),
    created_at: createdAt,
    chronic_diseases: normalizeChronicDiseaseDisplay(client.chronic_diseases),
    current_weight: currentWeight,
    progress,
  };
}

function getFollowupsForClient(clientId) {
  return db
    .prepare(
      `
      SELECT *
      FROM (
        ${followupListBaseQuery}
        WHERE f.client_id = ?
      ) ranked_followups
      ORDER BY ranked_followups.date DESC, ranked_followups.id DESC
      `
    )
    .all(clientId)
    .map((followup) => ({
      ...followup,
      display_id: toFollowupDisplayId(followup.id),
      client_display_id: toClientDisplayId(followup.client_id),
      medicine_name: normalizeMedicineDisplay(followup.medicine_name),
      weight_change:
        followup.previous_weight === null || followup.previous_weight === undefined
          ? null
          : Number((followup.weight - followup.previous_weight).toFixed(1)),
    }));
}

function getAllClients() {
  return db
    .prepare(`${clientListQuery} ORDER BY effective_created_at DESC, c.id DESC`)
    .all()
    .map(getClientSummary);
}

function getAllFollowupsForExport() {
  return db
    .prepare(
      `
      SELECT
        f.id,
        f.client_id,
        c.name AS client_name,
        c.age AS client_age,
        c.program_type,
        f.date,
        f.weight,
        COALESCE(f.medicine_name, f.medicine_taken) AS treatment,
        COALESCE(f.adherence_status, f.medicine_taken, 'Imported') AS adherence_status,
        f.notes,
        f.created_at
      FROM followups f
      INNER JOIN clients c ON c.id = f.client_id
      ORDER BY c.id ASC, f.date ASC, f.id ASC
      `
    )
    .all()
    .map((followup) => ({
      ...followup,
      treatment: normalizeMedicineDisplay(followup.treatment),
    }));
}

function buildBackupTimestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${parts[0]}${parts[1]}${parts[2]}_${parts[3]}${parts[4]}${parts[5]}`;
}

function getTableColumnNames(database, tableName) {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => column.name);
}

function buildRowInsertStatement(tableName, columns) {
  const columnList = columns.map((column) => `"${column}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
}

function readLocalBackupSchedule() {
  try {
    if (!fs.existsSync(localBackupSchedulePath)) {
      return {
        enabled: false,
        intervalMinutes: 1440,
        lastRunAt: "",
        lastBackupFilename: "",
      };
    }

    const parsed = JSON.parse(fs.readFileSync(localBackupSchedulePath, "utf8"));
    return {
      enabled: Boolean(parsed.enabled),
      intervalMinutes: Math.max(30, Number(parsed.intervalMinutes) || 1440),
      lastRunAt: parsed.lastRunAt ?? "",
      lastBackupFilename: parsed.lastBackupFilename ?? "",
    };
  } catch {
    return {
      enabled: false,
      intervalMinutes: 1440,
      lastRunAt: "",
      lastBackupFilename: "",
    };
  }
}

function writeLocalBackupSchedule(nextState) {
  fs.writeFileSync(localBackupSchedulePath, JSON.stringify(nextState, null, 2), "utf8");
}

function updateLocalBackupSchedule(updater) {
  const currentState = readLocalBackupSchedule();
  const nextState = typeof updater === "function" ? updater(currentState) : { ...currentState, ...updater };
  writeLocalBackupSchedule(nextState);
  return nextState;
}

function getAppSetting(key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  return row?.value ?? "";
}

function setAppSetting(key, value) {
  db.prepare(
    `
    INSERT INTO app_settings(key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(key, value);
}

function readGoogleDriveState() {
  try {
    const storedClientId = getAppSetting("google_drive_client_id");
    const storedClientSecret = getAppSetting("google_drive_client_secret");

    if (!fs.existsSync(googleDriveStatePath)) {
      return {
        clientId: storedClientId,
        clientSecret: storedClientSecret,
        refreshToken: "",
        accessToken: "",
        accessTokenExpiresAt: 0,
        folderId: "",
        connectedAt: "",
        autoSyncEnabled: false,
        syncIntervalMinutes: 120,
        lastSyncAt: "",
        lastSyncStatus: "idle",
        history: [],
      };
    }

    const parsed = JSON.parse(fs.readFileSync(googleDriveStatePath, "utf8"));

    if (!storedClientId && parsed.clientId) {
      setAppSetting("google_drive_client_id", parsed.clientId);
    }

    if (!storedClientSecret && parsed.clientSecret) {
      setAppSetting("google_drive_client_secret", parsed.clientSecret);
    }

    return {
      clientId: storedClientId || parsed.clientId || "",
      clientSecret: storedClientSecret || parsed.clientSecret || "",
      refreshToken: parsed.refreshToken ?? "",
      accessToken: parsed.accessToken ?? "",
      accessTokenExpiresAt: parsed.accessTokenExpiresAt ?? 0,
      folderId: parsed.folderId ?? "",
      connectedAt: parsed.connectedAt ?? "",
      autoSyncEnabled: Boolean(parsed.autoSyncEnabled),
      syncIntervalMinutes: Number(parsed.syncIntervalMinutes) > 0 ? Number(parsed.syncIntervalMinutes) : 120,
      lastSyncAt: parsed.lastSyncAt ?? "",
      lastSyncStatus: parsed.lastSyncStatus ?? "idle",
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 50) : [],
    };
  } catch {
    return {
      clientId: getAppSetting("google_drive_client_id"),
      clientSecret: getAppSetting("google_drive_client_secret"),
      refreshToken: "",
      accessToken: "",
      accessTokenExpiresAt: 0,
      folderId: "",
      connectedAt: "",
      autoSyncEnabled: false,
      syncIntervalMinutes: 120,
      lastSyncAt: "",
      lastSyncStatus: "error",
      history: [],
    };
  }
}

function writeGoogleDriveState(nextState) {
  const stateToPersist = { ...nextState };
  delete stateToPersist.clientId;
  delete stateToPersist.clientSecret;
  fs.writeFileSync(googleDriveStatePath, JSON.stringify(stateToPersist, null, 2), "utf8");
}

function sanitizeGoogleDriveState(state) {
  return {
    configured: Boolean(state.clientId && state.clientSecret),
    connected: Boolean(state.refreshToken),
    connectedAt: state.connectedAt || null,
    autoSyncEnabled: Boolean(state.autoSyncEnabled),
    syncIntervalMinutes: state.syncIntervalMinutes || 120,
    lastSyncAt: state.lastSyncAt || null,
    lastSyncStatus: state.lastSyncStatus || "idle",
    folderName: GOOGLE_DRIVE_FOLDER_NAME,
    history: Array.isArray(state.history) ? state.history.slice(0, 20) : [],
  };
}

function updateGoogleDriveState(updater) {
  const currentState = readGoogleDriveState();
  const nextState = typeof updater === "function" ? updater(currentState) : { ...currentState, ...updater };
  writeGoogleDriveState(nextState);
  return nextState;
}

function recordGoogleDriveHistory(entry) {
  updateGoogleDriveState((currentState) => ({
    ...currentState,
    history: [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...(currentState.history ?? []),
    ].slice(0, 50),
  }));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error_description || data.error?.message || data.error || "Request failed.");
  }

  return data;
}

async function getGoogleDriveAccessToken() {
  const state = readGoogleDriveState();

  if (!state.clientId || !state.clientSecret || !state.refreshToken) {
    throw new Error("Google Drive is not connected yet.");
  }

  if (state.accessToken && Number(state.accessTokenExpiresAt) > Date.now() + 60_000) {
    return state.accessToken;
  }

  const payload = new URLSearchParams({
    client_id: state.clientId,
    client_secret: state.clientSecret,
    refresh_token: state.refreshToken,
    grant_type: "refresh_token",
  });

  const tokenData = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload.toString(),
  });

  updateGoogleDriveState((currentState) => ({
    ...currentState,
    accessToken: tokenData.access_token,
    accessTokenExpiresAt: Date.now() + Number(tokenData.expires_in ?? 3600) * 1000,
  }));

  return tokenData.access_token;
}

async function googleDriveRequest(pathname, options = {}) {
  const accessToken = await getGoogleDriveAccessToken();
  const headers = new Headers(options.headers ?? {});
  headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`https://www.googleapis.com${pathname}`, {
    ...options,
    headers,
  });

  if (options.parseAs === "buffer") {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Google Drive request failed.");
    }

    return Buffer.from(await response.arrayBuffer());
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error?.message || "Google Drive request failed.");
  }

  return data;
}

async function ensureGoogleDriveFolderId() {
  const state = readGoogleDriveState();

  if (state.folderId) {
    return state.folderId;
  }

  const query = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = '${GOOGLE_DRIVE_FOLDER_NAME.replace(/'/g, "\\'")}' and trashed = false`
  );
  const listResponse = await googleDriveRequest(
    `/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive&pageSize=10`
  );
  const existingFolderId = listResponse.files?.[0]?.id;

  if (existingFolderId) {
    updateGoogleDriveState((currentState) => ({ ...currentState, folderId: existingFolderId }));
    return existingFolderId;
  }

  const createdFolder = await googleDriveRequest("/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: GOOGLE_DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  updateGoogleDriveState((currentState) => ({ ...currentState, folderId: createdFolder.id }));
  return createdFolder.id;
}

async function uploadBufferToGoogleDrive({ buffer, filename, mimeType, folderId }) {
  const boundary = `pharmacy-boundary-${Date.now()}`;
  const metadataPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
      name: filename,
      parents: [folderId],
    })}\r\n`,
    "utf8"
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const closing = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([metadataPart, fileHeader, buffer, closing]);

  return googleDriveRequest(
    "/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,webViewLink,mimeType",
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
}

async function listGoogleDriveBackupFiles() {
  const folderId = await ensureGoogleDriveFolderId();
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const response = await googleDriveRequest(
    `/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink)&orderBy=createdTime desc&pageSize=50`
  );

  return Array.isArray(response.files) ? response.files : [];
}

async function deleteOldGoogleDriveBackupFiles(days = 30) {
  const files = await listGoogleDriveBackupFiles();
  const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
  const staleFiles = files.filter((file) => {
    const referenceDate = file.createdTime || file.modifiedTime;
    return referenceDate ? new Date(referenceDate).getTime() < cutoffTime : false;
  });

  for (const file of staleFiles) {
    await googleDriveRequest(`/drive/v3/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
  }

  return {
    deletedCount: staleFiles.length,
    deletedFiles: staleFiles.map((file) => ({
      id: file.id,
      name: file.name,
    })),
  };
}

function createDatabaseBackupCopy(filenamePrefix = "pharmacy_backup") {
  const timestamp = buildBackupTimestamp();
  const backupFilename = `${filenamePrefix}_${timestamp}.db`;
  const backupPath = path.join(backupDirectory, backupFilename);
  db.pragma("wal_checkpoint(FULL)");
  fs.copyFileSync(dbPath, backupPath);
  systemInfoCache.expiresAt = 0;
  systemInfoCache.value = null;
  return { backupFilename, backupPath };
}

let localBackupTimer = null;

function scheduleLocalBackups() {
  if (localBackupTimer) {
    clearTimeout(localBackupTimer);
    localBackupTimer = null;
  }

  const schedule = readLocalBackupSchedule();
  if (!schedule.enabled) {
    return;
  }

  const delayMs = Math.max(30, Number(schedule.intervalMinutes) || 1440) * 60 * 1000;
  localBackupTimer = setTimeout(() => {
    try {
      const { backupFilename } = createDatabaseBackupCopy("scheduled_backup");
      updateLocalBackupSchedule((currentState) => ({
        ...currentState,
        lastRunAt: new Date().toISOString(),
        lastBackupFilename: backupFilename,
      }));
      logSystemEvent("Scheduled backup", "success", `Created ${backupFilename}.`);
    } catch (error) {
      logSystemEvent(
        "Scheduled backup",
        "error",
        error instanceof Error ? error.message : "Scheduled backup failed."
      );
    } finally {
      scheduleLocalBackups();
    }
  }, delayMs);
}

function buildSystemBackupWorkbookExport() {
  const metadataRows = [
    { key: "format", value: "pharmacy_system_backup" },
    { key: "version", value: 1 },
    { key: "exported_at", value: new Date().toISOString() },
    { key: "description", value: "Import this workbook using the dedicated System Backup uploader." },
  ];
  const clients = getAllClients();
  const exportClients = clients.map((client) => ({
    client_backup_id: `CLIENT-${client.id}`,
    name: client.name,
    age: client.age,
    phone: client.phone ?? "",
    program_type: client.program_type,
    chronic_diseases: client.chronic_diseases ?? "",
    starting_weight: client.starting_weight,
    target_weight: client.target_weight ?? "",
    client_notes: "",
    status_label: "",
    current_weight: client.current_weight,
    last_followup_date: client.last_followup_date ?? "",
    followup_count: client.followup_count,
    created_at: client.created_at,
  }));

  const exportFollowups = getAllFollowupsForExport().map((followup) => ({
    client_backup_id: `CLIENT-${followup.client_id}`,
    client_id: followup.client_id,
    client_name: followup.client_name,
    client_age: followup.client_age,
    program_type: followup.program_type,
    date: followup.date,
    weight: followup.weight,
    treatment: followup.treatment ?? "",
    adherence_status: followup.adherence_status ?? "",
    notes: followup.notes ?? "",
    created_at: followup.created_at,
  }));

  const timelineRows = clients.map((client) => {
    const row = {
      client_backup_id: `CLIENT-${client.id}`,
      name: client.name,
      age: client.age,
      program_type: client.program_type,
      phone: client.phone ?? "",
      chronic_diseases: client.chronic_diseases ?? "",
      starting_weight: client.starting_weight,
      target_weight: client.target_weight ?? "",
      current_weight: client.current_weight,
    };

    const followups = getFollowupsForClient(client.id).sort((left, right) =>
      String(left.date).localeCompare(String(right.date))
    );

    followups.forEach((followup, index) => {
      const position = index + 1;
      row[`followup_${position}_date`] = followup.date;
      row[`followup_${position}_weight`] = followup.weight;
      row[`followup_${position}_notes`] = followup.notes ?? "";
      row[`followup_${position}_adherence`] = followup.adherence_status ?? "";
    });

    return row;
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(metadataRows), "Backup Metadata");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportClients), "Clients");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportFollowups), "Followups");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(timelineRows), "Client Timelines");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const filename = `pharmacy_system_backup_${buildBackupTimestamp()}.xlsx`;
  return { buffer, filename };
}

let googleDriveAutoSyncTimer = null;
let googleDriveSyncInProgress = false;

async function performGoogleDriveSync(trigger = "manual") {
  if (googleDriveSyncInProgress) {
    throw new Error("A Google Drive sync is already in progress.");
  }

  googleDriveSyncInProgress = true;
  const startedAt = Date.now();

  try {
    const folderId = await ensureGoogleDriveFolderId();
    const { backupFilename, backupPath } = createDatabaseBackupCopy("google_drive_backup");
    const workbookExport = buildSystemBackupWorkbookExport();
    const dbBuffer = fs.readFileSync(backupPath);

    const [databaseFile, workbookFile] = await Promise.all([
      uploadBufferToGoogleDrive({
        buffer: dbBuffer,
        filename: backupFilename,
        mimeType: "application/octet-stream",
        folderId,
      }),
      uploadBufferToGoogleDrive({
        buffer: workbookExport.buffer,
        filename: workbookExport.filename,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        folderId,
      }),
    ]);

    const durationMs = Date.now() - startedAt;
    const totalRecords =
      db.prepare("SELECT COUNT(*) AS count FROM clients").get().count +
      db.prepare("SELECT COUNT(*) AS count FROM followups").get().count;

    const nextState = updateGoogleDriveState((currentState) => ({
      ...currentState,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "success",
    }));
    recordGoogleDriveHistory({
      status: "success",
      trigger,
      recordsSynced: totalRecords,
      durationMs,
      files: [
        { id: databaseFile.id, name: databaseFile.name, mimeType: databaseFile.mimeType, webViewLink: databaseFile.webViewLink },
        { id: workbookFile.id, name: workbookFile.name, mimeType: workbookFile.mimeType, webViewLink: workbookFile.webViewLink },
      ],
    });
    logSystemEvent(
      "Google Drive sync",
      "success",
      `Uploaded ${backupFilename} and ${workbookExport.filename} to Google Drive.`
    );

    return {
      ...sanitizeGoogleDriveState(nextState),
      latestFiles: [databaseFile, workbookFile],
      durationMs,
      recordsSynced: totalRecords,
    };
  } catch (error) {
    updateGoogleDriveState((currentState) => ({
      ...currentState,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "error",
    }));
    recordGoogleDriveHistory({
      status: "error",
      trigger,
      recordsSynced: 0,
      durationMs: Date.now() - startedAt,
      details: error instanceof Error ? error.message : "Sync failed.",
    });
    logSystemEvent(
      "Google Drive sync",
      "error",
      error instanceof Error ? error.message : "Google Drive sync failed."
    );
    throw error;
  } finally {
    googleDriveSyncInProgress = false;
  }
}

function scheduleGoogleDriveAutoSync() {
  if (googleDriveAutoSyncTimer) {
    clearTimeout(googleDriveAutoSyncTimer);
    googleDriveAutoSyncTimer = null;
  }

  const state = readGoogleDriveState();
  if (!state.autoSyncEnabled || !state.refreshToken) {
    return;
  }

  const delayMs = Math.max(5, Number(state.syncIntervalMinutes) || 120) * 60 * 1000;
  googleDriveAutoSyncTimer = setTimeout(async () => {
    try {
      await performGoogleDriveSync("auto");
    } catch {}
    scheduleGoogleDriveAutoSync();
  }, delayMs);
}

function getSystemInfo() {
  const now = Date.now();

  if (systemInfoCache.value && systemInfoCache.expiresAt > now) {
    return systemInfoCache.value;
  }

  const databaseSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
  const backupFiles = fs
    .readdirSync(backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      name: entry.name,
      modifiedAt: fs.statSync(path.join(backupDirectory, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  const value = {
    version: "2.5.0",
    updatedAt: "2026-03-23",
    databaseSizeBytes,
    totalClients: db.prepare("SELECT COUNT(*) AS count FROM clients").get().count,
    totalFollowups: db.prepare("SELECT COUNT(*) AS count FROM followups").get().count,
    backupsStored: backupFiles.length,
    latestBackupName: backupFiles[0]?.name ?? null,
    backupDirectory,
    mode: "local",
    scheduledBackup: readLocalBackupSchedule(),
  };

  systemInfoCache.value = value;
  systemInfoCache.expiresAt = now + 5000;

  return value;
}

function getAllClientSummaries() {
  return db
    .prepare(
      `
      ${clientListQuery}
      ORDER BY effective_created_at DESC, c.id DESC
      `
    )
    .all()
    .map(getClientSummary);
}

function getAllFollowups() {
  return db
    .prepare(
      `
      SELECT *
      FROM (
        ${followupListBaseQuery}
      ) ranked_followups
      ORDER BY ranked_followups.date DESC, ranked_followups.id DESC
      `
    )
    .all()
    .map((followup) => ({
      ...followup,
      medicine_name: normalizeMedicineDisplay(followup.medicine_name),
    }));
}

function invalidateAnalyticsCache() {
  analyticsCache.dashboard = { expiresAt: 0, value: null };
  analyticsCache.progress = { expiresAt: 0, value: null };
  analyticsDatasetCache.expiresAt = 0;
  analyticsDatasetCache.clients = null;
  analyticsDatasetCache.followups = null;
  listQueryCache.clients.clear();
  listQueryCache.followups.clear();
  displayIdCache.expiresAt = 0;
  systemInfoCache.expiresAt = 0;
  systemInfoCache.value = null;
}

function getDisplayIdBases() {
  const now = Date.now();
  if (displayIdCache.expiresAt > now) {
    return displayIdCache;
  }

  const clientMinId = db.prepare("SELECT MIN(id) AS minId FROM clients").get().minId ?? 1;
  const followupMinId = db.prepare("SELECT MIN(id) AS minId FROM followups").get().minId ?? 1;
  displayIdCache.clientMinId = clientMinId;
  displayIdCache.followupMinId = followupMinId;
  displayIdCache.expiresAt = now + 10000;

  return displayIdCache;
}

function toClientDisplayId(id) {
  const { clientMinId } = getDisplayIdBases();
  return id - clientMinId + 101;
}

function toFollowupDisplayId(id) {
  const { followupMinId } = getDisplayIdBases();
  return id - followupMinId + 101;
}

function getCachedListQuery(cacheName, key, factory, ttlMs = 3000) {
  const cacheBucket = listQueryCache[cacheName];
  const now = Date.now();
  const cached = cacheBucket.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = factory();
  cacheBucket.set(key, {
    value,
    expiresAt: now + ttlMs,
  });

  if (cacheBucket.size > 100) {
    const oldestKey = cacheBucket.keys().next().value;
    if (oldestKey !== undefined) {
      cacheBucket.delete(oldestKey);
    }
  }

  return value;
}

function getCachedAnalytics(cacheKey, factory) {
  const now = Date.now();
  const entry = analyticsCache[cacheKey];

  if (entry.value && entry.expiresAt > now) {
    return entry.value;
  }

  const value = factory();
  analyticsCache[cacheKey] = {
    value,
    expiresAt: now + 15000,
  };

  return value;
}

function getAnalyticsDataset() {
  const now = Date.now();

  if (
    analyticsDatasetCache.clients &&
    analyticsDatasetCache.followups &&
    analyticsDatasetCache.expiresAt > now
  ) {
    return {
      clients: analyticsDatasetCache.clients,
      followups: analyticsDatasetCache.followups,
    };
  }

  const clients = getAllClientSummaries();
  const followups = getAllFollowups();
  analyticsDatasetCache.clients = clients;
  analyticsDatasetCache.followups = followups;
  analyticsDatasetCache.expiresAt = now + 15000;

  return { clients, followups };
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatMonthLabelFromKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: "short",
  });
}

function getRecentMonthKeys(count) {
  const current = startOfMonth(new Date());
  const months = [];

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - index, 1);
    months.push(formatMonthKey(date));
  }

  return months;
}

function getWeeklyBucketsForCurrentMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const buckets = [];
  let cursor = 1;
  let weekNumber = 1;

  while (cursor <= end.getDate()) {
    const bucketEnd = Math.min(cursor + 6, end.getDate());
    buckets.push({
      label: `Week ${weekNumber}`,
      startDay: cursor,
      endDay: bucketEnd,
      count: 0,
    });
    cursor = bucketEnd + 1;
    weekNumber += 1;
  }

  return { year, month, buckets };
}

function buildDashboardAnalytics() {
  const { clients, followups } = getAnalyticsDataset();
  const monthKeys = getRecentMonthKeys(6);
  const monthMap = new Map(
    monthKeys.map((key) => [
      key,
      {
        month: formatMonthLabelFromKey(key),
        avgLoss: 0,
        avgGain: 0,
        lossSamples: 0,
        gainSamples: 0,
      },
    ])
  );

  const followupsByClient = new Map();
  for (const followup of [...followups].sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);
    return dateComparison !== 0 ? dateComparison : left.id - right.id;
  })) {
    if (!followupsByClient.has(followup.client_id)) {
      followupsByClient.set(followup.client_id, []);
    }
    followupsByClient.get(followup.client_id).push(followup);
  }

  for (const client of clients) {
    const clientFollowups = followupsByClient.get(client.id) ?? [];
    let previousWeight = client.starting_weight;

    for (const followup of clientFollowups) {
      const monthKey = followup.date.slice(0, 7);
      const bucket = monthMap.get(monthKey);

      if (bucket) {
        const delta =
          client.program_type === "Weight Loss"
            ? previousWeight - followup.weight
            : followup.weight - previousWeight;

        if (client.program_type === "Weight Loss") {
          bucket.avgLoss += delta;
          bucket.lossSamples += 1;
        } else {
          bucket.avgGain += delta;
          bucket.gainSamples += 1;
        }
      }

      previousWeight = followup.weight;
    }
  }

  const trendData = Array.from(monthMap.values()).map((bucket, index) => ({
    id: monthKeys[index],
    month: bucket.month,
    avgLoss:
      bucket.lossSamples > 0 ? Number((bucket.avgLoss / bucket.lossSamples).toFixed(1)) : 0,
    avgGain:
      bucket.gainSamples > 0 ? Number((bucket.avgGain / bucket.gainSamples).toFixed(1)) : 0,
  }));

  const recentActivity = [];
  for (const client of clients) {
    recentActivity.push({
      id: `client-${client.id}`,
      client_id: client.id,
      client: client.name,
      action: `Started ${client.program_type.toLowerCase()} program`,
      weight: `${client.starting_weight.toFixed(1)} kg`,
      timestamp: client.created_at,
    });
  }

  for (const followup of followups) {
    recentActivity.push({
      id: `followup-${followup.id}`,
      client_id: followup.client_id,
      client: followup.client_name,
      action: "Completed follow-up",
      weight: `${followup.weight.toFixed(1)} kg`,
      timestamp: followup.created_at ?? `${followup.date} 00:00:00`,
    });
  }

  recentActivity.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const todayKey = new Date().toISOString().slice(0, 10);

  return {
    stats: {
      totalClients: clients.length,
      weightLossClients: clients.filter((client) => client.program_type === "Weight Loss").length,
      weightGainClients: clients.filter((client) => client.program_type === "Weight Gain").length,
      followUpsToday: followups.filter((followup) => followup.date === todayKey).length,
    },
    weightTrends: trendData,
    recentActivity: recentActivity.slice(0, 6),
  };
}

function buildProgressAnalytics() {
  const { clients, followups } = getAnalyticsDataset();
  const monthKeys = getRecentMonthKeys(7);
  const distribution = [
    {
      id: "weight-loss",
      name: "Weight Loss",
      value: clients.filter((client) => client.program_type === "Weight Loss").length,
      color: "#2E7DFF",
    },
    {
      id: "weight-gain",
      name: "Weight Gain",
      value: clients.filter((client) => client.program_type === "Weight Gain").length,
      color: "#00BFA6",
    },
  ];

  const successMap = new Map(
    monthKeys.map((key) => [
      key,
      {
        month: formatMonthLabelFromKey(key),
        weightLossTotal: 0,
        weightLossSuccess: 0,
        weightGainTotal: 0,
        weightGainSuccess: 0,
      },
    ])
  );

  const followupsByClient = new Map();
  for (const followup of [...followups].sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);
    return dateComparison !== 0 ? dateComparison : left.id - right.id;
  })) {
    if (!followupsByClient.has(followup.client_id)) {
      followupsByClient.set(followup.client_id, []);
    }
    followupsByClient.get(followup.client_id).push(followup);
  }

  let totalWeightLoss = 0;
  let totalWeightGain = 0;
  let weightLossClientCount = 0;
  let weightGainClientCount = 0;
  let successfulTransitions = 0;
  let measuredTransitions = 0;

  for (const client of clients) {
    const clientFollowups = followupsByClient.get(client.id) ?? [];

    const monthlyLatest = new Map();
    for (const followup of clientFollowups) {
      monthlyLatest.set(followup.date.slice(0, 7), followup);
    }

    const orderedMonthly = Array.from(monthlyLatest.entries()).sort(([left], [right]) =>
      left.localeCompare(right)
    );

    let previousWeight = client.starting_weight;
    for (const [monthKey, followup] of orderedMonthly) {
      const bucket = successMap.get(monthKey);
      if (!bucket) {
        previousWeight = followup.weight;
        continue;
      }

      const successful =
        client.program_type === "Weight Loss"
          ? followup.weight < previousWeight
          : followup.weight > previousWeight;

      measuredTransitions += 1;
      if (successful) {
        successfulTransitions += 1;
      }

      if (client.program_type === "Weight Loss") {
        bucket.weightLossTotal += 1;
        if (successful) {
          bucket.weightLossSuccess += 1;
        }
      } else {
        bucket.weightGainTotal += 1;
        if (successful) {
          bucket.weightGainSuccess += 1;
        }
      }

      previousWeight = followup.weight;
    }

    if (client.followup_count > 0) {
      if (client.program_type === "Weight Loss") {
        weightLossClientCount += 1;
        totalWeightLoss += client.progress;
      } else {
        weightGainClientCount += 1;
        totalWeightGain += client.progress;
      }
    }
  }

  const successRateData = monthKeys.map((key) => {
    const bucket = successMap.get(key);
    return {
      id: key,
      month: bucket.month,
      weightLoss:
        bucket.weightLossTotal > 0
          ? Number(((bucket.weightLossSuccess / bucket.weightLossTotal) * 100).toFixed(1))
          : 0,
      weightGain:
        bucket.weightGainTotal > 0
          ? Number(((bucket.weightGainSuccess / bucket.weightGainTotal) * 100).toFixed(1))
          : 0,
    };
  });

  const weekly = getWeeklyBucketsForCurrentMonth();
  for (const followup of followups) {
    const followupDate = new Date(`${followup.date}T00:00:00`);
    if (
      followupDate.getFullYear() === weekly.year &&
      followupDate.getMonth() === weekly.month
    ) {
      const day = followupDate.getDate();
      const bucket = weekly.buckets.find(
        (item) => day >= item.startDay && day <= item.endDay
      );
      if (bucket) {
        bucket.count += 1;
      }
    }
  }

  const followUpsPerWeek = weekly.buckets.map((bucket, index) => ({
    id: `week${index + 1}`,
    week: bucket.label,
    followUps: bucket.count,
  }));

  const totalFollowups = followups.length;
  const successRate =
    measuredTransitions > 0
      ? Number(((successfulTransitions / measuredTransitions) * 100).toFixed(1))
      : 0;

  return {
    performanceMetrics: [
      {
        label: "Average Weight Loss",
        value:
          weightLossClientCount > 0
            ? `${(totalWeightLoss / weightLossClientCount).toFixed(1)} kg`
            : "0.0 kg",
      },
      {
        label: "Average Weight Gain",
        value:
          weightGainClientCount > 0
            ? `${(totalWeightGain / weightGainClientCount).toFixed(1)} kg`
            : "0.0 kg",
      },
      {
        label: "Success Rate",
        value: `${successRate}%`,
      },
      {
        label: "Avg Follow-ups",
        value: clients.length > 0 ? `${(totalFollowups / clients.length).toFixed(1)}` : "0.0",
      },
    ],
    successRateData,
    programDistribution: distribution,
    followUpsPerWeek,
      additionalInsights: {
        activeClients: clients.length,
        totalWeightLost: Number(totalWeightLoss.toFixed(1)),
        totalWeightGained: Number(totalWeightGain.toFixed(1)),
        totalFollowups,
        clientsWithFollowups: clients.filter((client) => client.followup_count > 0).length,
      },
    };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/clients", (req, res) => {
  const search = normalizeText(req.query.search);
  const program = normalizeText(req.query.program);
  const sort = normalizeText(req.query.sort);
  const limit = parsePositiveInteger(req.query.limit);
  const offset = parsePositiveInteger(req.query.offset) ?? 0;
  const clauses = [];
  const values = [];
  const { clientMinId } = getDisplayIdBases();

  if (search) {
    const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
    if (numericSearch !== null) {
      clauses.push(
        "(c.id = ? OR (c.id - ? + 101) = ? OR LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.phone, '')) LIKE ?)"
      );
      const term = `%${search.toLowerCase()}%`;
      values.push(numericSearch, clientMinId, numericSearch, term, term);
    } else {
      clauses.push(
        "(LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.phone, '')) LIKE ? OR CAST(c.id AS TEXT) LIKE ? OR CAST(c.id - ? + 101 AS TEXT) LIKE ?)"
      );
      const term = `%${search.toLowerCase()}%`;
      values.push(term, term, term, clientMinId, term);
    }
  }

  if (program && PROGRAM_TYPES.has(program)) {
    clauses.push("c.program_type = ?");
    values.push(program);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = getClientSortClause(sort);
  const cacheKey = JSON.stringify({
    search: search ?? "",
    program: program ?? "",
    sort: sort ?? "",
    limit: limit ?? "all",
    offset,
  });
  const cached = getCachedListQuery("clients", cacheKey, () => {
    const totalCount = db
      .prepare(`SELECT COUNT(*) AS count FROM clients c ${where}`)
      .get(...values).count;
    const pagedQuery = applyPaginationToQuery(
      `${clientListQuery}
         ${where}
         ORDER BY ${orderBy}`,
      limit,
      offset
    );
    const rows = db
      .prepare(pagedQuery)
      .all(...values)
      .map(getClientSummary);

    return { rows, totalCount };
  });

  res.setHeader("X-Total-Count", String(cached.totalCount));
  res.setHeader("X-Limit", limit === null ? "all" : String(limit));
  res.setHeader("X-Offset", String(offset));
  res.json(cached.rows);
});

app.get("/clients/:id", (req, res) => {
  const clientId = toNumber(req.params.id);
  const client = getClientSummary(getClientById(clientId));

  if (!client) {
    return res.status(404).json({ error: "Client not found." });
  }

  const followups = getFollowupsForClient(clientId);
  res.json({
    ...client,
    followups,
  });
});

app.post("/clients", (req, res) => {
  const created = createClientRecord(req.body);

  if (created.error) {
    return res.status(400).json({ error: created.error });
  }

  res.status(201).json(created.value);
});

app.post("/imports/clients", (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: "Import payload must include at least one row." });
  }

  const failedResults = [];
  let importedCount = 0;

  const insertMany = db.transaction((importRows) => {
    importRows.forEach((row, index) => {
      const validation = validateClientPayload(row);

      if (validation.error) {
        failedResults.push({
          rowNumber: index + 1,
          success: false,
          error: validation.error,
        });
        return;
      }

      const created = createClientRecordFast(validation.value);

      if (created.error) {
        failedResults.push({
          rowNumber: index + 1,
          success: false,
          error: created.error,
        });
        return;
      }

      importedCount += 1;
    });
  });

  insertMany(rows);
  invalidateAnalyticsCache();

  res.status(201).json({
    totalRows: rows.length,
    importedCount,
    skippedCount: 0,
    failedCount: failedResults.length,
    results: failedResults,
  });
  logSystemEvent(
    "Client import",
    "success",
    `Imported ${importedCount} rows and failed ${failedResults.length}.`
  );
});

app.post("/imports/clients/analyze", (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;

  if (!rows || rows.length === 0) {
    return res.status(400).json({ error: "Import payload must include at least one row." });
  }

  return res.json(analyzeClientImportRows(rows));
});

app.post("/imports/legacy-arabic", (req, res) => {
  const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : null;

  if (!blocks || blocks.length === 0) {
    return res.status(400).json({ error: "Legacy import payload must include at least one block." });
  }

  const results = [];
  const counters = {
    importedClients: 0,
    importedFollowups: 0,
    skippedBlocks: 0,
    mergedBlocks: 0,
  };
  const importBlocks = db.transaction((importRows) => {
    importRows.forEach((block, index) => {
      importClientBlockFast(block, index, results, counters);
    });
  });

  importBlocks(blocks);
  invalidateAnalyticsCache();

  res.status(201).json({
    totalBlocks: blocks.length,
    importedClients: counters.importedClients,
    importedFollowups: counters.importedFollowups,
    skippedBlocks: 0,
    mergedBlocks: 0,
    failedBlocks: results.filter((result) => !result.success).length,
    results: results.filter((result) => !result.success),
  });
  logSystemEvent(
    "Legacy import",
    "success",
    `Imported ${counters.importedClients} client blocks and ${counters.importedFollowups} follow-ups; failed ${results.filter((result) => !result.success).length}.`
  );
});

app.post("/imports/legacy-arabic/analyze", (req, res) => {
  const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : null;

  if (!blocks || blocks.length === 0) {
    return res.status(400).json({ error: "Legacy import payload must include at least one block." });
  }

  return res.json(analyzeLegacyBlocks(blocks, buildLegacyRuntimeContext()));
});

app.post("/imports/system-backup", (req, res) => {
  const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : null;

  if (!blocks || blocks.length === 0) {
    return res.status(400).json({ error: "Backup import payload must include at least one block." });
  }

  const results = [];
  const counters = {
    importedClients: 0,
    importedFollowups: 0,
    skippedBlocks: 0,
    mergedBlocks: 0,
  };
  const importBlocks = db.transaction((importRows) => {
    importRows.forEach((block, index) => {
      importClientBlockFast(block, index, results, counters);
    });
  });

  importBlocks(blocks);
  invalidateAnalyticsCache();

  res.status(201).json({
    totalBlocks: blocks.length,
    importedClients: counters.importedClients,
    importedFollowups: counters.importedFollowups,
    skippedBlocks: 0,
    mergedBlocks: 0,
    failedBlocks: results.filter((result) => !result.success).length,
    results: results.filter((result) => !result.success),
  });
  logSystemEvent(
    "Backup import",
    "success",
    `Imported ${counters.importedClients} backup client blocks and ${counters.importedFollowups} follow-ups; failed ${results.filter((result) => !result.success).length}.`
  );
});

app.post("/imports/system-backup/analyze", (req, res) => {
  const blocks = Array.isArray(req.body?.blocks) ? req.body.blocks : null;

  if (!blocks || blocks.length === 0) {
    return res.status(400).json({ error: "Backup import payload must include at least one block." });
  }

  return res.json(analyzeLegacyBlocks(blocks, buildLegacyRuntimeContext()));
});

app.put("/clients/:id", (req, res) => {
  const clientId = toNumber(req.params.id);
  const existing = getClientById(clientId);

  if (!existing) {
    return res.status(404).json({ error: "Client not found." });
  }

  const validation = validateClientPayload(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  db.prepare(
    `
    UPDATE clients
    SET
      name = ?,
      age = ?,
      phone = ?,
      program_type = ?,
      chronic_diseases = ?,
      starting_weight = ?,
      target_weight = ?
    WHERE id = ?
    `
  ).run(
    validation.value.name,
    validation.value.age,
    validation.value.phone,
    validation.value.program_type,
    validation.value.chronic_diseases,
    validation.value.starting_weight,
    validation.value.target_weight,
    clientId
  );

  const client = getClientSummary(getClientById(clientId));
  invalidateAnalyticsCache();
  res.json(client);
});

app.delete("/clients/:id", (req, res) => {
  const clientId = toNumber(req.params.id);
  const existing = getClientById(clientId);

  if (!existing) {
    return res.status(404).json({ error: "Client not found." });
  }

  const deletedFollowups = db
    .prepare("DELETE FROM followups WHERE client_id = ?")
    .run(clientId).changes;
  db.prepare("DELETE FROM clients WHERE id = ?").run(clientId);

  invalidateAnalyticsCache();
  logSystemEvent("Client delete", "success", `Deleted client #${clientId} and ${deletedFollowups} follow-ups.`);
  return res.json({ success: true, deletedClientId: clientId, deletedFollowups });
});

app.get("/clients/:id/followups", (req, res) => {
  const clientId = toNumber(req.params.id);
  const client = getClientById(clientId);

  if (!client) {
    return res.status(404).json({ error: "Client not found." });
  }

  res.json(getFollowupsForClient(clientId));
});

app.post("/clients/:id/followups", (req, res) => {
  const clientId = toNumber(req.params.id);
  req.body.client_id = clientId;
  return createFollowup(req, res);
});

app.get("/followups", (req, res) => {
  const search = normalizeText(req.query.search);
  const clientId = toNumber(req.query.client_id);
  const program = normalizeText(req.query.program);
  const adherence = normalizeText(req.query.adherence);
  const sort = normalizeText(req.query.sort);
  const limit = parsePositiveInteger(req.query.limit);
  const offset = parsePositiveInteger(req.query.offset) ?? 0;
  const clauses = [];
  const values = [];
  const { clientMinId, followupMinId } = getDisplayIdBases();

  if (search) {
    const numericSearch = /^\d+$/.test(search) ? Number(search) : null;
    if (numericSearch !== null) {
      const term = `%${search.toLowerCase()}%`;
      clauses.push(
        "(f.client_id = ? OR f.id = ? OR (f.client_id - ? + 101) = ? OR (f.id - ? + 101) = ? OR LOWER(c.name) LIKE ?)"
      );
      values.push(
        numericSearch,
        numericSearch,
        clientMinId,
        numericSearch,
        followupMinId,
        numericSearch,
        term
      );
    } else {
      const term = `%${search.toLowerCase()}%`;
      clauses.push(
        "(LOWER(c.name) LIKE ? OR CAST(f.client_id AS TEXT) LIKE ? OR CAST(f.id AS TEXT) LIKE ? OR CAST(f.client_id - ? + 101 AS TEXT) LIKE ? OR CAST(f.id - ? + 101 AS TEXT) LIKE ?)"
      );
      values.push(term, term, term, clientMinId, term, followupMinId, term);
    }
  }

  if (clientId) {
    clauses.push("f.client_id = ?");
    values.push(clientId);
  }

  if (program && PROGRAM_TYPES.has(program)) {
    clauses.push("c.program_type = ?");
    values.push(program);
  }

  if (adherence) {
    clauses.push("COALESCE(f.adherence_status, f.medicine_taken, 'Yes') = ?");
    values.push(adherence);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = getFollowupSortClause(sort);
  const cacheKey = JSON.stringify({
    search: search ?? "",
    clientId: clientId ?? "",
    program: program ?? "",
    adherence: adherence ?? "",
    sort: sort ?? "",
    limit: limit ?? "all",
    offset,
  });
  const cached = getCachedListQuery("followups", cacheKey, () => {
    const totalCount = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM followups f
        INNER JOIN clients c ON c.id = f.client_id
        ${where}
        `
      )
      .get(...values).count;
    const pagedQuery = applyPaginationToQuery(
      `
        SELECT *
        FROM (
          ${followupListBaseQuery}
          ${where}
        ) ranked_followups
        ORDER BY ${orderBy}
      `,
      limit,
      offset
    );
    const rows = db
      .prepare(pagedQuery)
      .all(...values)
      .map((followup) => ({
        ...followup,
        display_id: toFollowupDisplayId(followup.id),
        client_display_id: toClientDisplayId(followup.client_id),
        medicine_name: normalizeMedicineDisplay(followup.medicine_name),
        weight_change:
          followup.previous_weight === null || followup.previous_weight === undefined
            ? null
            : Number((followup.weight - followup.previous_weight).toFixed(1)),
      }));

    return { rows, totalCount };
  });

  res.setHeader("X-Total-Count", String(cached.totalCount));
  res.setHeader("X-Limit", limit === null ? "all" : String(limit));
  res.setHeader("X-Offset", String(offset));
  res.json(cached.rows);
});

app.post("/followups", createFollowup);

app.put("/followups/:id", (req, res) => {
  const followupId = toNumber(req.params.id);
  const existing = db.prepare("SELECT * FROM followups WHERE id = ?").get(followupId);

  if (!existing) {
    return res.status(404).json({ error: "Follow-up not found." });
  }

  const validation = validateFollowupPayload(req.body);

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const client = getClientById(validation.value.client_id);

  if (!client) {
    return res.status(404).json({ error: "Client not found." });
  }

  db.prepare(
    `
    UPDATE followups
    SET
      client_id = ?,
      date = ?,
      weight = ?,
      medicine_name = ?,
      adherence_status = ?,
      medicine_taken = ?,
      notes = ?
    WHERE id = ?
    `
  ).run(
    validation.value.client_id,
    validation.value.date,
    validation.value.weight,
    validation.value.medicine_name,
    validation.value.adherence_status,
    validation.value.adherence_status,
    validation.value.notes,
    followupId
  );

  const updated = db
    .prepare(
      `
      SELECT
        f.id,
        f.client_id,
        f.date,
        f.weight,
        COALESCE(f.medicine_name, f.medicine_taken) AS medicine_name,
        COALESCE(f.adherence_status, f.medicine_taken, 'Yes') AS adherence_status,
        f.notes,
        c.name AS client_name,
        c.program_type
      FROM followups f
      INNER JOIN clients c ON c.id = f.client_id
      WHERE f.id = ?
      `
    )
    .get(followupId);

  invalidateAnalyticsCache();
  res.json({
    ...updated,
    medicine_name: normalizeMedicineDisplay(updated.medicine_name),
  });
});

app.delete("/followups/:id", (req, res) => {
  const followupId = toNumber(req.params.id);
  const existing = db.prepare("SELECT id, client_id FROM followups WHERE id = ?").get(followupId);

  if (!existing) {
    return res.status(404).json({ error: "Follow-up not found." });
  }

  db.prepare("DELETE FROM followups WHERE id = ?").run(followupId);
  invalidateAnalyticsCache();
  logSystemEvent("Follow-up delete", "success", `Deleted follow-up #${followupId}.`);
  return res.json({ success: true, deletedFollowupId: followupId, clientId: existing.client_id });
});

app.get("/dashboard", (_req, res) => {
  res.json(getCachedAnalytics("dashboard", buildDashboardAnalytics));
});

app.get("/analytics/dashboard", (_req, res) => {
  res.json(getCachedAnalytics("dashboard", buildDashboardAnalytics));
});

app.get("/analytics/progress", (_req, res) => {
  res.json(getCachedAnalytics("progress", buildProgressAnalytics));
});

function sendSystemInfo(_req, res) {
  res.json(getSystemInfo());
}

function sendSystemLogs(_req, res) {
  res.json(systemLogs);
}

app.get("/system/info", sendSystemInfo);
app.get("/api/system/info", sendSystemInfo);

app.get("/system/logs", sendSystemLogs);
app.get("/api/system/logs", sendSystemLogs);

app.get("/backups/database", (_req, res, next) => {
  try {
    const { backupFilename, backupPath } = createDatabaseBackupCopy("pharmacy_backup");
    logSystemEvent("Database backup", "success", `Created ${backupFilename}.`);

    return res.download(backupPath, backupFilename);
  } catch (error) {
    logSystemEvent("Database backup", "error", error instanceof Error ? error.message : "Backup failed.");
    return next(error);
  }
});

app.post("/backups/schedule", (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const intervalMinutes = Math.max(30, parsePositiveInteger(req.body?.intervalMinutes) ?? 1440);
  const nextState = updateLocalBackupSchedule((currentState) => ({
    ...currentState,
    enabled,
    intervalMinutes,
  }));

  scheduleLocalBackups();
  logSystemEvent(
    "Backup schedule",
    "success",
    enabled
      ? `Scheduled backups enabled every ${intervalMinutes} minute(s).`
      : "Scheduled backups disabled."
  );
  res.json(nextState);
});

app.post(
  "/backups/restore-database",
  express.raw({ type: "application/octet-stream", limit: "200mb" }),
  (req, res, next) => {
    let uploadedDb = null;
    let tempRestorePath = "";

    try {
      const fileBuffer = req.body;

      if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
        return res.status(400).json({ error: "A database backup file is required." });
      }

      const timestamp = buildBackupTimestamp();
      tempRestorePath = path.join(backupDirectory, `restore_upload_${timestamp}.db`);
      fs.writeFileSync(tempRestorePath, fileBuffer);

      uploadedDb = new Database(tempRestorePath, { readonly: true });
      const uploadedTables = new Set(
        uploadedDb
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name)
      );

      if (!uploadedTables.has("clients") || !uploadedTables.has("followups")) {
        return res.status(400).json({
          error: "The uploaded database backup is invalid. It must contain clients and followups tables.",
        });
      }

      const currentBackupFilename = `pre_restore_${timestamp}.db`;
      const currentBackupPath = path.join(backupDirectory, currentBackupFilename);
      db.pragma("wal_checkpoint(FULL)");
      fs.copyFileSync(dbPath, currentBackupPath);

      const currentClientColumns = getTableColumnNames(db, "clients");
      const currentFollowupColumns = getTableColumnNames(db, "followups");
      const uploadedClientColumns = getTableColumnNames(uploadedDb, "clients");
      const uploadedFollowupColumns = getTableColumnNames(uploadedDb, "followups");
      const sharedClientColumns = currentClientColumns.filter((column) => uploadedClientColumns.includes(column));
      const sharedFollowupColumns = currentFollowupColumns.filter((column) =>
        uploadedFollowupColumns.includes(column)
      );

      const uploadedClients = uploadedDb
        .prepare(`SELECT ${sharedClientColumns.map((column) => `"${column}"`).join(", ")} FROM clients ORDER BY id`)
        .all();
      const uploadedFollowups = uploadedDb
        .prepare(
          `SELECT ${sharedFollowupColumns.map((column) => `"${column}"`).join(", ")} FROM followups ORDER BY id`
        )
        .all();

      const insertClients = db.prepare(buildRowInsertStatement("clients", sharedClientColumns));
      const insertFollowups = db.prepare(buildRowInsertStatement("followups", sharedFollowupColumns));

      const restoreTransaction = db.transaction(() => {
        db.prepare("DELETE FROM followups").run();
        db.prepare("DELETE FROM clients").run();

        for (const client of uploadedClients) {
          insertClients.run(...sharedClientColumns.map((column) => client[column] ?? null));
        }

        for (const followup of uploadedFollowups) {
          insertFollowups.run(...sharedFollowupColumns.map((column) => followup[column] ?? null));
        }

        const maxClientId = db.prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM clients").get().maxId;
        const maxFollowupId = db
          .prepare("SELECT COALESCE(MAX(id), 0) AS maxId FROM followups")
          .get().maxId;
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('clients', 'followups')").run();
        db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('clients', ?)").run(maxClientId);
        db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES ('followups', ?)").run(maxFollowupId);
      });

      db.pragma("foreign_keys = OFF");
      restoreTransaction();
      db.pragma("foreign_keys = ON");
      invalidateAnalyticsCache();
      systemInfoCache.expiresAt = 0;
      systemInfoCache.value = null;
      logSystemEvent(
        "Database restore",
        "success",
        `Restored ${uploadedClients.length} clients and ${uploadedFollowups.length} follow-ups from uploaded backup. Safety backup: ${currentBackupFilename}.`
      );

      return res.json({
        success: true,
        restoredClients: uploadedClients.length,
        restoredFollowups: uploadedFollowups.length,
        safetyBackupFilename: currentBackupFilename,
      });
    } catch (error) {
      db.pragma("foreign_keys = ON");
      logSystemEvent(
        "Database restore",
        "error",
        error instanceof Error ? error.message : "Database restore failed."
      );
      return next(error);
    } finally {
      try {
        uploadedDb?.close();
      } catch {}

      if (tempRestorePath && fs.existsSync(tempRestorePath)) {
        fs.unlinkSync(tempRestorePath);
      }
    }
  }
);

app.get("/exports/system-backup.xlsx", (_req, res, next) => {
  try {
    const { buffer, filename } = buildSystemBackupWorkbookExport();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
    logSystemEvent("Workbook export", "success", `Exported ${filename}.`);
    return res.send(buffer);
  } catch (error) {
    logSystemEvent("Workbook export", "error", error instanceof Error ? error.message : "Workbook export failed.");
    return next(error);
  }
});

app.get("/sync/google-drive/status", async (_req, res, next) => {
  try {
    const state = readGoogleDriveState();
    const safeState = sanitizeGoogleDriveState(state);
    const remoteFiles = safeState.connected ? await listGoogleDriveBackupFiles() : [];
    const totalRemoteBytes = remoteFiles.reduce((sum, file) => sum + Number(file.size ?? 0), 0);

    return res.json({
      ...safeState,
      provider: "Google Drive",
      remoteFiles,
      storageUsedBytes: totalRemoteBytes,
      syncing: googleDriveSyncInProgress,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/sync/google-drive/config", (req, res) => {
  const clientId = normalizeText(req.body?.clientId);
  const clientSecret = normalizeText(req.body?.clientSecret);
  const autoSyncEnabled = Boolean(req.body?.autoSyncEnabled);
  const syncIntervalMinutes = Math.max(30, parsePositiveInteger(req.body?.syncIntervalMinutes) ?? 120);

  if (clientId) {
    setAppSetting("google_drive_client_id", clientId);
  }

  if (clientSecret) {
    setAppSetting("google_drive_client_secret", clientSecret);
  }

  const nextState = updateGoogleDriveState((currentState) => ({
    ...currentState,
    clientId: clientId || currentState.clientId,
    clientSecret: clientSecret || currentState.clientSecret,
    autoSyncEnabled,
    syncIntervalMinutes,
  }));

  scheduleGoogleDriveAutoSync();
  logSystemEvent("Google Drive config", "success", "Updated Google Drive sync settings.");
  res.json(sanitizeGoogleDriveState(nextState));
});

app.post("/sync/google-drive/connect", (req, res) => {
  const state = readGoogleDriveState();

  if (!state.clientId || !state.clientSecret) {
    return res.status(400).json({
      error: "Google OAuth client ID and client secret must be saved before connecting.",
    });
  }

  const redirectUri = `http://localhost:${getActiveBackendPort()}/sync/google-drive/callback`;
  const frontendUrl = normalizeText(req.body?.frontendUrl) || GOOGLE_DRIVE_FRONTEND_URL;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", state.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", Buffer.from(JSON.stringify({ frontendUrl }), "utf8").toString("base64url"));

  res.json({ authUrl: authUrl.toString() });
});

app.get("/sync/google-drive/callback", async (req, res) => {
  const code = normalizeText(req.query.code);
  const rawState = normalizeText(req.query.state);
  const redirectUri = `http://localhost:${getActiveBackendPort()}/sync/google-drive/callback`;
  let frontendUrl = GOOGLE_DRIVE_FRONTEND_URL;

  try {
    if (rawState) {
      const parsedState = JSON.parse(Buffer.from(rawState, "base64url").toString("utf8"));
      frontendUrl = normalizeText(parsedState.frontendUrl) || frontendUrl;
    }
  } catch {}

  if (!code) {
    return res.status(400).send("Missing Google authorization code.");
  }

  try {
    const state = readGoogleDriveState();
    if (!state.clientId || !state.clientSecret) {
      throw new Error("Google OAuth client settings are missing.");
    }

    const tokenPayload = new URLSearchParams({
      code,
      client_id: state.clientId,
      client_secret: state.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenData = await fetchJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenPayload.toString(),
    });

    const nextState = updateGoogleDriveState((currentState) => ({
      ...currentState,
      refreshToken: tokenData.refresh_token || currentState.refreshToken,
      accessToken: tokenData.access_token || "",
      accessTokenExpiresAt: Date.now() + Number(tokenData.expires_in ?? 3600) * 1000,
      connectedAt: new Date().toISOString(),
      lastSyncStatus: "idle",
    }));
    scheduleGoogleDriveAutoSync();
    logSystemEvent("Google Drive connect", "success", "Connected to Google Drive successfully.");

    return res.send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; padding: 24px;">
          <h2>Google Drive connected</h2>
          <p>You can return to the sync page now.</p>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: "google-drive-connected" }, "${frontendUrl}");
              }
            } catch (error) {}
            setTimeout(() => window.close(), 1200);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    logSystemEvent(
      "Google Drive connect",
      "error",
      error instanceof Error ? error.message : "Google Drive connection failed."
    );
    return res.status(500).send("Google Drive connection failed.");
  }
});

app.post("/sync/google-drive/disconnect", (_req, res) => {
  const nextState = updateGoogleDriveState((currentState) => ({
    ...currentState,
    refreshToken: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    folderId: "",
    connectedAt: "",
    lastSyncStatus: "idle",
  }));
  scheduleGoogleDriveAutoSync();
  logSystemEvent("Google Drive disconnect", "success", "Disconnected Google Drive sync.");
  res.json(sanitizeGoogleDriveState(nextState));
});

app.post("/sync/google-drive/sync-now", async (_req, res, next) => {
  try {
    const result = await performGoogleDriveSync("manual");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/sync/google-drive/cleanup-old-files", async (_req, res, next) => {
  try {
    const result = await deleteOldGoogleDriveBackupFiles(30);
    logSystemEvent(
      "Google Drive cleanup",
      "success",
      `Deleted ${result.deletedCount} Google Drive sync file(s) older than 30 days.`
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/sync/google-drive/files", async (_req, res, next) => {
  try {
    res.json(await listGoogleDriveBackupFiles());
  } catch (error) {
    next(error);
  }
});

app.get("/sync/google-drive/files/:fileId/download", async (req, res, next) => {
  try {
    const fileId = normalizeText(req.params.fileId);
    if (!fileId) {
      return res.status(400).json({ error: "Missing file id." });
    }

    const metadata = await googleDriveRequest(
      `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`
    );
    const buffer = await googleDriveRequest(
      `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { parseAs: "buffer" }
    );
    res.setHeader("Content-Type", metadata.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.name || "drive-backup"}"`);
    return res.send(buffer);
  } catch (error) {
    return next(error);
  }
});

app.delete("/sync/google-drive/files/:fileId", async (req, res, next) => {
  try {
    const fileId = normalizeText(req.params.fileId);
    if (!fileId) {
      return res.status(400).json({ error: "Missing file id." });
    }

    const metadata = await googleDriveRequest(
      `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name`
    );
    await googleDriveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
    });

    logSystemEvent("Google Drive file delete", "success", `Deleted ${metadata.name} from Google Drive.`);
    return res.json({ success: true, fileId, fileName: metadata.name });
  } catch (error) {
    return next(error);
  }
});

app.delete("/admin/data", (_req, res) => {
  const deleteAllRows = db.transaction(() => {
    const deletedFollowups = db.prepare("DELETE FROM followups").run().changes;
    const deletedClients = db.prepare("DELETE FROM clients").run().changes;
    return { deletedClients, deletedFollowups };
  });

  const result = deleteAllRows();
  invalidateAnalyticsCache();
  logSystemEvent(
    "Database clear",
    "success",
    `Deleted ${result.deletedClients} client rows and ${result.deletedFollowups} follow-up rows.`
  );
  return res.json({
    success: true,
    deletedClients: result.deletedClients,
    deletedFollowups: result.deletedFollowups,
  });
});

app.post("/admin/dedupe-db", async (_req, res, next) => {
  try {
    const scriptPath = path.join(scriptRoot, "scripts", "remove-db-duplicates.mjs");
    const nodeExec = getNodeExecConfig();
    const result = await new Promise((resolve, reject) => {
      execFile(nodeExec.command, [scriptPath], { cwd: projectRoot, env: nodeExec.env }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          resolve(JSON.parse(stdout || "{}"));
        } catch (parseError) {
          reject(parseError);
        }
      });
    });

    invalidateAnalyticsCache();
    logSystemEvent(
      "Database dedupe",
      "success",
      `Removed ${result.deletedClients ?? 0} duplicate client row(s) and ${result.deletedFollowups ?? 0} follow-up row(s).`
    );
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/clean-data", async (_req, res, next) => {
  try {
    const result = await runCleanupInWorker({
      all: true,
      dedupeImportedClients: false,
    });

    invalidateAnalyticsCache();
    logSystemEvent(
      "Manual cleanup",
      "success",
      `Cleaned ${result.cleanedClients ?? 0} client row(s) and ${result.cleanedFollowups ?? 0} follow-up row(s).`
    );
    return res.json({
      success: true,
      cleanedClients: result.cleanedClients ?? 0,
      cleanedFollowups: result.cleanedFollowups ?? 0,
      deletedDuplicates: result.deletedDuplicates ?? 0,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error.",
    details: error instanceof Error ? error.message : "Unknown server error.",
  });
});

let backendServerInstance = null;

export function startBackendServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? DEFAULT_PORT);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";

  if (backendServerInstance) {
    return Promise.resolve(backendServerInstance);
  }

  return new Promise((resolve) => {
    backendServerInstance = app.listen(port, host, () => {
      console.log(`Backend running on http://${host}:${port}`);
      logSystemEvent("Server", "info", `Backend running on http://${host}:${port}`);
      scheduleGoogleDriveAutoSync();
      scheduleLocalBackups();
      resolve(backendServerInstance);
    });
  });
}

function createFollowup(req, res) {
  const created = createFollowupRecord(req.body);

  if (created.error === "Client not found.") {
    return res.status(404).json({ error: created.error });
  }

  if (created.error) {
    return res.status(400).json({ error: created.error });
  }

  return res.status(201).json(created.value);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  startBackendServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
