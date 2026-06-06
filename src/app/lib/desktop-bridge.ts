export type DesktopStorageInfo = {
  available: boolean;
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  syncDirectory: string;
  migrated?: boolean;
  reusedExisting?: boolean;
  restartRequired?: boolean;
};

export type DesktopBridge = {
  getStorageInfo: () => Promise<DesktopStorageInfo>;
  chooseDataDirectory: () => Promise<string | null>;
  setDataDirectory: (directoryPath: string) => Promise<DesktopStorageInfo>;
  restartApp: () => Promise<{ success: boolean }>;
};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export function isDesktopBridgeAvailable() {
  return typeof window !== "undefined" && Boolean(window.desktopBridge);
}
