import { BrowserWindow } from "electron";
import type { SessionEvent } from "@carbon-agent/shared-schemas";

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

export function emitSessionEvent(payload: {
  sessionId: string;
  event: SessionEvent;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("carbon-event:session-event", payload);
  }
}
