import { useMemo, useRef, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Download,
  RefreshCw,
  Languages,
  CalendarDays,
} from "lucide-react";
import * as XLSX from "xlsx";
import { api, getErrorMessage } from "../lib/api";
import type {
  BackupImportResponse,
  ImportClientRowPayload,
  ImportClientsResponse,
  ImportFieldKey,
  LegacyImportClientBlockPayload,
  LegacyImportResponse,
  ProgramType,
} from "../lib/types";

const importFields: Array<{
  key: ImportFieldKey;
  label: string;
  required?: boolean;
}> = [
  { key: "name", label: "Name", required: true },
  { key: "age", label: "Age", required: true },
  { key: "program_type", label: "Program Type", required: true },
  { key: "starting_weight", label: "Starting Weight", required: true },
  { key: "phone", label: "Phone Number" },
  { key: "chronic_diseases", label: "Chronic Diseases" },
  { key: "target_weight", label: "Target Weight" },
];

const requiredFields = new Set(
  importFields.filter((field) => field.required).map((field) => field.key)
);

const fieldAliases: Record<ImportFieldKey, string[]> = {
  name: ["name", "client", "client name", "patient", "patient name", "full name"],
  age: ["age", "years", "patient age"],
  phone: ["phone", "mobile", "contact", "phone number", "contact number", "number"],
  program_type: ["program", "program type", "plan", "goal", "type"],
  chronic_diseases: [
    "disease",
    "diseases",
    "chronic disease",
    "chronic diseases",
    "condition",
    "chronic condition",
    "medical condition",
  ],
  starting_weight: [
    "starting weight",
    "start weight",
    "initial weight",
    "weight",
    "body weight",
    "current weight",
  ],
  target_weight: ["target weight", "goal weight", "desired weight"],
};

type MappingState = Record<string, ImportFieldKey | "ignore">;

type GenericPreviewRow = {
  rowNumber: number;
  normalized: ImportClientRowPayload;
  issues: string[];
};

type LegacyPreviewBlock = LegacyImportClientBlockPayload & {
  issues: string[];
  followupPreview: Array<{
    date: string;
    weight: string | number;
    treatment?: string;
  }>;
};

type ImportMode = "generic" | "legacy" | "backup" | null;
const LEGACY_BATCH_SIZE = 500;
const SYSTEM_BACKUP_FORMAT = "pharmacy_system_backup";
const SYSTEM_BACKUP_VERSION = 1;

type ProcessingState = {
  label: string;
  current: number;
  total: number;
  percent: number;
  phase: "preparing" | "uploading" | "processing" | "completed";
};

const arabicDigitMap: Record<string, string> = {
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

const legacyWeightLossAliases = ["سمنة", "سمنه", "تخسيس", "تنحيف", "نزول وزن", "خفض وزن"];
const legacyWeightGainAliases = ["نحافة", "نحافه", "زيادة وزن", "زياده وزن", "تسمين", "فتح شهيه"];

function normalizeArabicDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => arabicDigitMap[digit] ?? digit);
}

function normalizeArabicKey(value: string) {
  return normalizeArabicDigits(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function findLegacyProgram(value: string): ProgramType | null {
  const normalized = normalizeArabicKey(value);

  if (legacyWeightLossAliases.some((alias) => normalized.includes(normalizeArabicKey(alias)))) {
    return "Weight Loss";
  }

  if (legacyWeightGainAliases.some((alias) => normalized.includes(normalizeArabicKey(alias)))) {
    return "Weight Gain";
  }

  return null;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSystemHeader(value: string) {
  return normalizeHeader(value).replace(/\s+/g, "_");
}

function inferField(header: string): ImportFieldKey | "ignore" {
  const normalized = normalizeHeader(header);

  for (const field of importFields) {
    if (fieldAliases[field.key].some((alias) => normalized === alias || normalized.includes(alias))) {
      return field.key;
    }
  }

  return "ignore";
}

function normalizeProgram(value: string | undefined) {
  const normalized = normalizeArabicKey(value ?? "");

  if (!normalized) {
    return "";
  }

  if (
    normalized.includes("loss") ||
    normalized === "wl" ||
    normalized === "lose" ||
    normalized === "weightloss"
  ) {
    return "Weight Loss";
  }

  if (
    normalized.includes("gain") ||
    normalized === "wg" ||
    normalized === "bulk" ||
    normalized === "weightgain"
  ) {
    return "Weight Gain";
  }

  return value?.trim() ?? "";
}

function normalizeClientName(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(text)) {
    return "";
  }

  return text.replace(/\s+/g, " ").trim();
}

function normalizeChronicDiseaseImport(value: unknown) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (!/[A-Za-z\u0600-\u06FF]/.test(text)) {
    return "";
  }

  return text;
}

function normalizeGenericRow(
  row: Record<string, string>,
  mapping: MappingState
): ImportClientRowPayload {
  const normalized: ImportClientRowPayload = {};

  for (const [header, mappedField] of Object.entries(mapping)) {
    if (mappedField === "ignore") {
      continue;
    }

    const value = row[header];
    if (!value) {
      continue;
    }

    if (mappedField === "name") {
      normalized.name = normalizeClientName(value);
      continue;
    }

    if (mappedField === "program_type") {
      normalized.program_type = normalizeProgram(value);
      continue;
    }

    if (mappedField === "chronic_diseases") {
      normalized.chronic_diseases = normalizeChronicDiseaseImport(value);
      continue;
    }

    normalized[mappedField] = value.trim();
  }

  return normalized;
}

function getClientIssues(normalized: ImportClientRowPayload) {
  const issues: string[] = [];

  for (const field of requiredFields) {
    const value = normalized[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      const label = importFields.find((item) => item.key === field)?.label ?? field;
      issues.push(`Missing ${label}`);
    }
  }

  if (!normalized.name) {
    issues.push("Client name must contain real Arabic or English text");
  }

  const age = normalized.age === undefined ? null : Number(normalized.age);
  if (normalized.age !== undefined && (!Number.isInteger(age) || age <= 0)) {
    issues.push("Age must be a positive integer");
  }

  const startingWeight =
    normalized.starting_weight === undefined ? null : Number(normalized.starting_weight);
  if (
    normalized.starting_weight !== undefined &&
    (!Number.isFinite(startingWeight) || startingWeight <= 0)
  ) {
    issues.push("Starting Weight must be a positive number");
  }

  const targetWeight =
    normalized.target_weight === undefined ? null : Number(normalized.target_weight);
  if (
    normalized.target_weight !== undefined &&
    String(normalized.target_weight).trim() !== "" &&
    (!Number.isFinite(targetWeight) || targetWeight <= 0)
  ) {
    issues.push("Target Weight must be a positive number");
  }

  if (
    normalized.program_type &&
    normalized.program_type !== "Weight Loss" &&
    normalized.program_type !== "Weight Gain"
  ) {
    issues.push('Program Type should resolve to "Weight Loss" or "Weight Gain"');
  }

  return issues;
}

function isLegacyWorkbook(workbook: XLSX.WorkBook) {
  const legacySheet = workbook.SheetNames.some((name) => findLegacyProgram(name));

  if (legacySheet) {
    return true;
  }

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(firstSheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: "",
  });
  const candidateRows = rows.slice(0, 8).map((row) => row.map((value) => normalizeArabicKey(String(value))));

  return candidateRows.some(
    (row) =>
      row.includes(normalizeArabicKey("الاسم")) &&
      row.includes(normalizeArabicKey("السن"))
  );
}

