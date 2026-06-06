/**
 * CLI Sub-Agent Spawner — delegates tasks to Claude Code or Codex CLI.
 *
 * Spawns external CLI processes with appropriate flags for autonomous execution.
 * Output is captured and streamed to the run log for observability.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

export type CliType = "claude-code" | "codex";

export interface CliSubAgentOptions {
  cli: CliType;
  task: string;
  context?: string;
  workspaceDir: string;
  runId: string;
  logPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CliSubAgentResult {
  success: boolean;
  result: string;
  error?: string;
  exitCode: number | null;
  cliNotFound?: boolean;
  installCommand?: string;
}

interface CliConfig {
  command: string;
  args: string[];
  installCommand: string;
}

const CLI_CONFIGS: Record<CliType, CliConfig> = {
  "claude-code": {
    command: "claude",
    args: ["--print", "--dangerously-skip-permissions"],
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
  codex: {
    command: "codex",
    args: ["exec", "--full-auto", "--sandbox", "workspace-write"],
    installCommand: "npm install -g @openai/codex",
  },
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function logEvent(logPath: string, event: unknown): void {
  try {
    fs.appendFileSync(logPath, JSON.stringify(event) + "\n");
  } catch { /* ignore */ }
}

export async function spawnCliSubAgent(opts: CliSubAgentOptions): Promise<CliSubAgentResult> {
  const config = CLI_CONFIGS[opts.cli];
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const fullPrompt = opts.context
    ? `${opts.task}\n\nContext:\n${opts.context}`
    : opts.task;

  const args = [...config.args, fullPrompt];

  logEvent(opts.logPath, {
    id: crypto.randomUUID(),
    runId: opts.runId,
    type: "cli_subagent_start",
    timestamp: new Date().toISOString(),
    payload: { cli: opts.cli, command: config.command, task: opts.task },
  });

  return new Promise<CliSubAgentResult>((resolve) => {
    let child;
    try {
      child = spawn(config.command, args, {
        cwd: opts.workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        timeout,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        success: false,
        result: "",
        error: `Failed to spawn ${config.command}: ${msg}`,
        exitCode: null,
        cliNotFound: true,
        installCommand: config.installCommand,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    // Wire up cancellation
    if (opts.signal) {
      const onAbort = () => {
        killed = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err: Error) => {
      const isNotFound = err.message.includes("ENOENT") || err.message.includes("not found");
      resolve({
        success: false,
        result: "",
        error: isNotFound
          ? `${config.command} is not installed. Install with: ${config.installCommand}`
          : err.message,
        exitCode: null,
        cliNotFound: isNotFound,
        installCommand: isNotFound ? config.installCommand : undefined,
      });
    });

    child.on("close", (code) => {
      const result = stdout.trim();

      logEvent(opts.logPath, {
        id: crypto.randomUUID(),
        runId: opts.runId,
        type: "cli_subagent_end",
        timestamp: new Date().toISOString(),
        payload: {
          cli: opts.cli,
          exitCode: code,
          killed,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        },
      });

      if (killed) {
        resolve({
          success: false,
          result: result || "(cancelled)",
          error: "Sub-agent cancelled",
          exitCode: code,
        });
        return;
      }

      if (code === 0) {
        resolve({
          success: true,
          result: result || "(no output)",
          exitCode: 0,
        });
      } else {
        const errorMsg = stderr.trim() || `Process exited with code ${code}`;
        resolve({
          success: false,
          result,
          error: errorMsg,
          exitCode: code,
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// CLI Detection
// ---------------------------------------------------------------------------

export interface CliDetectionResult {
  cli: CliType;
  installed: boolean;
  version?: string;
  error?: string;
  installCommand: string;
}

export function detectCli(cli: CliType): Promise<CliDetectionResult> {
  const config = CLI_CONFIGS[cli];

  return new Promise((resolve) => {
    const child = spawn(config.command, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });

    let stdout = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("error", () => {
      resolve({
        cli,
        installed: false,
        installCommand: config.installCommand,
      });
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          cli,
          installed: true,
          version: stdout.trim(),
          installCommand: config.installCommand,
        });
      } else {
        resolve({
          cli,
          installed: false,
          installCommand: config.installCommand,
        });
      }
    });
  });
}

export async function detectAllClis(): Promise<CliDetectionResult[]> {
  return Promise.all([detectCli("claude-code"), detectCli("codex")]);
}
