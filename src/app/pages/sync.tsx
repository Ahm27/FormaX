import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Cloud,
  CloudUpload,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { api, getErrorMessage } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import { formatBytes } from "../lib/format";
import type { GoogleDriveRemoteFile, GoogleDriveSyncStatus } from "../lib/types";

type SyncConfigPayload = {
  clientId: string;
  clientSecret: string;
  autoSyncEnabled: boolean;
  syncIntervalMinutes: number;
};

const DEFAULT_CONFIG: SyncConfigPayload = {
  clientId: "",
  clientSecret: "",
  autoSyncEnabled: false,
  syncIntervalMinutes: 120,
};

function formatSyncDate(value: string | null, language: "en" | "ar") {
  if (!value) {
    return language === "ar" ? "لا يوجد" : "Not yet";
  }

  return new Date(value).toLocaleString(language === "ar" ? "ar-EG" : "en-US");
}

export function Sync() {
  const { language, direction } = useAppSettings();
  const [status, setStatus] = useState<GoogleDriveSyncStatus | null>(null);
  const [config, setConfig] = useState<SyncConfigPayload>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [cleaningRemote, setCleaningRemote] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const remoteFiles = Array.isArray(status?.remoteFiles) ? status.remoteFiles : [];
  const syncHistory = Array.isArray(status?.history) ? status.history : [];

  const copy = useMemo(
    () =>
      language === "ar"
        ? {
            title: "مزامنة Google Drive",
            subtitle:
              "اربط النظام مع Google Drive لرفع نسخ قاعدة البيانات وملف Excel تلقائيًا أو يدويًا.",
            provider: "الموفر",
            connected: "متصل",
            notConnected: "غير متصل",
            configured: "تم إعداد الاعتماد",
            notConfigured: "لم يتم إعداد الاعتماد",
            lastSync: "آخر مزامنة",
            remoteStorage: "استهلاك التخزين",
            remoteFiles: "الملفات السحابية",
            noRemoteFiles: "لا توجد ملفات سحابية بعد.",
            syncNow: "مزامنة الآن",
            syncingNow: "جارٍ المزامنة...",
            connect: "ربط Google Drive",
            connecting: "جارٍ الربط...",
            disconnect: "فصل Google Drive",
            disconnecting: "جارٍ الفصل...",
            saveConfig: "حفظ الإعدادات",
            savingConfig: "جارٍ الحفظ...",
            configTitle: "إعداد OAuth",
            configHint:
              "أدخل Google OAuth Client ID و Client Secret من مشروع Google Cloud، ثم اضغط ربط.",
            clientId: "Client ID",
            clientSecret: "Client Secret",
            autoSync: "المزامنة التلقائية",
            interval: "الفاصل الزمني",
            everyMinutes: "كل",
            minutes: "دقيقة",
            connectionGuide: "خطوات الإعداد",
            step1: "أنشئ OAuth Client من Google Cloud Console.",
            step2: "أضف Redirect URI التالي في Google Cloud.",
            step3: "احفظ البيانات هنا ثم اضغط ربط Google Drive.",
            history: "سجل المزامنة",
            noHistory: "لا يوجد سجل مزامنة بعد.",
            manual: "يدوي",
            automatic: "تلقائي",
            download: "تنزيل",
            openInDrive: "فتح في Drive",
            filesUploaded: "الملفات المرفوعة",
            totalItems: "إجمالي السجلات",
            status: "الحالة",
            activeFolder: "المجلد النشط",
            cleanupOld: "حذف الملفات الأقدم من شهر",
            cleaningOld: "جارٍ حذف الملفات القديمة...",
            deleteFile: "حذف الملف",
            deletingFile: "جارٍ الحذف...",
          }
        : {
            title: "Google Drive Sync",
            subtitle:
              "Connect the system to Google Drive and push database plus workbook backups manually or automatically.",
            provider: "Provider",
            connected: "Connected",
            notConnected: "Not connected",
            configured: "Credentials saved",
            notConfigured: "Credentials missing",
            lastSync: "Last Sync",
            remoteStorage: "Cloud Storage Used",
            remoteFiles: "Remote Backups",
            noRemoteFiles: "No remote backups uploaded yet.",
            syncNow: "Sync Now",
            syncingNow: "Syncing...",
            connect: "Connect Google Drive",
            connecting: "Connecting...",
            disconnect: "Disconnect Google Drive",
            disconnecting: "Disconnecting...",
            saveConfig: "Save Settings",
            savingConfig: "Saving...",
            configTitle: "OAuth Configuration",
            configHint:
              "Enter the Google OAuth Client ID and Client Secret from Google Cloud, then connect the account.",
            clientId: "Client ID",
            clientSecret: "Client Secret",
            autoSync: "Auto Sync",
            interval: "Interval",
            everyMinutes: "Every",
            minutes: "minutes",
            connectionGuide: "Setup Steps",
            step1: "Create an OAuth Client in Google Cloud Console.",
            step2: "Add the redirect URI below in Google Cloud.",
            step3: "Save the values here, then click Connect Google Drive.",
            history: "Sync History",
            noHistory: "No sync history yet.",
            manual: "Manual",
            automatic: "Automatic",
            download: "Download",
            openInDrive: "Open in Drive",
            filesUploaded: "Uploaded Files",
            totalItems: "Total Records",
            status: "Status",
            activeFolder: "Active Folder",
            cleanupOld: "Delete Files Older Than 1 Month",
            cleaningOld: "Removing old files...",
            deleteFile: "Delete File",
            deletingFile: "Deleting...",
          },
    [language]
  );

  async function loadStatus() {
    try {
      setLoading(true);
      const response = await api.get<GoogleDriveSyncStatus>("/sync/google-drive/status");
      setStatus(response.data);
      setConfig((current) => ({
        ...current,
        autoSyncEnabled: response.data.autoSyncEnabled,
        syncIntervalMinutes: response.data.syncIntervalMinutes,
      }));
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to load Google Drive sync status."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    function handleGoogleDriveMessage(event: MessageEvent) {
      if (event.data?.type === "google-drive-connected") {
        setStatusMessage(
          language === "ar" ? "تم ربط Google Drive بنجاح." : "Google Drive connected successfully."
        );
        void loadStatus();
        setConnecting(false);
      }
    }

    window.addEventListener("message", handleGoogleDriveMessage);
    return () => window.removeEventListener("message", handleGoogleDriveMessage);
  }, [language]);

  async function handleSaveConfig() {
    setSavingConfig(true);
    setStatusMessage(null);

    try {
      const response = await api.post<GoogleDriveSyncStatus>("/sync/google-drive/config", config);
      setStatus(response.data);
      setStatusMessage(language === "ar" ? "تم حفظ إعدادات Google Drive." : "Google Drive settings saved.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to save Google Drive settings."));
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleConnect() {
    setConnecting(true);
    setStatusMessage(null);

    try {
      const response = await api.post<{ authUrl: string }>("/sync/google-drive/connect", {
        frontendUrl: window.location.origin,
      });
      const popup = window.open(response.data.authUrl, "google-drive-connect", "width=640,height=760");

      if (!popup) {
        setStatusMessage(
          language === "ar"
            ? "تعذر فتح نافذة الربط. تأكد من السماح بالنوافذ المنبثقة."
            : "Unable to open the Google auth window. Please allow popups."
        );
        setConnecting(false);
        return;
      }

      const timer = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(timer);
          setConnecting(false);
          void loadStatus();
        }
      }, 1200);
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to start Google Drive connection."));
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    setStatusMessage(null);

    try {
      const response = await api.post<GoogleDriveSyncStatus>("/sync/google-drive/disconnect");
      setStatus(response.data);
      setStatusMessage(language === "ar" ? "تم فصل Google Drive." : "Google Drive disconnected.");
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to disconnect Google Drive."));
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setStatusMessage(null);

    try {
      await api.post("/sync/google-drive/sync-now");
      setStatusMessage(language === "ar" ? "اكتملت المزامنة بنجاح." : "Sync completed successfully.");
      await loadStatus();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to complete Google Drive sync."));
    } finally {
      setSyncing(false);
    }
  }

  async function handleCleanupOldFiles() {
    setCleaningRemote(true);
    setStatusMessage(null);

    try {
      const response = await api.post<{ deletedCount: number }>("/sync/google-drive/cleanup-old-files");
      setStatusMessage(
        language === "ar"
          ? `تم حذف ${response.data.deletedCount} ملف قديم من Google Drive.`
          : `Deleted ${response.data.deletedCount} old Google Drive file(s).`
      );
      await loadStatus();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to remove old Google Drive files."));
    } finally {
      setCleaningRemote(false);
    }
  }

  function handleDownloadRemote(file: GoogleDriveRemoteFile) {
    window.open(`${api.defaults.baseURL}/sync/google-drive/files/${file.id}/download`, "_blank");
  }

  async function handleDeleteRemote(file: GoogleDriveRemoteFile) {
    setDeletingFileId(file.id);
    setStatusMessage(null);

    try {
      await api.delete(`/sync/google-drive/files/${file.id}`);
      setStatusMessage(
        language === "ar"
          ? `تم حذف ${file.name} من Google Drive.`
          : `${file.name} was deleted from Google Drive.`
      );
      await loadStatus();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to delete the Google Drive file."));
    } finally {
      setDeletingFileId(null);
    }
  }

  const totalRecords = (syncHistory[0]?.recordsSynced ?? 0).toLocaleString(
    language === "ar" ? "ar-EG" : "en-US"
  );

  return (
    <div className="p-8" dir={direction}>
      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.16),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.95),_rgba(247,252,250,0.98))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.16),_transparent_34%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          Google Drive
        </div>
        <h1 className="mb-2 text-4xl font-semibold">{copy.title}</h1>
        <p className="max-w-3xl text-muted-foreground">{copy.subtitle}</p>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-2xl border border-border bg-accent/60 px-5 py-4 text-sm text-foreground">
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <KeyRound className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">{copy.configTitle}</h2>
                <p className="text-sm text-muted-foreground">{copy.configHint}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="rounded-2xl border border-border bg-accent/40 p-4">
                <div className="mb-2 text-sm font-medium">{copy.clientId}</div>
                <input
                  type="text"
                  value={config.clientId}
                  onChange={(event) => setConfig((current) => ({ ...current, clientId: event.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-4 py-3"
                  placeholder="Google OAuth Client ID"
                />
              </label>

              <label className="rounded-2xl border border-border bg-accent/40 p-4">
                <div className="mb-2 text-sm font-medium">{copy.clientSecret}</div>
                <input
                  type="password"
                  value={config.clientSecret}
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, clientSecret: event.target.value }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-4 py-3"
                  placeholder="Google OAuth Client Secret"
                />
              </label>

              <div className="rounded-2xl border border-border bg-accent/40 p-4">
                <div className="mb-2 text-sm font-medium">{copy.autoSync}</div>
                <button
                  type="button"
                  onClick={() =>
                    setConfig((current) => ({ ...current, autoSyncEnabled: !current.autoSyncEnabled }))
                  }
                  className={`relative h-7 w-14 rounded-full transition-colors ${
                    config.autoSyncEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                      config.autoSyncEnabled
                        ? direction === "rtl"
                          ? "right-1"
                          : "translate-x-8"
                        : direction === "rtl"
                        ? "translate-x-0"
                        : "left-1"
                    }`}
                  />
                </button>
              </div>

              <label className="rounded-2xl border border-border bg-accent/40 p-4">
                <div className="mb-2 text-sm font-medium">{copy.interval}</div>
                <select
                  value={String(config.syncIntervalMinutes)}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      syncIntervalMinutes: Number(event.target.value),
                    }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-4 py-3"
                >
                  {[30, 60, 120, 360, 720, 1440].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {copy.everyMinutes} {minutes} {copy.minutes}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <div className="mb-2 font-medium">{copy.connectionGuide}</div>
              <div>1. {copy.step1}</div>
              <div>2. {copy.step2}</div>
              <div className="my-2 rounded-xl bg-background px-3 py-2 font-mono text-xs break-all">
                http://localhost:3001/sync/google-drive/callback
              </div>
              <div>3. {copy.step3}</div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {savingConfig ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {savingConfig ? copy.savingConfig : copy.saveConfig}
              </button>

              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={connecting || !status?.configured}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {connecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                {connecting ? copy.connecting : copy.connect}
              </button>

              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={disconnecting || !status?.connected}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {disconnecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                {disconnecting ? copy.disconnecting : copy.disconnect}
              </button>
            </div>
          </div>

          <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Cloud className="h-6 w-6 text-primary" />
                <div>
                  <h2 className="text-xl font-semibold">{copy.remoteFiles}</h2>
                  <p className="text-sm text-muted-foreground">{copy.activeFolder}: {status?.folderName ?? "-"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleSyncNow()}
                disabled={!status?.connected || syncing || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {syncing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncing ? copy.syncingNow : copy.syncNow}
              </button>
              <button
                type="button"
                onClick={() => void handleCleanupOldFiles()}
                disabled={!status?.connected || cleaningRemote || loading}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              >
                {cleaningRemote ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {cleaningRemote ? copy.cleaningOld : copy.cleanupOld}
              </button>
            </div>

            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : remoteFiles.length ? (
              <div className="space-y-3">
                {remoteFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex flex-col gap-4 rounded-2xl border border-border p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="font-medium">{file.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatSyncDate(file.createdTime ?? null, language)} · {formatBytes(Number(file.size ?? 0))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownloadRemote(file)}
                        className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                      >
                        <Download className="h-4 w-4" />
                        {copy.download}
                      </button>
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {copy.openInDrive}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteRemote(file)}
                        disabled={deletingFileId === file.id}
                        className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
                      >
                        {deletingFileId === file.id ? (
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        {deletingFileId === file.id ? copy.deletingFile : copy.deleteFile}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                {copy.noRemoteFiles}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">{copy.status}</h3>
                <p className="text-sm text-muted-foreground">{copy.provider}</p>
              </div>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-accent/40 px-3 py-2">
                <span className="text-muted-foreground">{copy.provider}</span>
                <span className="font-medium">{status?.provider ?? "Google Drive"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{copy.status}</span>
                <span className="font-medium">{status?.connected ? copy.connected : copy.notConnected}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{copy.configTitle}</span>
                <span className="font-medium">{status?.configured ? copy.configured : copy.notConfigured}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{copy.lastSync}</span>
                <span className="font-medium">{formatSyncDate(status?.lastSyncAt ?? null, language)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{copy.remoteStorage}</span>
                <span className="font-medium">{formatBytes(status?.storageUsedBytes ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{copy.totalItems}</span>
                <span className="font-medium">{totalRecords}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[26px] border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <AlertCircle className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">{copy.history}</h3>
                <p className="text-sm text-muted-foreground">{copy.filesUploaded}</p>
              </div>
            </div>

            <div className="space-y-3">
              {syncHistory.length ? (
                syncHistory.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-medium">
                        {item.trigger === "auto" ? copy.automatic : copy.manual}
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          item.status === "success"
                            ? "bg-secondary/10 text-secondary"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatSyncDate(item.timestamp, language)} · {item.recordsSynced.toLocaleString(language === "ar" ? "ar-EG" : "en-US")} records ·{" "}
                      {(item.durationMs / 1000).toFixed(1)}s
                    </div>
                    {item.details && <div className="mt-2 text-sm text-muted-foreground">{item.details}</div>}
                  </div>
                ))
              ) : (
                <div className="rounded-xl bg-accent/40 px-4 py-3 text-sm text-muted-foreground">
                  {copy.noHistory}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
