export type ProgramType = "Weight Loss" | "Weight Gain";

export type Client = {
  id: number;
  display_id?: number;
  name: string;
  age: number;
  phone: string | null;
  program_type: ProgramType;
  chronic_diseases: string | null;
  starting_weight: number;
  target_weight: number | null;
  current_weight: number;
  last_followup_date: string | null;
  followup_count: number;
  progress: number;
  created_at: string;
};

export type FollowUp = {
  id: number;
  display_id?: number;
  client_id: number;
  client_display_id?: number;
  client_name: string;
  program_type: ProgramType;
  date: string;
  weight: number;
  previous_weight: number | null;
  weight_change: number | null;
  adherence_status: string;
  notes: string | null;
};

export type ClientDetail = Client & {
  followups: FollowUp[];
};

export type ClientPayload = {
  name: string;
  age: string;
  phone: string;
  program_type: ProgramType;
  chronic_diseases: string;
  starting_weight: string;
  target_weight: string;
};

export type FollowUpPayload = {
  client_id: string;
  date: string;
  weight: string;
  adherence_status: string;
  notes: string;
};

export type DashboardTrend = {
  id: string;
  month: string;
  avgLoss: number;
  avgGain: number;
};

export type DashboardActivity = {
  id: string;
  client_id: number;
  client: string;
  action: string;
  weight: string;
  timestamp: string;
};

export type DashboardAnalytics = {
  stats: {
    totalClients: number;
    weightLossClients: number;
    weightGainClients: number;
    followUpsToday: number;
  };
  weightTrends: DashboardTrend[];
  recentActivity: DashboardActivity[];
};

export type ProgressMetric = {
  label: string;
  value: string;
};

export type ProgressSuccessRate = {
  id: string;
  month: string;
  weightLoss: number;
  weightGain: number;
};

export type ProgressDistribution = {
  id: string;
  name: string;
  value: number;
  color: string;
};

export type ProgressFollowupsPerWeek = {
  id: string;
  week: string;
  followUps: number;
};

export type ProgressAnalytics = {
  performanceMetrics: ProgressMetric[];
  successRateData: ProgressSuccessRate[];
  programDistribution: ProgressDistribution[];
  followUpsPerWeek: ProgressFollowupsPerWeek[];
  additionalInsights: {
    activeClients: number;
    totalWeightLost: number;
    totalWeightGained: number;
    totalFollowups: number;
    clientsWithFollowups: number;
  };
};

export type ImportFieldKey =
  | "name"
  | "age"
  | "phone"
  | "program_type"
  | "chronic_diseases"
  | "starting_weight"
  | "target_weight";

export type ImportClientRowPayload = {
  name?: string;
  age?: string | number;
  phone?: string;
  program_type?: string;
  chronic_diseases?: string;
  starting_weight?: string | number;
  target_weight?: string | number;
};

export type ImportClientResult = {
  rowNumber: number;
  success: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  error?: string;
  client?: Client;
};

export type ImportClientsResponse = {
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  results: ImportClientResult[];
};

export type LegacyImportFollowupPayload = {
  date: string;
  weight: string | number;
  treatment?: string;
};

export type LegacyImportClientBlockPayload = {
  sheetName: string;
  blockNumber: number;
  client: ImportClientRowPayload;
  clientNotes?: string;
  statusLabel?: string;
  followups: LegacyImportFollowupPayload[];
};

export type LegacyImportResult = {
  blockNumber: number;
  sheetName: string;
  success: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  merged?: boolean;
  error?: string;
  client?: Client;
  importedFollowups?: number;
};

export type LegacyImportResponse = {
  totalBlocks: number;
  importedClients: number;
  importedFollowups: number;
  skippedBlocks: number;
  mergedBlocks?: number;
  failedBlocks: number;
  results: LegacyImportResult[];
};

export type BackupImportResponse = LegacyImportResponse;

export type ImportDuplicateStrategy = "skip" | "include";

export type ImportDuplicateAnalysis = {
  totalRows?: number;
  totalBlocks?: number;
  validRows?: number;
  validBlocks?: number;
  duplicatesInFile: number;
  duplicatesInDatabase: number;
  mergesIntoExisting?: number;
  uniqueReady: number;
};

export type SystemInfo = {
  version: string;
  updatedAt: string;
  databaseSizeBytes: number;
  totalClients: number;
  totalFollowups: number;
  backupsStored: number;
  latestBackupName: string | null;
  backupDirectory: string;
  mode: "local";
  scheduledBackup: {
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string;
    lastBackupFilename: string;
  };
};

export type SystemLog = {
  id: string;
  timestamp: string;
  action: string;
  status: "info" | "success" | "error";
  details: string;
};

export type GoogleDriveSyncHistoryItem = {
  id: string;
  timestamp: string;
  status: "success" | "error";
  trigger: "manual" | "auto";
  recordsSynced: number;
  durationMs: number;
  details?: string;
  files?: Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
  }>;
};

export type GoogleDriveRemoteFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

export type GoogleDriveSyncStatus = {
  configured: boolean;
  connected: boolean;
  connectedAt: string | null;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastSyncStatus: "idle" | "success" | "error";
  folderName: string;
  history: GoogleDriveSyncHistoryItem[];
  provider: string;
  remoteFiles: GoogleDriveRemoteFile[];
  storageUsedBytes: number;
  syncing: boolean;
};
