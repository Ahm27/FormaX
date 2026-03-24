import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Moon,
  Sun,
  Download,
  Database,
  Shield,
  Globe,
  Palette,
  FileSpreadsheet,
  LoaderCircle,
  FolderArchive,
  MonitorCog,
  Logs,
} from "lucide-react";
import { api, getErrorMessage } from "../lib/api";
import { useAppSettings } from "../lib/app-settings";
import { formatBytes } from "../lib/format";
import type { SystemInfo, SystemLog } from "../lib/types";

const DATABASE_ACCESS_PASSWORD = "pharmacy-db";

export function Settings() {
  const navigate = useNavigate();
  const { theme, setTheme, language, setLanguage, t, direction } = useAppSettings();
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [busyAction, setBusyAction] = useState<null | "backup" | "excel" | "restore">(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [showDatabasePrompt, setShowDatabasePrompt] = useState(false);
  const [databasePassword, setDatabasePassword] = useState("");
  const [scheduledBackupsEnabled, setScheduledBackupsEnabled] = useState(false);
  const [scheduledBackupInterval, setScheduledBackupInterval] = useState("1440");

  async function downloadFile(url: string, fallbackFilename: string) {
    const response = await api.get<Blob>(url, { responseType: "blob" });
    const blob = new Blob([response.data]);
    const objectUrl = URL.createObjectURL(blob);
    const contentDisposition = response.headers["content-disposition"];
    const matchedFilename = contentDisposition?.match(/filename="?([^"]+)"?$/i)?.[1];
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = matchedFilename || fallbackFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function loadMeta() {
    try {
      setLoadingMeta(true);
      const [infoResponse, logsResponse] = await Promise.all([
        api.get<SystemInfo>("/system/info"),
        api.get<SystemLog[]>("/system/logs"),
      ]);
      setSystemInfo(infoResponse.data);
      setSystemLogs(logsResponse.data);
      setScheduledBackupsEnabled(Boolean(infoResponse.data.scheduledBackup?.enabled));
      setScheduledBackupInterval(String(infoResponse.data.scheduledBackup?.intervalMinutes ?? 1440));
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to load system information."));
    } finally {
      setLoadingMeta(false);
    }
  }

  useEffect(() => {
    void loadMeta();
  }, []);

  async function handleExportData() {
    setBusyAction("excel");
    setStatusMessage(null);

    try {
      await downloadFile("/exports/system-backup.xlsx", "pharmacy_system_backup.xlsx");
      setStatusMessage("System backup workbook downloaded successfully.");
      await loadMeta();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to export the backup workbook."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBackupNow() {
    setBusyAction("backup");
    setStatusMessage(null);

    try {
      await downloadFile("/backups/database", "pharmacy_backup.db");
      setStatusMessage("Database backup created and downloaded successfully.");
      await loadMeta();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to create the database backup."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreDatabase(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setBusyAction("restore");
    setStatusMessage(null);

    try {
      const fileBuffer = await file.arrayBuffer();
      const response = await api.post<{
        success: boolean;
        restoredClients: number;
        restoredFollowups: number;
        safetyBackupFilename: string;
      }>("/backups/restore-database", fileBuffer, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });

      setStatusMessage(
        `Database restored successfully. ${response.data.restoredClients} clients and ${response.data.restoredFollowups} follow-ups were loaded. Safety backup: ${response.data.safetyBackupFilename}.`
      );
      await loadMeta();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to restore the uploaded database backup."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveScheduledBackups() {
    setBusyAction("backup");
    setStatusMessage(null);

    try {
      await api.post("/backups/schedule", {
        enabled: scheduledBackupsEnabled,
        intervalMinutes: Number(scheduledBackupInterval),
      });
      setStatusMessage(
        scheduledBackupsEnabled
          ? `Scheduled backups saved for every ${scheduledBackupInterval} minutes.`
          : "Scheduled backups disabled."
      );
      await loadMeta();
    } catch (error) {
      setStatusMessage(getErrorMessage(error, "Unable to save scheduled backup settings."));
    } finally {
      setBusyAction(null);
    }
  }

  const infoCards = [
    { label: t("version"), value: systemInfo?.version ?? "-" },
    { label: t("databaseSize"), value: systemInfo ? formatBytes(systemInfo.databaseSizeBytes) : "-" },
    { label: t("totalClients"), value: systemInfo?.totalClients ?? "-" },
    { label: t("totalFollowups"), value: systemInfo?.totalFollowups ?? "-" },
    { label: t("backupsStored"), value: systemInfo?.backupsStored ?? "-" },
    { label: t("latestBackup"), value: systemInfo?.latestBackupName ?? "-" },
  ];

  const databaseText =
    language === "ar"
      ? {
          title: "الوصول لقاعدة البيانات",
          hint: "الدخول لمستكشف قاعدة البيانات مخفي هنا ويتطلب كلمة مرور.",
          open: "فتح قاعدة البيانات",
          password: "كلمة المرور",
          confirm: "دخول",
          cancel: "إلغاء",
          invalid: "كلمة المرور غير صحيحة.",
        }
      : {
          title: "Database Access",
          hint: "The database explorer is hidden here and requires a password.",
          open: "Open Database",
          password: "Password",
          confirm: "Enter",
          cancel: "Cancel",
          invalid: "Incorrect password.",
        };

  function handleDatabaseAccess() {
    if (databasePassword === DATABASE_ACCESS_PASSWORD) {
      window.localStorage.setItem("pharmacy-db-access", "granted");
      setDatabasePassword("");
      setShowDatabasePrompt(false);
      setStatusMessage(null);
      navigate("/db");
      return;
    }

    setStatusMessage(databaseText.invalid);
  }

  return (
    <div className="p-8" dir={direction}>
      <div className="mb-8 rounded-[28px] border border-border bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.16),_transparent_35%),linear-gradient(135deg,_rgba(255,255,255,0.95),_rgba(239,248,255,0.96))] p-8 shadow-sm dark:bg-[radial-gradient(circle_at_top_left,_rgba(46,125,255,0.22),_transparent_35%),linear-gradient(135deg,_rgba(30,41,59,0.98),_rgba(15,23,42,0.96))]">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          {t("settingsTitle")}
        </div>
        <h1 className="mb-2 text-4xl font-semibold">{t("settingsTitle")}</h1>
        <p className="max-w-3xl text-muted-foreground">{t("settingsSubtitle")}</p>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-2xl border border-border bg-accent/60 px-5 py-4 text-sm text-foreground">
          {statusMessage}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="bg-card rounded-[26px] border border-border p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <Palette className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">{t("appearance")}</h2>
                <p className="text-sm text-muted-foreground">{t("appearanceHint")}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border bg-accent/50 p-5">
                <div className="mb-1 font-medium">{t("themeMode")}</div>
                <div className="mb-4 text-sm text-muted-foreground">{t("themeModeHint")}</div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setTheme("light");
                      setStatusMessage(t("themeSaved"));
                    }}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 transition-colors ${
                      theme === "light"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <Sun className="h-4 w-4" />
                    {t("light")}
                  </button>
                  <button
                    onClick={() => {
                      setTheme("dark");
                      setStatusMessage(t("themeSaved"));
                    }}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 transition-colors ${
                      theme === "dark"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <Moon className="h-4 w-4" />
                    {t("dark")}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-accent/50 p-5">
                <div className="mb-1 font-medium">{t("language")}</div>
                <div className="mb-4 text-sm text-muted-foreground">{t("languageHint")}</div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setLanguage("en");
                      setStatusMessage(t("languageSaved"));
                    }}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 transition-colors ${
                      language === "en"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <Globe className="h-4 w-4" />
                    {t("english")}
                  </button>
                  <button
                    onClick={() => {
                      setLanguage("ar");
                      setStatusMessage(t("languageSaved"));
                    }}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 transition-colors ${
                      language === "ar"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background hover:bg-accent"
                    }`}
                  >
                    <Globe className="h-4 w-4" />
                    {t("arabic")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-[26px] border border-border p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <Shield className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">{t("backupCenter")}</h2>
                <p className="text-sm text-muted-foreground">{t("backupHint")}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <button
                onClick={handleBackupNow}
                disabled={busyAction !== null}
                className="rounded-[22px] border border-border bg-[linear-gradient(135deg,_rgba(46,125,255,0.08),_rgba(255,255,255,0.96))] p-5 text-left transition-colors hover:bg-accent disabled:opacity-60 dark:bg-[linear-gradient(135deg,_rgba(46,125,255,0.18),_rgba(30,41,59,0.94))]"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium">
                    <Database className="h-5 w-5 text-primary" />
                    {t("backupNow")}
                  </div>
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                    .db
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{t("dbDescription")}</p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-primary">
                  {busyAction === "backup" ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {t("creatingBackup")}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      {t("backupNow")}
                    </>
                  )}
                </div>
              </button>

              <button
                onClick={handleExportData}
                disabled={busyAction !== null}
                className="rounded-[22px] border border-border bg-[linear-gradient(135deg,_rgba(0,191,166,0.08),_rgba(255,255,255,0.96))] p-5 text-left transition-colors hover:bg-accent disabled:opacity-60 dark:bg-[linear-gradient(135deg,_rgba(0,191,166,0.18),_rgba(30,41,59,0.94))]"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 font-medium">
                    <FileSpreadsheet className="h-5 w-5 text-secondary" />
                    {t("exportWorkbook")}
                  </div>
                  <span className="rounded-full bg-secondary/10 px-3 py-1 text-xs font-semibold text-secondary">
                    .xlsx
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{t("workbookDescription")}</p>
                <div className="mt-4 inline-flex items-center gap-2 text-sm text-secondary">
                  {busyAction === "excel" ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {t("preparingWorkbook")}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      {t("exportWorkbook")}
                    </>
                  )}
                </div>
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-border p-4">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <FolderArchive className="h-4 w-4 text-primary" />
                  {t("backupFolder")}
                </div>
                <div className="text-sm text-muted-foreground">{t("backupFolderHint")}</div>
                <div className="mt-3 rounded-xl bg-accent/60 px-3 py-2 text-sm break-all">
                  {systemInfo?.backupDirectory ?? "-"}
                </div>
              </div>
              <div className="rounded-2xl border border-border p-4">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <MonitorCog className="h-4 w-4 text-secondary" />
                  {t("restoreFlow")}
                </div>
                <div className="text-sm text-muted-foreground">{t("restoreFlowHint")}</div>
                <div className="mt-4 rounded-xl bg-accent/50 p-4">
                  <div className="mb-2 text-sm font-medium">
                    {language === "ar" ? "استرجاع قاعدة البيانات الأساسية" : "Restore Primary Database"}
                  </div>
                  <div className="mb-4 text-sm text-muted-foreground">
                    {language === "ar"
                      ? "ارفع ملف النسخة الاحتياطية بصيغة .db لاستبدال بيانات العملاء والمتابعات الحالية مع إنشاء نسخة أمان تلقائية أولاً."
                      : "Upload a .db backup file to replace the current clients and follow-ups data. A safety backup is created first."}
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {busyAction === "restore" ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        {language === "ar" ? "جاري الاسترجاع..." : "Restoring..."}
                      </>
                    ) : (
                      <>
                        <Database className="h-4 w-4" />
                        {language === "ar" ? "رفع نسخة .db" : "Upload .db Backup"}
                      </>
                    )}
                  </button>
                  <input
                    ref={restoreInputRef}
                    type="file"
                    accept=".db,application/octet-stream"
                    onChange={(event) => void handleRestoreDatabase(event)}
                    className="hidden"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-border p-4">
              <div className="mb-2 font-medium">
                {language === "ar" ? "النسخ الاحتياطية المجدولة" : "Scheduled Backups"}
              </div>
              <div className="mb-4 text-sm text-muted-foreground">
                {language === "ar"
                  ? "أنشئ نسخًا محلية لقاعدة البيانات تلقائيًا طالما أن الخادم يعمل."
                  : "Create automatic local database backups while the backend is running."}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setScheduledBackupsEnabled((value) => !value)}
                  className={`relative h-7 w-14 rounded-full transition-colors ${
                    scheduledBackupsEnabled ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                      scheduledBackupsEnabled ? "translate-x-8" : "left-1"
                    }`}
                  />
                </button>
                <select
                  value={scheduledBackupInterval}
                  onChange={(event) => setScheduledBackupInterval(event.target.value)}
                  className="rounded-xl border border-border bg-background px-4 py-3 text-sm"
                  disabled={!scheduledBackupsEnabled}
                >
                  <option value="60">Every 1 hour</option>
                  <option value="120">Every 2 hours</option>
                  <option value="360">Every 6 hours</option>
                  <option value="720">Every 12 hours</option>
                  <option value="1440">Daily</option>
                </select>
                <button
                  type="button"
                  onClick={() => void handleSaveScheduledBackups()}
                  disabled={busyAction !== null}
                  className="rounded-xl border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {language === "ar" ? "حفظ الجدولة" : "Save Schedule"}
                </button>
              </div>
              <div className="mt-4 text-sm text-muted-foreground">
                {language === "ar" ? "آخر تشغيل:" : "Last run:"}{" "}
                {systemInfo?.scheduledBackup?.lastRunAt
                  ? new Date(systemInfo.scheduledBackup.lastRunAt).toLocaleString(
                      language === "ar" ? "ar-EG" : "en-US"
                    )
                  : "-"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {language === "ar" ? "آخر ملف:" : "Last file:"}{" "}
                {systemInfo?.scheduledBackup?.lastBackupFilename || "-"}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card rounded-[26px] border border-border p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <MonitorCog className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">{t("systemInfo")}</h3>
                <p className="text-sm text-muted-foreground">{t("systemModeHint")}</p>
              </div>
            </div>

            {loadingMeta ? (
              <div className="text-sm text-muted-foreground">Loading system information...</div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-xl bg-accent/40 px-3 py-2">
                  <span className="text-muted-foreground">{t("systemMode")}</span>
                  <span className="font-medium">{systemInfo?.mode ?? "-"}</span>
                </div>
                {infoCards.map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="max-w-[58%] truncate text-right font-medium">{item.value}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("lastUpdated")}</span>
                  <span className="font-medium">{systemInfo?.updatedAt ?? "-"}</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-card rounded-[26px] border border-border p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <Database className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">{databaseText.title}</h3>
                <p className="text-sm text-muted-foreground">{databaseText.hint}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowDatabasePrompt(true);
                setStatusMessage(null);
              }}
              className="w-full rounded-xl border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
            >
              {databaseText.open}
            </button>
          </div>

          <div className="bg-card rounded-[26px] border border-border p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <Logs className="h-6 w-6 text-primary" />
              <div>
                <h3 className="font-semibold">{t("logs")}</h3>
                <p className="text-sm text-muted-foreground">{t("logsHint")}</p>
              </div>
            </div>

            <div className="space-y-3">
              {systemLogs.length === 0 ? (
                <div className="rounded-xl bg-accent/40 px-4 py-3 text-sm text-muted-foreground">
                  {t("noLogs")}
                </div>
              ) : (
                systemLogs.slice(0, 10).map((log) => (
                  <div key={log.id} className="rounded-2xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="font-medium">{log.action}</div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          log.status === "success"
                            ? "bg-secondary/10 text-secondary"
                            : log.status === "error"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-primary/10 text-primary"
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                    <div className="mb-2 text-sm text-muted-foreground">{log.details}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString(language === "ar" ? "ar-EG" : "en-US")}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {showDatabasePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="mb-2 text-xl font-semibold">{databaseText.title}</h3>
            <p className="mb-4 text-sm text-muted-foreground">{databaseText.hint}</p>
            <input
              type="password"
              value={databasePassword}
              onChange={(event) => setDatabasePassword(event.target.value)}
              placeholder={databaseText.password}
              className="mb-4 w-full rounded-xl border border-border bg-background px-4 py-3"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowDatabasePrompt(false);
                  setDatabasePassword("");
                  setStatusMessage(null);
                }}
                className="rounded-xl border border-border px-4 py-2 transition-colors hover:bg-accent"
              >
                {databaseText.cancel}
              </button>
              <button
                type="button"
                onClick={handleDatabaseAccess}
                className="rounded-xl bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {databaseText.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
