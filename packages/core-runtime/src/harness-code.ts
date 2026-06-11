// CodeHarness — CLI sub-agent harness for claude-code and codex

import type { Harness, HarnessExecutionInput, HarnessExecutionResult } from "./harness.js";

export type CliSubAgentFn = (opts: {
  cli: "claude-code" | "codex";
  task: string;
  context?: string;
  workspaceDir: string;
  runId: string;
  logPath: string;
  signal?: AbortSignal;
}) => Promise<{ success: boolean; result: string; error?: string; cliNotFound?: boolean; installCommand?: string }>;

export class CodeHarness implements Harness {
  readonly id: string;
  readonly name: string;
  readonly type = "code" as const;
  readonly capabilities = [
    { name: "code_edit", description: "Edit and refactor code across the workspace" },
    { name: "terminal", description: "Run terminal commands in the workspace" },
    { name: "debug", description: "Debug failing code or tests" },
  ];

  status: "idle" | "running" | "completed" | "failed" = "idle";

  constructor(
    private cliType: "claude-code" | "codex",
    private spawnFn: CliSubAgentFn,
  ) {
    this.id = cliType;
    this.name = cliType === "claude-code" ? "Claude Code" : "Codex";
  }

  async spawn(input: HarnessExecutionInput): Promise<HarnessExecutionResult> {
    this.status = "running";
    try {
      const result = await this.spawnFn({
        cli: this.cliType,
        task: input.task,
        context: input.context,
        workspaceDir: input.workspaceId,
        runId: input.runId ?? "",
        logPath: input.runId ?? "",
      });

      this.status = result.success ? "completed" : "failed";
      return {
        success: result.success,
        output: result.result,
        artifacts: [],
        error: result.error,
        metrics: { cliType: this.cliType, cliNotFound: result.cliNotFound, installCommand: result.installCommand },
      };
    } catch (err) {
      this.status = "failed";
      return {
        success: false,
        output: "",
        artifacts: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