function getProgramFromSheetName(sheetName: string): ProgramType | null {
  return findLegacyProgram(sheetName);
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function parseWeightValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  const text = normalizeArabicDigits(normalizeText(value));
  if (!text) {
    return null;
  }

  const compact = text.replace(/\s+/g, "");
  if (!/^-?\d+(\.\d+)?(kg|كيلو|كجم)?$/i.test(compact)) {
    return null;
  }

  const match = compact.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function toIsoDate(value: unknown) {
  if (typeof value === "number") {
    if (value < 20000) {
      return null;
    }

    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) {
      return null;
    }

    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const normalizedText = normalizeArabicDigits(text).replace(/\s+/g, "");

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedText)) {
    return normalizedText;
  }

  const cleanedDateText = normalizedText.replace(/\.+(?=\d)/g, "").replace(/\/\./g, "/");
  const slashMatch = cleanedDateText.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3].length === 2 ? `20${slashMatch[3]}` : slashMatch[3]);

    if (day > 0 && month > 0 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

function findLegacyHeaderRow(rows: Array<Array<unknown>>) {
  const nameKey = normalizeArabicKey("الاسم");
  const ageKey = normalizeArabicKey("السن");

  return rows.findIndex((row) => {
    const normalized = row.map((value) => normalizeArabicKey(String(value ?? "")));
    return normalized.includes(nameKey) && normalized.includes(ageKey);
  });
}

function getLegacyColumnIndex(headerRow: Array<unknown>, labels: string[]) {
  const normalizedHeader = headerRow.map((value) => normalizeArabicKey(String(value ?? "")));
  return normalizedHeader.findIndex((cell) =>
    labels.some((label) => cell.includes(normalizeArabicKey(label)))
  );
}

function getDateScore(row: Array<unknown>, startColumnIndex: number) {
  let score = 0;

  for (let columnIndex = startColumnIndex; columnIndex < row.length; columnIndex += 1) {
    if (toIsoDate(row[columnIndex])) {
      score += 1;
    }
  }

  return score;
}

function getWeightScore(row: Array<unknown>, startColumnIndex: number) {
  let score = 0;

  for (let columnIndex = startColumnIndex; columnIndex < row.length; columnIndex += 1) {
    const weight = parseWeightValue(row[columnIndex]);
    if (weight !== null && weight >= 20 && weight <= 400) {
      score += 1;
    }
  }

  return score;
}

function findDateInColumn(rows: Array<Array<unknown>>, columnIndex: number) {
  for (const row of rows) {
    const date = toIsoDate(row[columnIndex]);
    if (date) {
      return date;
    }
  }

  return null;
}

function findWeightInColumn(rows: Array<Array<unknown>>, columnIndex: number) {
  for (const row of rows) {
    const weight = parseWeightValue(row[columnIndex]);
    if (weight !== null && weight >= 20 && weight <= 400) {
      return weight;
    }
  }

  return null;
}

function findTreatmentInColumn(rows: Array<Array<unknown>>, columnIndex: number) {
  for (const row of rows) {
    const text = normalizeText(row[columnIndex]);
    if (!text) {
      continue;
    }

    if (toIsoDate(text)) {
      continue;
    }

    if (parseWeightValue(text) !== null) {
      continue;
    }

    return text;
  }

  return undefined;
}

function pickMetadataValue(
  rows: Array<Array<unknown>>,
  columnIndex: number,
  fallbackIndex: number
) {
  if (columnIndex < 0) {
    return "";
  }

  for (const row of rows) {
    const value = normalizeText(row[columnIndex]);
    if (value) {
      return value;
    }
  }

  return normalizeText(rows[0]?.[fallbackIndex]) || "";
}

function parseLegacyWorkbook(workbook: XLSX.WorkBook) {
  const blocks: LegacyPreviewBlock[] = [];

  workbook.SheetNames.forEach((sheetName) => {
    const program = getProgramFromSheetName(sheetName);
    if (!program) {
      return;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<unknown>>(sheet, {
      header: 1,
      raw: true,
      blankrows: false,
      defval: "",
    });

    if (rows.length <= 1) {
      return;
    }

    const headerRowIndex = findLegacyHeaderRow(rows);
    const headerRow = headerRowIndex >= 0 ? rows[headerRowIndex] ?? [] : [];
    const nameColumnIndex = Math.max(0, getLegacyColumnIndex(headerRow, ["الاسم", "اسم", "الاسم بالكامل"]));
    const ageColumnIndex = getLegacyColumnIndex(headerRow, ["السن", "العمر"]);
    const statusColumnIndex = getLegacyColumnIndex(headerRow, ["الحاله", "الحالة", "النوع", "status"]);
    const notesColumnIndex = getLegacyColumnIndex(headerRow, ["ملاحظات", "ملاحظه", "ملاحظات العميل"]);
    const firstFollowupColumnIndex = [nameColumnIndex, ageColumnIndex, statusColumnIndex, notesColumnIndex]
      .filter((index) => index >= 0)
      .reduce((max, index) => Math.max(max, index), 3) + 1;

    let blockNumber = 0;
    for (let rowIndex = Math.max(headerRowIndex + 1, 1); rowIndex < rows.length; rowIndex += 1) {
      const blockRows = [
        rows[rowIndex] ?? [],
        rows[rowIndex + 1] ?? [],
        rows[rowIndex + 2] ?? [],
      ];
      const [topRow, nextRow, thirdRow] = blockRows;

      const name = pickMetadataValue(blockRows, nameColumnIndex, 0);
      const ageRaw = pickMetadataValue(blockRows, ageColumnIndex, 1);
      const age = ageRaw ? normalizeArabicDigits(ageRaw) : "";
      const statusLabel = pickMetadataValue(blockRows, statusColumnIndex, 2);
      const clientNotes = pickMetadataValue(blockRows, notesColumnIndex, 3);

      if (!name) {
        continue;
      }

      blockNumber += 1;

      const followupPreview: LegacyPreviewBlock["followupPreview"] = [];
      const maxColumns = Math.max(topRow.length, nextRow.length, thirdRow.length);

      for (let columnIndex = firstFollowupColumnIndex; columnIndex < maxColumns; columnIndex += 1) {
        const date = findDateInColumn(blockRows, columnIndex);
        const weight = findWeightInColumn(blockRows, columnIndex);
        const treatment = findTreatmentInColumn(blockRows, columnIndex);

        if (!date || weight === null) {
          continue;
        }

        followupPreview.push({
          date,
          weight,
          treatment: treatment || undefined,
        });
      }

      followupPreview.sort((left, right) => left.date.localeCompare(right.date));

      const client: ImportClientRowPayload = {
        name: normalizeClientName(name),
        age,
        program_type: program,
        starting_weight:
          followupPreview.length > 0 ? String(followupPreview[0].weight) : "",
      };

      const issues = getClientIssues(client);
      if (followupPreview.length === 0) {
        issues.push("No valid follow-up columns were detected");
      }

      if (nextRow.length === 0 || thirdRow.length === 0) {
        issues.push("Client block is incomplete and does not contain 3 rows");
      }

      blocks.push({
        sheetName,
        blockNumber,
        client,
        clientNotes: clientNotes || undefined,
        statusLabel: statusLabel || undefined,
        followups: followupPreview,
        followupPreview,
        issues,
      });

      rowIndex += 2;
    }
  });

  return blocks;
}

function isSystemBackupWorkbook(workbook: XLSX.WorkBook) {
  const metadataSheetName = workbook.SheetNames.find(
    (name) => normalizeHeader(name) === "backup metadata"
  );

  if (metadataSheetName) {
    const metadataSheet = workbook.Sheets[metadataSheetName];
    const metadataRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(metadataSheet, {
      defval: "",
      raw: true,
    });
    const metadata = Object.fromEntries(
      metadataRows.map((row) => [normalizeSystemHeader(String(row.key ?? "")), normalizeText(row.value)])
    );

    if (
      normalizeSystemHeader(String(metadata.format ?? "")) === SYSTEM_BACKUP_FORMAT &&
      Number(metadata.version) >= SYSTEM_BACKUP_VERSION
    ) {
      return true;
    }
  }

  const normalizedSheetNames = workbook.SheetNames.map((name) => normalizeHeader(name));
  if (!normalizedSheetNames.includes("clients") || !normalizedSheetNames.includes("followups")) {
    return false;
  }

  const clientsSheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === "clients");
  const followupsSheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === "followups");

  if (!clientsSheetName || !followupsSheetName) {
    return false;
  }

  const clientsPreview = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[clientsSheetName], {
    defval: "",
    raw: true,
  });
  const followupsPreview = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[followupsSheetName],
    {
      defval: "",
      raw: true,
    }
  );

  if (clientsPreview.length === 0) {
    return false;
  }

  const normalizedClientHeaders = new Set(
    Object.keys(clientsPreview[0] ?? {}).map((header) => normalizeSystemHeader(header))
  );
  const normalizedFollowupHeaders = new Set(
    Object.keys(followupsPreview[0] ?? {}).map((header) => normalizeSystemHeader(header))
  );

  return (
    normalizedClientHeaders.has("client_backup_id") &&
    normalizedClientHeaders.has("name") &&
    normalizedClientHeaders.has("program_type") &&
    normalizedFollowupHeaders.has("client_backup_id") &&
    normalizedFollowupHeaders.has("date") &&
    normalizedFollowupHeaders.has("weight")
  );
}

