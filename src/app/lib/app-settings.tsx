import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppTheme = "light" | "dark";
export type AppLanguage = "en" | "ar";

type TranslationDictionary = Record<string, string>;

const translations: Record<AppLanguage, TranslationDictionary> = {
  en: {
    dashboard: "Dashboard",
    clients: "Clients",
    followUps: "Follow-Ups",
    progress: "Progress",
    databaseExplorer: "Database",
    importData: "Import Data",
    sync: "Sync",
    settings: "Settings",
    followUpSystem: "Follow-Up System",
    synced: "Synced",
    syncing: "Syncing...",
    syncError: "Sync Error",
    allChangesSaved: "All changes saved",
    backup: "Backup",
    settingsTitle: "Settings",
    settingsSubtitle: "Manage appearance, language, backup flows, and operational visibility.",
    appearance: "Appearance",
    appearanceHint: "Control the global look and make dark mode reliable across the whole system.",
    themeMode: "Theme Mode",
    themeModeHint: "Choose the interface mode used on every page.",
    light: "Light",
    dark: "Dark",
    language: "Language",
    languageHint: "Switch the shell between English and Arabic.",
    english: "English",
    arabic: "العربية",
    backupCenter: "Backup Center",
    backupHint: "Create full local backups and export restore-ready workbook files.",
    backupNow: "Backup Now",
    creatingBackup: "Creating Backup...",
    exportWorkbook: "System Backup Workbook",
    preparingWorkbook: "Preparing workbook...",
    backupFolder: "Backup Folder",
    backupFolderHint: "Local `.db` backup copies are stored here on this machine.",
    restoreFlow: "Restore Flow",
    restoreFlowHint: "Use the Import page to restore from the exported workbook when needed.",
    systemInfo: "System Information",
    logs: "Logs",
    logsHint: "Recent backup, export, and import events from this local system.",
    noLogs: "No logs recorded yet.",
    version: "Version",
    databaseSize: "Database Size",
    totalClients: "Total Clients",
    totalFollowups: "Total Follow-Ups",
    backupsStored: "Backups Stored",
    latestBackup: "Latest Backup",
    languageSaved: "Language updated.",
    themeSaved: "Theme updated.",
    workbookDescription:
      "Exports `Clients` and `Followups` sheets in the same clean structure used by the import module.",
    dbDescription:
      "Downloads the live SQLite database for exact local recovery, including all current records.",
    lastUpdated: "Last Updated",
    systemMode: "Local System",
    systemModeHint: "This installation is running locally on this machine.",
  },
  ar: {
    dashboard: "لوحة التحكم",
    clients: "العملاء",
    followUps: "المتابعات",
    progress: "التقدم",
    databaseExplorer: "قاعدة البيانات",
    importData: "استيراد البيانات",
    sync: "المزامنة",
    settings: "الإعدادات",
    followUpSystem: "نظام المتابعة",
    synced: "تمت المزامنة",
    syncing: "جارٍ المزامنة...",
    syncError: "خطأ في المزامنة",
    allChangesSaved: "تم حفظ كل التغييرات",
    backup: "نسخة احتياطية",
    settingsTitle: "الإعدادات",
    settingsSubtitle: "إدارة المظهر واللغة والنسخ الاحتياطي والمتابعة التشغيلية.",
    appearance: "المظهر",
    appearanceHint: "تحكم في شكل النظام بالكامل وتأكد من ثبات الوضع الداكن في كل الصفحات.",
    themeMode: "وضع الواجهة",
    themeModeHint: "اختر وضع الواجهة المستخدم في جميع الصفحات.",
    light: "فاتح",
    dark: "داكن",
    language: "اللغة",
    languageHint: "بدّل واجهة النظام بين العربية والإنجليزية.",
    english: "English",
    arabic: "العربية",
    backupCenter: "مركز النسخ الاحتياطي",
    backupHint: "أنشئ نسخًا محلية كاملة وملفات Excel جاهزة للاستعادة.",
    backupNow: "نسخة احتياطية الآن",
    creatingBackup: "جارٍ إنشاء النسخة...",
    exportWorkbook: "ملف النسخة الاحتياطية للنظام",
    preparingWorkbook: "جارٍ تجهيز الملف...",
    backupFolder: "مجلد النسخ الاحتياطية",
    backupFolderHint: "يتم حفظ نسخ قاعدة البيانات المحلية هنا على هذا الجهاز.",
    restoreFlow: "مسار الاستعادة",
    restoreFlowHint: "استخدم صفحة الاستيراد للاستعادة من ملف Excel المُصدَّر عند الحاجة.",
    systemInfo: "معلومات النظام",
    logs: "السجلات",
    logsHint: "أحدث عمليات النسخ والتصدير والاستيراد على هذا النظام المحلي.",
    noLogs: "لا توجد سجلات بعد.",
    version: "الإصدار",
    databaseSize: "حجم قاعدة البيانات",
    totalClients: "إجمالي العملاء",
    totalFollowups: "إجمالي المتابعات",
    backupsStored: "النسخ المحفوظة",
    latestBackup: "آخر نسخة احتياطية",
    languageSaved: "تم تحديث اللغة.",
    themeSaved: "تم تحديث المظهر.",
    workbookDescription:
      "يصدر ملفًا يحتوي على Sheets باسم `Clients` و `Followups` بنفس البنية النظيفة المستخدمة في الاستيراد.",
    dbDescription:
      "ينزّل قاعدة بيانات SQLite الحالية للاستعادة المحلية الكاملة بكل السجلات الموجودة.",
    lastUpdated: "آخر تحديث",
    systemMode: "نظام محلي",
    systemModeHint: "هذا التثبيت يعمل محليًا على هذا الجهاز.",
  },
};

type AppSettingsContextValue = {
  theme: AppTheme;
  language: AppLanguage;
  direction: "ltr" | "rtl";
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, fallback?: string) => string;
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function getStoredTheme(): AppTheme {
  const stored = window.localStorage.getItem("pharmacy-theme");
  return stored === "dark" ? "dark" : "light";
}

function getStoredLanguage(): AppLanguage {
  const stored = window.localStorage.getItem("pharmacy-language");
  return stored === "ar" ? "ar" : "en";
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() =>
    typeof window === "undefined" ? "light" : getStoredTheme()
  );
  const [language, setLanguageState] = useState<AppLanguage>(() =>
    typeof window === "undefined" ? "en" : getStoredLanguage()
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    window.localStorage.setItem("pharmacy-theme", theme);
  }, [theme, language]);

  useEffect(() => {
    window.localStorage.setItem("pharmacy-language", language);
  }, [language]);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      theme,
      language,
      direction: language === "ar" ? "rtl" : "ltr",
      setTheme: setThemeState,
      setLanguage: setLanguageState,
      t: (key, fallback) => translations[language][key] ?? fallback ?? key,
    }),
    [language, theme]
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);

  if (!context) {
    throw new Error("useAppSettings must be used within AppSettingsProvider.");
  }

  return context;
}
