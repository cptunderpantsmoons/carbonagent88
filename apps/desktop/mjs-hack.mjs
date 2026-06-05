import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const electron = require('electron');
export default electron;
export const app = electron.app;
export const BrowserWindow = electron.BrowserWindow;
export const ipcMain = electron.ipcMain;
export const contextBridge = electron.contextBridge;
export const ipcRenderer = electron.ipcRenderer;
