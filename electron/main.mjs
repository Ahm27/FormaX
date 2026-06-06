import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const FRONTEND_PORT = 4173;
const BACKEND_PORT = 3001;
const HOST = "127.0.0.1";

let mainWindow = null;
let frontendServer = null;
let backendServer = null;
const DESKTOP_CONFIG_FILENAME = "desktop-config.json";

function getBundledProjectRoot() {
  return app.getAppPath();
}

function getBundledDbPath() {
  const unpackedDb = path.join(process.resourcesPath, "pharmacy.db");
  if (fs.existsSync(unpackedDb)) {
    return unpackedDb;
  }

  return path.join(getBundledProjectRoot(), "pharmacy.db");
}

function getRuntimeDataRoot() {
  const configuredRoot = readDesktopConfig().dataDirectory;
  if (configuredRoot) {
    return configuredRoot;
  }

  return path.join(app.getPath("userData"), "runtime-data");
}

function getDesktopConfigPath() {
  return path.join(app.getPath("userData"), DESKTOP_CONFIG_FILENAME);
}

function readDesktopConfig() {
  try {
    const configPath = getDesktopConfigPath();
    if (!fs.existsSync(configPath)) {
      return {};
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesktopConfig(nextConfig) {
  const configPath = getDesktopConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
}

function isDirectoryEmpty(directoryPath) {
  return !fs.existsSync(directoryPath) || fs.readdirSync(directoryPath).length === 0;
}

function ensureDirectory(pathname) {
  fs.mkdirSync(pathname, { recursive: true });
}

function migrateRuntimeData(currentRoot, nextRoot) {
  ensureDirectory(nextRoot);

  if (path.resolve(currentRoot) === path.resolve(nextRoot)) {
    return { migrated: false, reusedExisting: fs.existsSync(path.join(nextRoot, "pharmacy.db")) };
  }

  if (fs.existsSync(currentRoot) && isDirectoryEmpty(nextRoot)) {
    fs.cpSync(currentRoot, nextRoot, { recursive: true });
    return { migrated: true, reusedExisting: false };
  }

  return { migrated: false, reusedExisting: fs.existsSync(path.join(nextRoot, "pharmacy.db")) };
}

function resolveUserSelectedDataDirectory(selectedPath) {
  return path.join(selectedPath, "Dr Sherin Pharmacy Data");
}

function getStorageInfo() {
  const dataDirectory = getRuntimeDataRoot();
  return {
    available: true,
    dataDirectory,
    databasePath: path.join(dataDirectory, "pharmacy.db"),
    backupDirectory: path.join(dataDirectory, "backups"),
    syncDirectory: path.join(dataDirectory, "sync-data"),
  };
}

function ensureRuntimeData() {
  const runtimeDataRoot = getRuntimeDataRoot();
  const runtimeDbPath = path.join(runtimeDataRoot, "pharmacy.db");
  const bundledDbPath = getBundledDbPath();

  fs.mkdirSync(runtimeDataRoot, { recursive: true });

  if (!fs.existsSync(runtimeDbPath) && fs.existsSync(bundledDbPath)) {
    fs.copyFileSync(bundledDbPath, runtimeDbPath);
  }

  return {
    runtimeDataRoot,
    runtimeDbPath,
  };
}

function registerDesktopSettingsHandlers() {
  ipcMain.handle("desktop-storage:get", async () => getStorageInfo());
  ipcMain.handle("desktop-storage:choose", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose a folder for Dr Sherin Pharmacy data",
      buttonLabel: "Use This Folder",
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return resolveUserSelectedDataDirectory(result.filePaths[0]);
  });
  ipcMain.handle("desktop-storage:set", async (_event, selectedDirectory) => {
    if (!selectedDirectory || typeof selectedDirectory !== "string") {
      throw new Error("A valid data directory is required.");
    }

    const currentRoot = getRuntimeDataRoot();
    const nextRoot = selectedDirectory;
    const migration = migrateRuntimeData(currentRoot, nextRoot);
    writeDesktopConfig({
      ...readDesktopConfig(),
      dataDirectory: nextRoot,
    });

    return {
      ...getStorageInfo(),
      dataDirectory: nextRoot,
      databasePath: path.join(nextRoot, "pharmacy.db"),
      backupDirectory: path.join(nextRoot, "backups"),
      syncDirectory: path.join(nextRoot, "sync-data"),
      migrated: migration.migrated,
      reusedExisting: migration.reusedExisting,
      restartRequired: true,
    };
  });
  ipcMain.handle("desktop-app:restart", async () => {
    app.relaunch();
    app.exit(0);
    return { success: true };
  });
}

async function startInternalServices() {
  const appRoot = getBundledProjectRoot();
  const { runtimeDataRoot, runtimeDbPath } = ensureRuntimeData();

  process.env.PHARMACY_PROJECT_ROOT = appRoot;
  process.env.PHARMACY_SCRIPT_ROOT = appRoot;
  process.env.PHARMACY_DATA_ROOT = runtimeDataRoot;
  process.env.PHARMACY_DB_PATH = runtimeDbPath;
  process.env.PHARMACY_BACKUP_DIR = path.join(runtimeDataRoot, "backups");
  process.env.PHARMACY_CLEANUP_DIR = path.join(runtimeDataRoot, "cleanup-jobs");
  process.env.PHARMACY_SYNC_DIR = path.join(runtimeDataRoot, "sync-data");
  process.env.PHARMACY_DIST_DIR = path.join(appRoot, "dist");
  process.env.STATIC_HOST = HOST;
  process.env.STATIC_PORT = String(FRONTEND_PORT);
  process.env.HOST = HOST;
  process.env.PORT = String(BACKEND_PORT);
  process.env.GOOGLE_DRIVE_FRONTEND_URL = `http://${HOST}:${FRONTEND_PORT}`;

  const staticModuleUrl = pathToFileURL(path.join(appRoot, "scripts", "serve-static.mjs")).href;
  const backendModuleUrl = pathToFileURL(path.join(appRoot, "backend", "server.js")).href;

  const { startStaticServer } = await import(staticModuleUrl);
  const { startBackendServer } = await import(backendModuleUrl);

  frontendServer = await startStaticServer({
    host: HOST,
    port: FRONTEND_PORT,
  });
  backendServer = await startBackendServer({
    host: HOST,
    port: BACKEND_PORT,
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#f4f9ff",
    title: "Dr Sherin Pharmacy",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(getBundledProjectRoot(), "electron", "preload.mjs"),
    },
  });

  mainWindow.loadURL(`http://${HOST}:${FRONTEND_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function shutdownInternalServices() {
  const closers = [];

  if (frontendServer) {
    closers.push(new Promise((resolve) => frontendServer.close(() => resolve())));
    frontendServer = null;
  }

  if (backendServer) {
    closers.push(new Promise((resolve) => backendServer.close(() => resolve())));
    backendServer = null;
  }

  await Promise.allSettled(closers);
}

const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      registerDesktopSettingsHandlers();
      await startInternalServices();
      createMainWindow();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("Unable to start Dr Sherin Pharmacy", message);
      await shutdownInternalServices();
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on("before-quit", async (event) => {
    if (frontendServer || backendServer) {
      event.preventDefault();
      await shutdownInternalServices();
      app.exit(0);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
