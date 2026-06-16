/**
 * Outcome Tracker — Execution Result Recording
 *
 * Control Corridor:
 * - Owns: Outcome storage, pattern detection, statistics
 * - Must NOT own: Skill storage, embedding generation
 *
 * Tracks success/failure outcomes for skills to enable evolution and improvement.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Outcome Types
// ---------------------------------------------------------------------------

export interface SkillOutcome {
  id: string;
  skillId: string;
  variantId?: string;
  workspaceId: string;
  success: boolean;
  duration: number;
  errorType?: string;
  context: {
    inputSummary: string;
    outputSummary: string;
    toolCalls: Array<{ name: string; success: boolean; duration: number }>;
  };
  createdAt: string;
}

export interface OutcomeStats {
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  failurePatterns: Array<{ pattern: string; count: number }>;
  recentOutcomes: SkillOutcome[];
}

// ---------------------------------------------------------------------------
// Outcome Tracker
// ---------------------------------------------------------------------------

export class OutcomeTracker extends EventEmitter {
  private outcomes: Map<string, SkillOutcome[]> = new Map();  // skillId -> outcomes
  private maxOutcomesPerSkill: number;

  constructor(config: { maxOutcomesPerSkill?: number } = {}) {
    super();
    this.maxOutcomesPerSkill = config.maxOutcomesPerSkill ?? 100;
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  /**
   * Record an outcome for a skill.
   */
  record(outcome: Omit<SkillOutcome, "id" | "createdAt">): SkillOutcome {
    const fullOutcome: SkillOutcome = {
      ...outcome,
      id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    };

    // Get or create outcomes array for this skill
    if (!this.outcomes.has(outcome.skillId)) {
      this.outcomes.set(outcome.skillId, []);
    }
    const skillOutcomes = this.outcomes.get(outcome.skillId)!;

    // Add outcome
    skillOutcomes.push(fullOutcome);

    // Trim if too many
    if (skillOutcomes.length > this.maxOutcomesPerSkill) {
      skillOutcomes.splice(0, skillOutcomes.length - this.maxOutcomesPerSkill);
    }

    this.emit("recorded", { outcome: fullOutcome });
    return fullOutcome;
  }

  /**
   * Get all outcomes for a skill.
   */
  getOutcomes(skillId: string, limit?: number): SkillOutcome[] {
    const outcomes = this.outcomes.get(skillId) ?? [];
    const sorted = [...outcomes].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Get outcomes for a variant.
   */
  getVariantOutcomes(variantId: string): SkillOutcome[] {
    const allOutcomes: SkillOutcome[] = [];
    for (const outcomes of this.outcomes.values()) {
      allOutcomes.push(...outcomes.filter(o => o.variantId === variantId));
    }
    return allOutcomes.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get statistics for a skill.
   */
  getStats(skillId: string): OutcomeStats {
    const outcomes = this.outcomes.get(skillId) ?? [];
    const total = outcomes.length;
    const successes = outcomes.filter(o => o.success).length;
    const durations = outcomes.map(o => o.duration);
    const averageDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // Detect failure patterns
    const failurePatterns = this.detectFailurePatterns(outcomes);

    return {
      totalExecutions: total,
      successRate: total > 0 ? successes / total : 0,
      averageDuration,
      failurePatterns,
      recentOutcomes: outcomes.slice(0, 10),
    };
  }

  /**
   * Get global statistics.
   */
  getGlobalStats(): {
    totalSkills: number;
    totalOutcomes: number;
    overallSuccessRate: number;
  } {
    let totalOutcomes = 0;
    let totalSuccesses = 0;

    for (const outcomes of this.outcomes.values()) {
      totalOutcomes += outcomes.length;
      totalSuccesses += outcomes.filter(o => o.success).length;
    }

    return {
      totalSkills: this.outcomes.size,
      totalOutcomes,
      overallSuccessRate: totalOutcomes > 0 ? totalSuccesses / totalOutcomes : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Pattern Detection
  // ---------------------------------------------------------------------------

  private detectFailurePatterns(outcomes: SkillOutcome[]): Array<{ pattern: string; count: number }> {
    const errorCounts = new Map<string, number>();

    for (const outcome of outcomes) {
      if (!outcome.success && outcome.errorType) {
        errorCounts.set(outcome.errorType, (errorCounts.get(outcome.errorType) ?? 0) + 1);
      }
    }

    return Array.from(errorCounts.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Detect consecutive failures.
   */
  detectConsecutiveFailures(skillId: string, threshold: number = 3): boolean {
    const outcomes = this.outcomes.get(skillId) ?? [];
    const recent = outcomes.slice(0, threshold);
    return recent.length >= threshold && recent.every(o => !o.success);
  }

  /**
   * Get success rate trend.
   */
  getSuccessRateTrend(skillId: string, windowSize: number = 10): number[] {
    const outcomes = this.outcomes.get(skillId) ?? [];
    const trend: number[] = [];

    for (let i = 0; i < outcomes.length; i += windowSize) {
      const window = outcomes.slice(i, i + windowSize);
      const successes = window.filter(o => o.success).length;
      trend.push(successes / window.length);
    }

    return trend;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Clear outcomes for a skill.
   */
  clearSkill(skillId: string): void {
    this.outcomes.delete(skillId);
  }

  /**
   * Clear all outcomes.
   */
  clearAll(): void {
    this.outcomes.clear();
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): SkillOutcome[] {
    const allOutcomes: SkillOutcome[] = [];
    for (const outcomes of this.outcomes.values()) {
      allOutcomes.push(...outcomes);
    }
    return allOutcomes;
  }

  importData(outcomes: SkillOutcome[]): void {
    for (const outcome of outcomes) {
      if (!this.outcomes.has(outcome.skillId)) {
        this.outcomes.set(outcome.skillId, []);
      }
      this.outcomes.get(outcome.skillId)!.push(outcome);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createOutcomeTracker(config?: { maxOutcomesPerSkill?: number }): OutcomeTracker {
  return new OutcomeTracker(config);
}