function buildBlockDuplicateSignature(block: LegacyImportClientBlockPayload) {
  return JSON.stringify({
    name: normalizeArabicKey(String(block.client.name ?? "")),
    age: String(block.client.age ?? ""),
    phone: normalizeArabicKey(String(block.client.phone ?? "")),
    program: normalizeArabicKey(String(block.client.program_type ?? "")),
    startingWeight: String(block.client.starting_weight ?? ""),
    targetWeight: String(block.client.target_weight ?? ""),
    chronicDiseases: normalizeArabicKey(String(block.client.chronic_diseases ?? "")),
    followups: [...block.followups]
      .map((followup) => ({
        date: followup.date,
        weight: String(followup.weight),
        treatment: normalizeArabicKey(String(followup.treatment ?? "")),
      }))
      .sort((left, right) =>
        `${left.date}|${left.weight}|${left.treatment}`.localeCompare(
          `${right.date}|${right.weight}|${right.treatment}`
        )
      ),
  });
}

function parseBackupWorkbook(workbook: XLSX.WorkBook) {
  const clientsSheetName =
    workbook.SheetNames.find((name) => normalizeHeader(name) === "clients") ?? workbook.SheetNames[0];
  const followupsSheetName =
    workbook.SheetNames.find((name) => normalizeHeader(name) === "followups") ?? workbook.SheetNames[1];

  const clientsSheet = workbook.Sheets[clientsSheetName];
  const followupsSheet = workbook.Sheets[followupsSheetName];

  const clientRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(clientsSheet, {
    defval: "",
    raw: true,
  });
  const followupRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(followupsSheet, {
    defval: "",
    raw: true,
  });

  const clientsByKey = new Map<
    string,
    {
      block: LegacyPreviewBlock;
      clientRowIndex: number;
    }
  >();

  clientRows.forEach((row, index) => {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [normalizeSystemHeader(key), value])
    );

    const backupKey = normalizeText(
      normalized.client_backup_id ?? normalized.backup_key ?? normalized.client_key ?? normalized.id
    );
    if (!backupKey) {
      return;
    }

    const client: ImportClientRowPayload = {
      name: normalizeClientName(normalized.name),
      age: normalizeText(normalized.age),
      phone: normalizeText(normalized.phone),
      program_type: normalizeProgram(normalizeText(normalized.program_type) ?? undefined),
      chronic_diseases: normalizeChronicDiseaseImport(normalized.chronic_diseases),
      starting_weight: normalizeText(normalized.starting_weight),
      target_weight: normalizeText(normalized.target_weight),
    };

    clientsByKey.set(backupKey, {
      clientRowIndex: index + 2,
      block: {
        sheetName: "Clients",
        blockNumber: index + 1,
        client,
        clientNotes: normalizeText(normalized.client_notes ?? normalized.notes) || undefined,
        statusLabel: normalizeText(normalized.status_label ?? normalized.status) || undefined,
        followups: [],
        followupPreview: [],
        issues: getClientIssues(client),
      },
    });
  });

  followupRows.forEach((row) => {
    const normalized = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [normalizeSystemHeader(key), value])
    );

    const backupKey = normalizeText(
      normalized.client_backup_id ?? normalized.backup_key ?? normalized.client_key ?? normalized.client_id
    );
    if (!backupKey) {
      return;
    }

    const clientEntry = clientsByKey.get(backupKey);

    if (!clientEntry) {
      return;
    }

    const date = toIsoDate(normalized.date);
    const weight = parseWeightValue(normalized.weight);
    if (!date || weight === null) {
      return;
    }

    const followup = {
      date,
      weight,
      treatment:
        normalizeText(normalized.treatment ?? normalized.medicine_name ?? normalized.medicine_taken) ||
        undefined,
    };
    clientEntry.block.followups.push(followup);
    clientEntry.block.followupPreview.push(followup);
  });

  const blocks = Array.from(clientsByKey.values())
    .sort((left, right) => left.clientRowIndex - right.clientRowIndex)
    .map(({ block }) => {
      block.followups.sort((left, right) => left.date.localeCompare(right.date));
      block.followupPreview = [...block.followups];
      block.client.starting_weight =
        block.followups.length > 0 ? String(block.followups[0].weight) : block.client.starting_weight ?? "";

      if (block.followups.length === 0) {
        block.issues = [...block.issues, "No valid follow-ups were found for this backup client"];
      }

      block.issues = getClientIssues(block.client).concat(
        block.issues.filter((issue, index, all) => all.indexOf(issue) === index)
      );

      return block;
    });

  return blocks;
}

