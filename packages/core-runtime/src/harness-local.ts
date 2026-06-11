// LocalHarness — In-process local sub-agent harness

import type { Harness, HarnessExecutionInput, HarnessExecutionResult } from "./harness.js";

export type LocalDelegateFn = (opts: {
  role: string;
  task: string;
  context?: string;
  workspaceId: string;
  conversationId?: string;
  maxSteps?: number;
}) => Promise<{ success: boolean; result: string; error?: string; stepsTaken?: number }>;

export class LocalHarness implements Harness {
  readonly id = "local";
  readonly name = "Local Sub-Agent";
  readonly type = "local" as const;
  readonly capabilities = [
    { name: "research", description: "Research topics and gather information" },
    { name: "extract", description: "Extract structured data from text" },
    { name: "draft", description: "Draft documents and summaries" },
    { name: "reason", description: "Reasoning and synthesis over evidence" },
  ];

  status: "idle" | "running" | "completed" | "failed" = "idle";

  constructor(private delegateFn: LocalDelegateFn) {}

  async spawn(input: HarnessExecutionInput): Promise<HarnessExecutionResult> {
    this.status = "running";
    try {
      const result = await this.delegateFn({
        role: "researcher",
        task: input.task,
        context: input.context,
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        maxSteps: 20,
      });

      this.status = result.success ? "completed" : "failed";
      return {
        success: result.success,
        output: result.result,
        artifacts: [],
        error: result.error,
        metrics: { stepsTaken: result.stepsTaken ?? 0 },
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
