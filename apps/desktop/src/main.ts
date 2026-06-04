/**
 * Electron Main Process
 * 
 * Control Corridor:
 * - Owns: OS access, windows, IPC, local paths
 * - Must NOT own: Agent reasoning, LLM calls
 * 
 * Security:
 * - contextIsolation: true
 * - nodeIntegration: false
 * - All IPC payloads validated via Zod
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC Handlers (Zod-validated)
// ---------------------------------------------------------------------------

import { IpcRequestSchema } from "@carbon-agent/shared-schemas";
import { CarbonDatabase, initDatabase, saveDatabase, closeDatabase } from "@carbon-agent/local-store";

let db: CarbonDatabase | null = null;

async function ensureDb(): Promise<CarbonDatabase> {
  if (!db) {
    await initDatabase();
    db = new CarbonDatabase();
  }
  return db;
}

app.on("before-quit", () => {
  saveDatabase();
  closeDatabase();
});

ipcMain.handle("carbon-ipc", async (_event, rawRequest: unknown) => {
  try {
    const request = IpcRequestSchema.parse(rawRequest);

    switch (request.type) {
      case "provider/list": {
        const d = await ensureDb();
        const rows = await d.listProviders();
        return { type: "provider/list.success", data: rows };
      }

      case "provider/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createProvider({
          id,
          type: request.data.type,
          name: request.data.name,
          apiKey: request.data.apiKey,
          baseUrl: request.data.baseUrl,
          model: request.data.model,
        });
        const created = await d.getProvider(id);
        return { type: "provider/create.success", data: created };
      }

      case "provider/update": {
        const d = await ensureDb();
        await d.updateProvider({
          id: request.id,
          type: request.data.type,
          name: request.data.name,
          apiKey: request.data.apiKey,
          baseUrl: request.data.baseUrl,
          model: request.data.model,
        });
        const updated = await d.getProvider(request.id);
        return { type: "provider/update.success", data: updated };
      }

      case "provider/delete": {
        const d = await ensureDb();
        await d.deleteProvider(request.id);
        return { type: "provider/delete.success" };
      }

      case "provider/test": {
        return { type: "provider/test.success", status: "Test connection requires full provider fetch with API key - implement in next cycle" };
      }

      case "workspace/list": {
        const d = await ensureDb();
        const rows = await d.listWorkspaces();
        return { type: "workspace/list.success", data: rows };
      }

      case "workspace/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createWorkspace({
          id,
          name: request.data.name,
          description: request.data.description,
          vaultDir: request.data.vaultDir,
        });
        const created = await d.getWorkspace(id);
        return { type: "workspace/create.success", data: created };
      }

      case "workspace/get": {
        const d = await ensureDb();
        const row = await d.getWorkspace(request.id);
        if (!row) {
          return { type: "error", error: "Workspace not found", code: "WORKSPACE_NOT_FOUND" };
        }
        return { type: "workspace/get.success", data: row };
      }

      case "profile/list": {
        const d = await ensureDb();
        const rows = await d.listProfiles();
        return { type: "profile/list.success", data: rows };
      }

      case "profile/create": {
        const d = await ensureDb();
        const id = crypto.randomUUID();
        await d.createProfile({
          id,
          name: request.data.name,
          description: request.data.description,
          profileDir: request.data.profileDir,
          targetDomains: request.data.targetDomains,
        });
        const created = await d.getProfile(id);
        return { type: "profile/create.success", data: created };
      }

      case "profile/health": {
        const d = await ensureDb();
        const row = await d.getProfile(request.id);
        if (!row) {
          return { type: "error", error: "Profile not found", code: "PROFILE_NOT_FOUND" };
        }
        return { type: "profile/health.success", status: row.status, lastCheckedAt: row.last_checked_at };
      }

      default:
        return { type: "error", error: `Unhandled request type: ${(request as any).type}`, code: "UNHANDLED" };
    }
  } catch (err: any) {
    return { type: "error", error: err.message ?? String(err), code: "VALIDATION_ERROR" };
  }
});