function downloadTemplate() {
  const rows = [
    ["Name", "Age", "Program Type", "Starting Weight", "Phone Number", "Chronic Diseases", "Target Weight"],
    ["John Smith", "45", "Weight Loss", "95.5", "+1 (555) 111-2222", "Diabetes", "82"],
    ["Emily Davis", "32", "Weight Gain", "52.0", "+1 (555) 333-4444", "", "60"],
  ];

  const csv = rows.map((row) => row.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pharmacy_clients_import_template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBackupTemplate() {
  const metadataSheet = XLSX.utils.json_to_sheet([
    { key: "format", value: SYSTEM_BACKUP_FORMAT },
    { key: "version", value: SYSTEM_BACKUP_VERSION },
    { key: "description", value: "Upload this workbook using the dedicated System Backup uploader." },
  ]);
  const clientsSheet = XLSX.utils.json_to_sheet([
    {
      client_backup_id: "WL-001",
      name: "John Smith",
      age: 45,
      phone: "+1 (555) 111-2222",
      program_type: "Weight Loss",
      chronic_diseases: "Diabetes",
      starting_weight: 95.5,
      target_weight: 82,
      client_notes: "Imported from backup",
      status_label: "Mr",
    },
  ]);

  const followupsSheet = XLSX.utils.json_to_sheet([
    {
      client_backup_id: "WL-001",
      client_name: "John Smith",
      client_age: 45,
      program_type: "Weight Loss",
      date: "2024-01-10",
      weight: 95.5,
      treatment: "Imported treatment note",
      adherence_status: "Imported",
      notes: "First backup follow-up",
    },
    {
      client_backup_id: "WL-001",
      client_name: "John Smith",
      client_age: 45,
      program_type: "Weight Loss",
      date: "2024-02-14",
      weight: 92.8,
      treatment: "",
      adherence_status: "Imported",
      notes: "Second backup follow-up",
    },
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, metadataSheet, "Backup Metadata");
  XLSX.utils.book_append_sheet(workbook, clientsSheet, "Clients");
  XLSX.utils.book_append_sheet(workbook, followupsSheet, "Followups");
  XLSX.writeFile(workbook, "pharmacy_system_backup_template.xlsx");
}

function buildLegacyRequestBlocks(blocks: LegacyPreviewBlock[]) {
  return blocks.map((block) => ({
    sheetName: block.sheetName,
    blockNumber: block.blockNumber,
    client: block.client,
    clientNotes: block.clientNotes,
    statusLabel: block.statusLabel,
    followups: block.followups,
  }));
}

function shouldSendLegacyInSingleRequest(blocks: LegacyPreviewBlock[]) {
  return blocks.length > 0;
}

export function ImportData() {
  const generalFileInputRef = useRef<HTMLInputElement | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>(null);
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = useState<MappingState>({});
  const [legacyBlocks, setLegacyBlocks] = useState<LegacyPreviewBlock[]>([]);
  const [importing, setImporting] = useState(false);
  const [genericResult, setGenericResult] = useState<ImportClientsResponse | null>(null);
  const [legacyResult, setLegacyResult] = useState<BackupImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState | null>(null);

  const genericPreviewRows = useMemo<GenericPreviewRow[]>(() => {
    return rows.map((row, index) => {
      const normalized = normalizeGenericRow(row, mapping);
      return {
        rowNumber: index + 1,
        normalized,
        issues: getClientIssues(normalized),
      };
    });
  }, [mapping, rows]);

  const validGenericRows = useMemo(
    () => genericPreviewRows.filter((row) => row.issues.length === 0).map((row) => row.normalized),
    [genericPreviewRows]
  );

  const validLegacyBlocks = useMemo(
    () => legacyBlocks.filter((block) => block.issues.length === 0),
    [legacyBlocks]
  );

  const genericImportReadyCount = validGenericRows.length;
  const legacyImportReadyCount = validLegacyBlocks.length;
  const showProcessingOverlay = importing;
  const processingTitle = "Importing your workbook";
  const processingPhase = processingState?.phase ?? "preparing";
  const processingSubtitle =
    processingPhase === "processing"
      ? "Upload finished. The server is still storing the data now, so please keep this window open."
      : importing
      ? "The file is uploading now. When upload completes, the server will continue inserting the data."
      : "";

  const mappedRequiredCount = useMemo(() => {
    const mappedFields = new Set(Object.values(mapping).filter((value) => value !== "ignore"));
    return Array.from(requiredFields).filter((field) => mappedFields.has(field)).length;
  }, [mapping]);
  const processingPercent = Math.round(processingState?.percent ?? 0);
  const displayedProcessingPercent = processingPhase === "processing" ? 100 : processingPercent;
  const processingSteps = [
    { key: "upload", label: "Upload", active: processingPercent > 0 || processingPhase !== "preparing" },
    { key: "validate", label: "Validate", active: processingPercent >= 25 || processingPhase === "processing" || processingPhase === "completed" },
    { key: "insert", label: "Insert", active: processingPercent >= 60 || processingPhase === "processing" || processingPhase === "completed" },
    { key: "finish", label: "Finish", active: processingPhase === "completed" },
  ];
  const processingModeLabel =
    importMode === "backup"
      ? "System backup workbook"
      : importMode === "legacy"
      ? "Arabic legacy workbook"
      : "Flat spreadsheet";

  function updateProcessingState(
    label: string,
    current: number,
    total: number,
    loadedFraction = 0,
    phase: ProcessingState["phase"] = "uploading"
  ) {
    const safeTotal = Math.max(total, 1);
    const boundedCurrent = Math.min(Math.max(current + loadedFraction, 0), safeTotal);
    setProcessingState({
      label,
      current: Math.min(Math.ceil(boundedCurrent), safeTotal),
      total: safeTotal,
      percent: Math.max(0, Math.min(100, (boundedCurrent / safeTotal) * 100)),
      phase,
    });
  }

  function setServerProcessingState(label: string, total: number) {
    const safeTotal = Math.max(total, 1);
    setProcessingState({
      label,
      current: safeTotal,
      total: safeTotal,
      percent: 100,
      phase: "processing",
    });
  }

  async function processSelectedFile(file: File, forcedMode: "auto" | "backup" = "auto") {
    if (!file) {
      return;
    }

    setError(null);
    setGenericResult(null);
    setLegacyResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", cellDates: false, cellNF: true, cellText: true });

      setFileName(file.name);
      setFileSize(file.size);

      if (forcedMode === "backup" || isSystemBackupWorkbook(workbook)) {
        if (!isSystemBackupWorkbook(workbook)) {
          setError("This file is not a valid system backup workbook. It must contain Clients and Followups sheets.");
          return;
        }

        const blocks = parseBackupWorkbook(workbook);
        if (blocks.length === 0) {
          setError("No backup client rows were detected in this workbook.");
          return;
        }

        setImportMode("backup");
        setLegacyBlocks(blocks);
        setHeaders([]);
        setRows([]);
        setMapping({});
        return;
      }

      if (isLegacyWorkbook(workbook)) {
        const blocks = parseLegacyWorkbook(workbook);
        if (blocks.length === 0) {
          setError("No Arabic legacy client blocks were detected in this workbook.");
          return;
        }

        setImportMode("legacy");
        setLegacyBlocks(blocks);
        setHeaders([]);
        setRows([]);
        setMapping({});
        return;
      }

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: "",
      });

      if (jsonRows.length === 0) {
        setError("The selected file does not contain any data rows.");
        return;
      }

      const extractedHeaders = Object.keys(jsonRows[0] ?? {});
      const parsedRows = jsonRows.map((row) =>
        Object.fromEntries(
          extractedHeaders.map((header) => [header, String(row[header] ?? "").trim()])
        )
      );

      setImportMode("generic");
      setHeaders(extractedHeaders);
      setRows(parsedRows);
      setMapping(
        Object.fromEntries(extractedHeaders.map((header) => [header, inferField(header)]))
      );
      setLegacyBlocks([]);
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, "Unable to read the selected file."));
    }
  }

  async function handleFileUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    forcedMode: "auto" | "backup" = "auto"
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await processSelectedFile(file, forcedMode);
    event.target.value = "";
  }

  async function handleImport() {
    setImporting(true);
    setError(null);

    try {
      if (importMode === "legacy" || importMode === "backup") {
        if (validLegacyBlocks.length === 0) {
          setError(
            importMode === "backup"
              ? "There are no valid backup client blocks ready to import."
              : "There are no valid Arabic client blocks ready to import."
          );
          return;
        }

        updateProcessingState("Preparing import", 0, validLegacyBlocks.length, 0, "preparing");
        const response = await api.post<BackupImportResponse>(
          importMode === "backup" ? "/imports/system-backup" : "/imports/legacy-arabic",
          {
            blocks: buildLegacyRequestBlocks(validLegacyBlocks),
          },
          {
            onUploadProgress: (progressEvent) => {
              const loadedFraction =
                progressEvent.total && progressEvent.total > 0
                  ? progressEvent.loaded / progressEvent.total
                  : 0;
              if (loadedFraction >= 1) {
                setServerProcessingState("Upload complete. Server is storing imported blocks", validLegacyBlocks.length);
                return;
              }
              updateProcessingState(
                "Uploading all blocks",
                0,
                validLegacyBlocks.length,
                loadedFraction * validLegacyBlocks.length,
                "uploading"
              );
            },
          }
        );

        setServerProcessingState("Server is storing imported blocks", validLegacyBlocks.length);
        updateProcessingState(
          `Processed ${validLegacyBlocks.length} of ${validLegacyBlocks.length} blocks`,
          validLegacyBlocks.length,
          validLegacyBlocks.length,
          0,
          "completed"
        );
        setLegacyResult(response.data);
        return;
      }

      if (validGenericRows.length === 0) {
        setError("There are no valid rows to import yet.");
        return;
      }

      updateProcessingState("Uploading client rows", 0, validGenericRows.length, 0, "preparing");
      const response = await api.post<ImportClientsResponse>(
        "/imports/clients",
        {
          rows: validGenericRows,
        },
        {
            onUploadProgress: (progressEvent) => {
              const loadedFraction =
              progressEvent.total && progressEvent.total > 0
                ? progressEvent.loaded / progressEvent.total
                : 0;
            if (loadedFraction >= 1) {
              setServerProcessingState("Upload complete. Server is storing imported rows", validGenericRows.length);
              return;
            }
            updateProcessingState(
              "Uploading client rows",
              0,
              validGenericRows.length,
              loadedFraction * validGenericRows.length,
              "uploading"
            );
          },
        }
      );
      setServerProcessingState("Server is storing imported rows", validGenericRows.length);
      updateProcessingState(
        "Finishing import",
        validGenericRows.length,
        validGenericRows.length,
        0,
        "completed"
      );
      setGenericResult(response.data);
    } catch (importError) {
      setError(getErrorMessage(importError, "Unable to complete the import."));
    } finally {
      setImporting(false);
      setProcessingState(null);
    }
  }

  function resetImport() {
    setImportMode(null);
    setFileName("");
    setFileSize(0);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setLegacyBlocks([]);
    setGenericResult(null);
    setLegacyResult(null);
    setProcessingState(null);
    setError(null);
  }

  return (
    <div className="p-8">
      {showProcessingOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/65 p-4 backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-16 top-12 h-56 w-56 rounded-full bg-sky-500/20 blur-3xl animate-pulse" />
            <div className="absolute bottom-8 right-0 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl animate-pulse" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          </div>

          <div className="relative w-full max-w-3xl overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(145deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.96))] p-8 text-white shadow-2xl">
            <div className="pointer-events-none absolute inset-0 opacity-40">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(34,197,94,0.18),_transparent_28%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:34px_34px]" />
            </div>

            <div className="relative mb-6 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">
              {importing ? "Import In Progress" : "Preparing Import"}
            </div>

            <div className="relative grid gap-8 lg:grid-cols-[220px_1fr] lg:items-center">
              <div className="flex flex-col items-center justify-center">
                <div
                  className="relative flex h-44 w-44 items-center justify-center rounded-full border border-white/10 shadow-[0_0_40px_rgba(56,189,248,0.15)]"
                  style={{
                    background: `conic-gradient(#38bdf8 0deg, #22c55e ${(displayedProcessingPercent / 100) * 360}deg, rgba(255,255,255,0.08) ${(displayedProcessingPercent / 100) * 360}deg 360deg)`,
                  }}
                >
                  <div className="absolute inset-[14px] rounded-full bg-slate-950/90" />
                  <div className="relative text-center">
                    <div className="text-4xl font-semibold tabular-nums">
                      {processingPhase === "processing" ? "100%" : `${processingPercent}%`}
                    </div>
                    <div className="mt-2 text-xs uppercase tracking-[0.22em] text-slate-400">
                      {processingPhase === "processing" ? "Uploaded" : "Completed"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-sm text-slate-400">
                  {processingState ? `${processingState.current} / ${processingState.total}` : ""}
                </div>
                {processingPhase === "processing" && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-200">
                    <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-amber-300" />
                    Server still storing data
                  </div>
                )}
              </div>

              <div>
                <h2 className="mb-3 text-3xl font-semibold">{processingTitle}</h2>
                <p className="mb-6 max-w-xl text-sm leading-7 text-slate-300">{processingSubtitle}</p>

                <div className="mb-4 flex flex-wrap gap-2">
                  {processingSteps.map((step) => (
                    <div
                      key={step.key}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${
                        step.active
                          ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                    >
                      {step.label}
                    </div>
                  ))}
                </div>

                <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
                  <span>{processingState?.label ?? "Working..."}</span>
                  <span className="tabular-nums">
                    {processingPhase === "processing" ? "Waiting for server" : `${processingPercent}%`}
                  </span>
                </div>
                <div className="mb-6 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="relative h-3 rounded-full bg-[linear-gradient(90deg,_#38bdf8,_#22c55e)] transition-all duration-500"
                    style={{ width: `${displayedProcessingPercent}%` }}
                  >
                    <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.35),transparent)]" />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">File</div>
                    <div className="font-medium">{fileName || "Current workbook"}</div>
                    <div className="mt-2 text-xs text-slate-400">
                      {fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : "Live selection"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Mode</div>
                    <div className="font-medium">{processingModeLabel}</div>
                    <div className="mt-2 text-xs text-slate-400">Real-time upload progress</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Strategy</div>
                    <div className="font-medium">Import all valid data</div>
                    <div className="mt-2 text-xs text-slate-400">Server confirms each request</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">File</div>
                <div className="font-medium truncate">{fileName || "Current workbook"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Current Step</div>
                <div className="font-medium">{processingState?.label ?? "Working..."}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-400">Items</div>
                <div className="font-medium tabular-nums">
                  {processingState ? `${processingState.current} of ${processingState.total}` : "-"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.14),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.94),_rgba(246,251,255,0.98))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.2),_transparent_34%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-primary mb-3">
            Flexible Import
          </div>
          <h1 className="text-4xl font-semibold mb-3">Import Data</h1>
          <p className="text-muted-foreground text-base leading-7">
            The importer now supports both simple tables and your Arabic legacy workbook format with
            two program sheets and 3-row client blocks.
          </p>
        </div>
      </div>

      {error && <div className="mb-6 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="bg-card rounded-[26px] p-8 border border-border shadow-sm">
            <div className="text-center">
              {!importMode ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => generalFileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-2xl p-12 hover:border-primary transition-colors bg-[linear-gradient(180deg,_rgba(46,125,255,0.04),_transparent_55%)]"
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <Upload className="w-8 h-8 text-primary" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold mb-2">Upload Spreadsheet</div>
                        <div className="text-sm text-muted-foreground mb-4">
                          Generic sheets and Arabic legacy workbooks are detected automatically
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Supported formats: .xlsx, .xls, .csv
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => backupFileInputRef.current?.click()}
                    className="border-2 border-dashed border-emerald-300/60 rounded-2xl p-12 hover:border-emerald-500 transition-colors bg-[linear-gradient(180deg,_rgba(16,185,129,0.08),_transparent_55%)]"
                  >
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                      </div>
                      <div>
                        <div className="text-lg font-semibold mb-2">Upload System Backup</div>
                        <div className="text-sm text-muted-foreground mb-4">
                          Use this only for the ideal workbook exported by this system
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Required sheets: Clients + Followups
                        </div>
                      </div>
                    </div>
                  </button>

                  <input
                    ref={generalFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) => void handleFileUpload(event, "auto")}
                    className="hidden"
                  />
                  <input
                    ref={backupFileInputRef}
                    type="file"
                    accept=".xlsx"
                    onChange={(event) => void handleFileUpload(event, "backup")}
                    className="hidden"
                  />
                </div>
              ) : (
                <div className="border border-border rounded-2xl p-8 bg-accent/40">
                  <div className="flex items-center justify-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-full bg-secondary/10 flex items-center justify-center">
                      <FileSpreadsheet className="w-8 h-8 text-secondary" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold mb-1">{fileName}</div>
                      <div className="text-sm text-muted-foreground">
                        {(fileSize / 1024).toFixed(1)} KB •{" "}
                        {importMode === "legacy" || importMode === "backup"
                          ? `${legacyBlocks.length} detected client block${legacyBlocks.length === 1 ? "" : "s"}`
                          : `${rows.length} detected row${rows.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </div>
                  <button onClick={resetImport} className="text-sm text-primary hover:underline">
                    Choose different file
                  </button>
                </div>
              )}
            </div>
          </div>

          {(importMode === "legacy" || importMode === "backup") && (
            <>
              <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-xl font-semibold">Fast Import Mode</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      This mode imports every valid block directly. Duplicate checking and cleanup are intentionally skipped for speed.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div className="rounded-xl border border-border p-4">
                    <div className="text-sm text-muted-foreground">Valid Blocks</div>
                    <div className="text-2xl font-semibold text-secondary">{validLegacyBlocks.length}</div>
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <div className="text-sm text-muted-foreground">Detected Blocks</div>
                    <div className="text-2xl font-semibold text-primary">{legacyBlocks.length}</div>
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <div className="text-sm text-muted-foreground">Need Review</div>
                    <div className="text-2xl font-semibold text-orange-600">
                      {legacyBlocks.length - validLegacyBlocks.length}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-primary bg-primary/5 p-5">
                  <div className="font-semibold mb-1">Import all valid blocks</div>
                  <div className="text-sm text-muted-foreground">
                    Only invalid blocks are blocked. Existing duplicates and cleanup are left to manual DB work later.
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">
                      {importMode === "backup" ? "System Backup Workbook Preview" : "Arabic Legacy Workbook Preview"}
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {legacyImportReadyCount} block{legacyImportReadyCount === 1 ? "" : "s"} ready to import,{" "}
                      {legacyBlocks.length - validLegacyBlocks.length} need review
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm text-primary">
                    <Languages className="w-4 h-4" />
                    {importMode === "backup" ? "Backup Workbook Mode" : "Legacy Arabic Mode"}
                  </div>
                </div>

                <div className="space-y-4">
                  {legacyBlocks.slice(0, 10).map((block) => (
                    <div key={`${block.sheetName}-${block.blockNumber}`} className="rounded-2xl border border-border p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="font-semibold">{block.client.name || "Unnamed client"}</div>
                          <div className="text-sm text-muted-foreground">
                            {block.sheetName} • Block #{block.blockNumber} • Age {block.client.age || "-"}
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-sm ${
                            block.client.program_type === "Weight Loss"
                              ? "bg-primary/10 text-primary"
                              : "bg-secondary/10 text-secondary"
                          }`}
                        >
                          {block.client.program_type}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                        <div>
                          <div className="text-muted-foreground">Detected Follow-ups</div>
                          <div className="font-medium">{block.followups.length}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Starting Weight</div>
                          <div className="font-medium">{block.client.starting_weight || "-"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Client Notes</div>
                          <div className="font-medium">{block.clientNotes || "-"}</div>
                        </div>
                      </div>

                      {block.followupPreview.length > 0 && (
                        <div className="rounded-xl bg-accent/60 p-3 text-sm mb-3">
                          <div className="flex items-center gap-2 mb-2 font-medium">
                            <CalendarDays className="w-4 h-4" />
                            Follow-up Timeline
                          </div>
                          <div className="text-muted-foreground">
                            {block.followupPreview[0].date} / {block.followupPreview[0].weight} kg
                            {"  "}→{"  "}
                            {block.followupPreview[block.followupPreview.length - 1].date} /{" "}
                            {block.followupPreview[block.followupPreview.length - 1].weight} kg
                          </div>
                        </div>
                      )}

                      {block.issues.length === 0 ? (
                        <div className="inline-flex items-center gap-2 text-secondary text-sm">
                          <CheckCircle className="w-4 h-4" />
                          Ready to import
                        </div>
                      ) : (
                        <div className="text-sm text-orange-600">{block.issues.join(" • ")}</div>
                      )}
                    </div>
                  ))}
                </div>

                {legacyBlocks.length > 10 && (
                  <div className="text-xs text-muted-foreground mt-4">
                    Showing the first 10 detected client blocks.
                  </div>
                )}
              </div>

              <button
                onClick={handleImport}
                disabled={importing || validLegacyBlocks.length === 0}
                className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {importing
                  ? "Importing..."
                  : `Import ${legacyImportReadyCount} ${
                      importMode === "backup" ? "Backup" : "Legacy"
                    } Client Block${legacyImportReadyCount === 1 ? "" : "s"}`}
              </button>

              {legacyResult && (
                <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                  <div className="flex items-center gap-4 mb-5">
                    <CheckCircle className="w-8 h-8 text-secondary" />
                    <div>
                      <div className="font-semibold text-secondary mb-1">
                        {importMode === "backup" ? "Backup Import Completed" : "Legacy Import Completed"}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Imported {legacyResult.importedClients} client block{legacyResult.importedClients === 1 ? "" : "s"} and added {legacyResult.importedFollowups} follow-ups.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-4 mb-6">
                    <div className="rounded-xl border border-border p-4">
                      <div className="text-sm text-muted-foreground">Blocks</div>
                      <div className="text-2xl font-semibold">{legacyResult.totalBlocks}</div>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="text-sm text-muted-foreground">Clients</div>
                      <div className="text-2xl font-semibold text-secondary">{legacyResult.importedClients}</div>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="text-sm text-muted-foreground">Follow-ups</div>
                      <div className="text-2xl font-semibold">{legacyResult.importedFollowups}</div>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="text-sm text-muted-foreground">Skipped</div>
                      <div className="text-2xl font-semibold text-primary">{legacyResult.skippedBlocks}</div>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <div className="text-sm text-muted-foreground">Failed</div>
                      <div className="text-2xl font-semibold text-orange-600">{legacyResult.failedBlocks}</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {importMode === "generic" && (
            <>
              <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                <div className="flex items-center justify-between gap-4 mb-5">
                  <div>
                    <h2 className="text-xl font-semibold">Fast Import Mode</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      This mode imports every valid row directly. Duplicate cleanup can be done later in the database.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div className="rounded-xl border border-border p-4">
                    <div className="text-sm text-muted-foreground">Valid Rows</div>
                    <div className="text-2xl font-semibold text-secondary">{validGenericRows.length}</div>
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <div className="text-sm text-muted-foreground">Need Review</div>
                    <div className="text-2xl font-semibold text-orange-600">
                      {genericPreviewRows.length - validGenericRows.length}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-primary bg-primary/5 p-5">
                  <div className="font-semibold mb-1">Import all valid rows</div>
                  <div className="text-sm text-muted-foreground">
                    Only invalid rows are blocked. No duplicate checking runs before import.
                  </div>
                </div>
              </div>

              <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">Column Mapping</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Required fields mapped: {mappedRequiredCount}/{requiredFields.size}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setMapping(
                        Object.fromEntries(headers.map((header) => [header, inferField(header)]))
                      )
                    }
                    className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors text-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Re-detect
                  </button>
                </div>
                <div className="space-y-4">
                  {headers.map((header) => {
                    const mappedField = mapping[header] ?? "ignore";
                    const fieldConfig = importFields.find((field) => field.key === mappedField);
                    const isMapped = mappedField !== "ignore";

                    return (
                      <div key={header} className="flex items-center gap-4 p-4 rounded-xl border border-border">
                        <div className="flex-1">
                          <div className="font-medium">{header}</div>
                          <div className="text-sm text-muted-foreground">Spreadsheet column</div>
                        </div>
                        <div className="text-muted-foreground">→</div>
                        <div className="flex-1">
                          <select
                            value={mappedField}
                            onChange={(event) =>
                              setMapping((current) => ({
                                ...current,
                                [header]: event.target.value as ImportFieldKey | "ignore",
                              }))
                            }
                            className="w-full px-4 py-2 rounded-lg border border-border bg-background"
                          >
                            <option value="ignore">Ignore this column</option>
                            {importFields.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label}
                                {field.required ? " (Required)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          {isMapped ? (
                            <CheckCircle className="w-5 h-5 text-secondary" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-orange-500" />
                          )}
                        </div>
                        <div className="w-28 text-sm text-muted-foreground">
                          {fieldConfig?.required ? "Required" : isMapped ? "Optional" : "Ignored"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">Normalized Preview</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      {genericImportReadyCount} row{genericImportReadyCount === 1 ? "" : "s"} ready to import
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-accent border-b border-border">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Row</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Age</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Program</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Starting Weight</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {genericPreviewRows.slice(0, 12).map((row) => (
                        <tr key={row.rowNumber} className="hover:bg-accent/50">
                          <td className="px-4 py-3 text-sm">#{row.rowNumber}</td>
                          <td className="px-4 py-3 text-sm">{row.normalized.name || "-"}</td>
                          <td className="px-4 py-3 text-sm">{row.normalized.age || "-"}</td>
                          <td className="px-4 py-3 text-sm">{row.normalized.program_type || "-"}</td>
                          <td className="px-4 py-3 text-sm">{row.normalized.starting_weight || "-"}</td>
                          <td className="px-4 py-3 text-sm">
                            {row.issues.length === 0 ? (
                              <span className="inline-flex items-center gap-2 text-secondary">
                                <CheckCircle className="w-4 h-4" />
                                Ready
                              </span>
                            ) : (
                              <div className="text-orange-600">
                                <div className="inline-flex items-center gap-2">
                                  <AlertCircle className="w-4 h-4" />
                                  Needs review
                                </div>
                                <div className="text-xs mt-1">{row.issues.join(" • ")}</div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                onClick={handleImport}
                disabled={importing || validGenericRows.length === 0}
                className="w-full px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
              >
                {importing
                  ? "Importing..."
                  : `Import ${genericImportReadyCount} Valid Client${genericImportReadyCount === 1 ? "" : "s"}`}
              </button>

              {genericResult && (
                <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
                  <div className="font-semibold text-secondary mb-1">Import Completed</div>
                  <div className="text-sm text-muted-foreground">
                    Imported {genericResult.importedCount} of {genericResult.totalRows} row
                    {genericResult.totalRows === 1 ? "" : "s"}.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
            <h3 className="font-semibold mb-4">Best Practice</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Use `Upload System Backup` only for files exported from this system</li>
              <li>Import backup workbooks into a fresh or cleaned database when possible</li>
              <li>Use the normal spreadsheet uploader for legacy Arabic files or custom flat sheets</li>
            </ul>
          </div>

          <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
            <h3 className="font-semibold mb-4">Supported Shapes</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Normal flat client spreadsheets with headers</li>
              <li>Arabic legacy workbooks with sheets like `سمنة` and `نحافة`</li>
              <li>System backup workbooks with `Clients` and `Followups` sheets</li>
              <li>Three-row client blocks: date row, weight row, treatment row</li>
            </ul>
          </div>

          <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
            <h3 className="font-semibold mb-4">Legacy Workbook Assumptions</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>Column A = name, B = age, C = status, D = notes</li>
              <li>Columns E onward contain repeated follow-up columns</li>
              <li>Each client occupies 3 rows in a block</li>
              <li>Dates are read from the first row, weights from the second row</li>
            </ul>
          </div>

          <div className="bg-card rounded-[26px] p-6 border border-border shadow-sm">
            <h3 className="font-semibold mb-4">Download Template</h3>
            <p className="text-sm text-muted-foreground mb-4">
              For new data entry, a simple flat template is still easier to maintain.
            </p>
            <div className="space-y-3">
              <button
                onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Flat Template
              </button>
              <button
                onClick={downloadBackupTemplate}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-accent transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Backup Template
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
