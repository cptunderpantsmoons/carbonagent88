/**
 * Skill Advisor — Thin learning orchestration layer
 *
 * Composes outcome tracking, skill evolution analysis, and Thompson bandit
 * selection to provide a minimal skill-learning integration point.
 */

import { OutcomeTracker, createOutcomeTracker } from "./outcome-tracker.js";
import { SkillEvolution, createSkillEvolution, type SkillDefinition, type EvolutionReport } from "./evolution.js";
import { ThompsonBandit, createThompsonBandit, type BanditSelection } from "./bandit.js";

export interface SkillOutcomeContext {
  inputSummary?: string;
  outputSummary?: string;
  toolCalls?: Array<{ name: string; success: boolean; duration: number }>;
  variantId?: string;
  errorType?: string;
  workspaceId?: string;
}

export class SkillAdvisor {
  private outcomeTracker: OutcomeTracker;
  private evolution: SkillEvolution;
  private bandit: ThompsonBandit;

  constructor() {
    this.outcomeTracker = createOutcomeTracker();
    this.evolution = createSkillEvolution(this.outcomeTracker);
    this.bandit = createThompsonBandit();
  }

  /**
   * Record the outcome of a skill execution.
   */
  recordOutcome(
    skillId: string,
    success: boolean,
    duration: number,
    context?: SkillOutcomeContext,
  ): void {
    // Ensure the bandit knows about this arm
    this.bandit.registerArm(skillId, context?.variantId);

    this.outcomeTracker.record({
      skillId,
      workspaceId: context?.workspaceId ?? "default",
      success,
      duration,
      errorType: context?.errorType,
      variantId: context?.variantId,
      context: {
        inputSummary: context?.inputSummary ?? "",
        outputSummary: context?.outputSummary ?? "",
        toolCalls: context?.toolCalls ?? [],
      },
    });

    if (context?.variantId) {
      this.evolution.updateVariantStats(context.variantId, success);
    }

    if (success) {
      this.bandit.success(skillId, context?.variantId);
    } else {
      this.bandit.failure(skillId, context?.variantId);
    }
  }

  /**
   * Select a variant (or the base skill) for execution using the bandit.
   */
  selectVariant(skillId: string): BanditSelection {
    this.bandit.registerArm(skillId);
    return this.bandit.select(skillId);
  }

  /**
   * Analyze a skill and produce an evolution report.
   */
  analyzeSkill(skill: SkillDefinition): EvolutionReport {
    return this.evolution.analyze(skill);
  }
}

export function createSkillAdvisor(): SkillAdvisor {
  return new SkillAdvisor();
}
