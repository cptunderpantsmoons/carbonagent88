/**
 * Skill Evolution — Pattern Analysis and Variant Generation
 *
 * Control Corridor:
 * - Owns: Evolution analysis, variant generation, improvement suggestions
 * - Must NOT own: Skill storage, execution engine
 *
 * Analyzes skill outcomes to identify improvement opportunities and
 * generates skill variants for A/B testing.
 */

import { EventEmitter } from "node:events";
import type { OutcomeTracker, OutcomeStats } from "./outcome-tracker.js";

// ---------------------------------------------------------------------------
// Evolution Types
// ---------------------------------------------------------------------------

export interface SkillVariant {
  id: string;
  skillId: string;
  version: number;
  name: string;
  parameters: Record<string, unknown>;
  toolSequence: Array<{ toolName: string; input: Record<string, unknown>; notes?: string }>;
  triggerPattern: string;
  successRate: number;
  executionCount: number;
  createdAt: string;
  lastUsedAt?: string;
}

export interface EvolutionReport {
  skillId: string;
  totalExecutions: number;
  successRate: number;
  averageDuration: number;
  commonFailures: Array<{
    pattern: string;
    count: number;
    suggestedFix: string;
  }>;
  improvementOpportunities: Array<{
    type: "parameter" | "sequence" | "trigger" | "composition";
    description: string;
    estimatedImpact: number;
  }>;
  recommendedVariant?: SkillVariant;
}

export interface SkillDefinition {
  id: string;
  name: string;
  trigger: string;
  toolSequence: Array<{ toolName: string; input: Record<string, unknown>; notes?: string }>;
  parameters: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Skill Evolution Engine
// ---------------------------------------------------------------------------

export class SkillEvolution extends EventEmitter {
  private outcomeTracker: OutcomeTracker;
  private variants: Map<string, SkillVariant[]> = new Map();  // skillId -> variants
  private maxVariantsPerSkill: number;

