import fs from "node:fs";
import path from "node:path";
import { getRunsDir, getRunLogPath } from "./paths";

/**
 * JSONL Append-Only Logger
 * 
 * Every agent run gets its own JSONL file in ~/.carbon-agent/runs/.
 * Each line is a valid JSON object representing a RunEvent.
 */

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export function appendRunEvent(runId: string, event: RunEvent): void {
  const logPath = getRunLogPath(runId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(event) + "\n";
  fs.appendFileSync(logPath, line);
}

export function createRunLog(runId: string): string {
  const logPath = getRunLogPath(runId);
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(logPath, "");
  return logPath;
}

export function readRunLog(runId: string): RunEvent[] {
  const logPath = getRunLogPath(runId);
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
  return lines.map((line: string) => JSON.parse(line) as RunEvent);
}

export function readRunLogRaw(runId: string): string {
  const logPath = getRunLogPath(runId);
  if (!fs.existsSync(logPath)) {
    return "";
  }
  return fs.readFileSync(logPath, "utf-8");
}

export function listRunLogs(): string[] {
  const runsDir = getRunsDir();
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  return fs.readdirSync(runsDir).filter((f: string) => f.endsWith(".jsonl")).sort();
}

/** Event builder helpers */
export function createEvent(runId: string, type: string, payload: Record<string, unknown>): RunEvent {
  return {
    id: globalThis.crypto.randomUUID(),
    runId,
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

export function llmRequestEvent(runId: string, model: string, messages: unknown[]): RunEvent {
  return createEvent(runId, "llm_request", { model, messages });
}

export function toolCallStartEvent(runId: string, toolName: string, input: unknown): RunEvent {
  return createEvent(runId, "tool_call_start", { tool_name: toolName, input });
}

export function toolCallEndEvent(runId: string, toolName: string, output: unknown): RunEvent {
  return createEvent(runId, "tool_call_end", { tool_name: toolName, output });
}

export function systemMessageEvent(runId: string, message: string): RunEvent {
  return createEvent(runId, "system_message", { message });
}

export function userMessageEvent(runId: string, content: string): RunEvent {
  return createEvent(runId, "user_message", { content });
}

export function assistantMessageEvent(runId: string, content: string): RunEvent {
  return createEvent(runId, "assistant_message", { content });
}

export function llmResponseEvent(runId: string, model: string, content: string, usage?: unknown): RunEvent {
  return createEvent(runId, "llm_response", { model, content, usage });
}

export function toolCallErrorEvent(runId: string, toolName: string, error: string): RunEvent {
  return createEvent(runId, "tool_call_error", { tool_name: toolName, error });
}
