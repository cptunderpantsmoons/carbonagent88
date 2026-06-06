import { BrowserWindow } from "electron";

export function emitSessionUpdate(payload: {
  sessionId: string;
  status: string;
  currentGoal: string;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("carbon-event:session-update", payload);
  }
}

export function emitSessionWorkingSet(payload: {
  sessionId: string;
  documents: unknown[];
  gaps: string[];
  provenanceScore: number;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("carbon-event:session-working-set", payload);
  }
}
