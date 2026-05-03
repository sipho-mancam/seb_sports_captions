import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("desktopApp", {
  isElectron: true,
});