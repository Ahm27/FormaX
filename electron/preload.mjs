import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopBridge", {
  getStorageInfo: () => ipcRenderer.invoke("desktop-storage:get"),
  chooseDataDirectory: () => ipcRenderer.invoke("desktop-storage:choose"),
  setDataDirectory: (directoryPath) => ipcRenderer.invoke("desktop-storage:set", directoryPath),
  restartApp: () => ipcRenderer.invoke("desktop-app:restart"),
});