  constructor(
    outcomeTracker: OutcomeTracker,
    config: { maxVariantsPerSkill?: number } = {},
  ) {
    super();
    this.outcomeTracker = outcomeTracker;
    this.maxVariantsPerSkill = config.maxVariantsPerSkill ?? 5;
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  /**
   * Analyze a skill and generate an evolution report.
   */
  analyze(skill: SkillDefinition): EvolutionReport {
    const stats = this.outcomeTracker.getStats(skill.id);

    // Detect common failures
    const commonFailures = stats.failurePatterns.map(fp => ({
      pattern: fp.pattern,
      count: fp.count,
      suggestedFix: this.suggestFixForFailure(fp.pattern),
    }));

    // Identify improvement opportunities
    const improvementOpportunities = this.identifyImprovements(skill, stats);

    // Generate recommended variant if there are opportunities
    let recommendedVariant: SkillVariant | undefined;
    if (improvementOpportunities.length > 0) {
      recommendedVariant = this.generateVariant(skill, improvementOpportunities[0]!);
    }

    return {
      skillId: skill.id,
      totalExecutions: stats.totalExecutions,
      successRate: stats.successRate,
      averageDuration: stats.averageDuration,
      commonFailures,
      improvementOpportunities,
      recommendedVariant,
    };
  }

  /**
   * Identify improvement opportunities.
   */
  private identifyImprovements(
    skill: SkillDefinition,
    stats: OutcomeStats,
  ): EvolutionReport["improvementOpportunities"] {
    const opportunities: EvolutionReport["improvementOpportunities"] = [];

    // Low success rate
    if (stats.successRate < 0.7 && stats.totalExecutions >= 5) {
      opportunities.push({
        type: "sequence",
        description: `Success rate is ${(stats.successRate * 100).toFixed(1)}%. Consider simplifying the tool sequence.`,
        estimatedImpact: 0.3,
      });
    }

    // High average duration
    if (stats.averageDuration > 30000) {  // > 30 seconds
      opportunities.push({
        type: "parameter",
        description: `Average duration is ${(stats.averageDuration / 1000).toFixed(1)}s. Consider optimizing parameters.`,
        estimatedImpact: 0.2,
      });
    }

    // Consecutive failures
    if (this.outcomeTracker.detectConsecutiveFailures(skill.id, 3)) {
      opportunities.push({
        type: "trigger",
        description: "Recent consecutive failures detected. Consider updating trigger pattern.",
        estimatedImpact: 0.4,
      });
    }

    // Tool sequence optimization
    if (skill.toolSequence.length > 5) {
      opportunities.push({
        type: "sequence",
        description: `Tool sequence has ${skill.toolSequence.length} steps. Consider combining or removing steps.`,
        estimatedImpact: 0.2,
      });
    }

    return opportunities;
  }

  /**
   * Suggest a fix for a failure pattern.
   */
  private suggestFixForFailure(pattern: string): string {
    const fixes: Record<string, string> = {
      "timeout": "Increase timeout or add retry logic",
      "rate_limit": "Add delay between requests",
      "authentication": "Refresh credentials before execution",
      "not_found": "Verify resource exists before accessing",
      "permission": "Check access rights",
      "network": "Add retry with exponential backoff",
      "invalid_input": "Validate input parameters",
    };

    // Try to match pattern
    for (const [key, fix] of Object.entries(fixes)) {
      if (pattern.toLowerCase().includes(key)) {
        return fix;
      }
    }

    return "Review error logs and adjust approach";
  }

  // ---------------------------------------------------------------------------
  // Variant Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate a variant based on an improvement opportunity.
   */
  generateVariant(
    skill: SkillDefinition,
    opportunity: EvolutionReport["improvementOpportunities"][0],
  ): SkillVariant {
    const variants = this.variants.get(skill.id) ?? [];
    const nextVersion = variants.length > 0
      ? Math.max(...variants.map(v => v.version)) + 1
      : 1;

    // Generate variant based on opportunity type
    let variant: SkillVariant;

    switch (opportunity.type) {
      case "parameter":
        variant = this.generateParameterVariant(skill, nextVersion);
        break;
      case "sequence":
        variant = this.generateSequenceVariant(skill, nextVersion);
        break;
      case "trigger":
        variant = this.generateTriggerVariant(skill, nextVersion);
        break;
      case "composition":
        variant = this.generateCompositionVariant(skill, nextVersion);
        break;
      default:
        variant = this.generateParameterVariant(skill, nextVersion);
    }

    // Store variant
    if (!this.variants.has(skill.id)) {
      this.variants.set(skill.id, []);
    }
    const skillVariants = this.variants.get(skill.id)!;
    skillVariants.push(variant);

    // Trim if too many
    if (skillVariants.length > this.maxVariantsPerSkill) {
      skillVariants.splice(0, skillVariants.length - this.maxVariantsPerSkill);
    }

    this.emit("variant_generated", { variant });
    return variant;
  }

  private generateParameterVariant(skill: SkillDefinition, version: number): SkillVariant {
    // Modify parameters slightly
    const newParams = { ...skill.parameters };

    // Add random variation to numeric parameters
    for (const [key, value] of Object.entries(newParams)) {
      if (typeof value === "number") {
        newParams[key] = value * (0.8 + Math.random() * 0.4);  // ±20%
      }
    }

    return {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      skillId: skill.id,
      version,
      name: `${skill.name} v${version} (parameter)`,
      parameters: newParams,
      toolSequence: skill.toolSequence,
      triggerPattern: skill.trigger,
      successRate: 0,
      executionCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  private generateSequenceVariant(skill: SkillDefinition, version: number): SkillVariant {
    // Simplify sequence by removing optional steps
    const simplifiedSequence = skill.toolSequence.slice(0, Math.max(3, skill.toolSequence.length - 1));

    return {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      skillId: skill.id,
      version,
      name: `${skill.name} v${version} (simplified)`,
      parameters: skill.parameters,
      toolSequence: simplifiedSequence,
      triggerPattern: skill.trigger,
      successRate: 0,
      executionCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  private generateTriggerVariant(skill: SkillDefinition, version: number): SkillVariant {
    // Broaden trigger pattern
    const words = skill.trigger.split(/\s+/);
    const broadenedTrigger = words.slice(0, Math.ceil(words.length * 0.7)).join(" ");

    return {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      skillId: skill.id,
      version,
      name: `${skill.name} v${version} (broadened)`,
      parameters: skill.parameters,
      toolSequence: skill.toolSequence,
      triggerPattern: broadenedTrigger,
      successRate: 0,
      executionCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  private generateCompositionVariant(skill: SkillDefinition, version: number): SkillVariant {
    // This would combine with another skill - for now, just add a step
    const extendedSequence = [
      ...skill.toolSequence,
      { toolName: "validate_output", input: {}, notes: "Auto-added validation step" },
    ];

    return {
      id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      skillId: skill.id,
      version,
      name: `${skill.name} v${version} (with validation)`,
      parameters: skill.parameters,
      toolSequence: extendedSequence,
      triggerPattern: skill.trigger,
      successRate: 0,
      executionCount: 0,
      createdAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Variant Management
  // ---------------------------------------------------------------------------

  /**
   * Get variants for a skill.
   */
  getVariants(skillId: string): SkillVariant[] {
    return this.variants.get(skillId) ?? [];
  }

  /**
   * Get the best variant for a skill.
   */
  getBestVariant(skillId: string): SkillVariant | null {
    const variants = this.variants.get(skillId) ?? [];
    if (variants.length === 0) return null;

    // Sort by success rate (with minimum execution threshold)
    const viable = variants.filter(v => v.executionCount >= 3);
    if (viable.length === 0) return variants[0]!;

    return viable.sort((a, b) => b.successRate - a.successRate)[0]!;
  }

  /**
   * Update variant success rate.
   */
  updateVariantStats(variantId: string, success: boolean): void {
    for (const variants of this.variants.values()) {
      const variant = variants.find(v => v.id === variantId);
      if (variant) {
        variant.executionCount++;
        // Update success rate with exponential moving average
        const alpha = 0.3;
        variant.successRate = variant.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
        variant.lastUsedAt = new Date().toISOString();
        break;
      }
    }
  }

  /**
   * Delete a variant.
   */
  deleteVariant(skillId: string, variantId: string): boolean {
    const variants = this.variants.get(skillId);
    if (!variants) return false;

    const index = variants.findIndex(v => v.id === variantId);
    if (index === -1) return false;

    variants.splice(index, 1);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): SkillVariant[] {
    const allVariants: SkillVariant[] = [];
    for (const variants of this.variants.values()) {
      allVariants.push(...variants);
    }
    return allVariants;
  }

  importData(variants: SkillVariant[]): void {
    for (const variant of variants) {
      if (!this.variants.has(variant.skillId)) {
        this.variants.set(variant.skillId, []);
      }
      this.variants.get(variant.skillId)!.push(variant);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSkillEvolution(
  outcomeTracker: OutcomeTracker,
  config?: { maxVariantsPerSkill?: number },
): SkillEvolution {
  return new SkillEvolution(outcomeTracker, config);
}
