/**
 * Thompson Bandit — Multi-Armed Bandit Skill Selection
 *
 * Control Corridor:
 * - Owns: Bandit state, sampling, learning
 * - Must NOT own: Skill execution, outcome recording
 *
 * Uses Thompson Sampling to balance exploration vs exploitation
 * when selecting skills or skill variants.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Bandit Types
// ---------------------------------------------------------------------------

export interface BanditArm {
  skillId: string;
  variantId?: string;
  alpha: number;     // Beta distribution parameter (successes)
  beta: number;      // Beta distribution parameter (failures)
  totalPulls: number;
  lastPullAt?: string;
}

export interface BanditSelection {
  skillId: string;
  variantId?: string;
  confidence: number;
  explorationScore: number;
}

export interface BanditStats {
  totalArms: number;
  totalPulls: number;
  averageReward: number;
  bestArm?: BanditArm;
}

// ---------------------------------------------------------------------------
// Thompson Bandit
// ---------------------------------------------------------------------------

export class ThompsonBandit extends EventEmitter {
  private arms: Map<string, BanditArm> = new Map();
  private explorationBonus: number;

  constructor(config: { explorationBonus?: number } = {}) {
    super();
    this.explorationBonus = config.explorationBonus ?? 0.1;
  }

  // ---------------------------------------------------------------------------
  // Arm Management
  // ---------------------------------------------------------------------------

  /**
   * Register a new arm (skill or variant).
   */
  registerArm(skillId: string, variantId?: string): BanditArm {
    const key = this.getArmKey(skillId, variantId);

    if (this.arms.has(key)) {
      return this.arms.get(key)!;
    }

    const arm: BanditArm = {
      skillId,
      variantId,
      alpha: 1,  // Prior: 1 success
      beta: 1,   // Prior: 1 failure
      totalPulls: 0,
    };

    this.arms.set(key, arm);
    this.emit("arm_registered", { arm });
    return arm;
  }

  /**
   * Get an arm.
   */
  getArm(skillId: string, variantId?: string): BanditArm | undefined {
    return this.arms.get(this.getArmKey(skillId, variantId));
  }

  /**
   * Get all arms.
   */
  getAllArms(): BanditArm[] {
    return Array.from(this.arms.values());
  }

  /**
   * Get arms for a skill.
   */
  getSkillArms(skillId: string): BanditArm[] {
    return Array.from(this.arms.values())
      .filter(a => a.skillId === skillId);
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /**
   * Select an arm using Thompson Sampling.
   */
  select(skillId?: string): BanditSelection {
    const candidates = skillId
      ? this.getSkillArms(skillId)
      : Array.from(this.arms.values());

    if (candidates.length === 0) {
      throw new Error("No arms available for selection");
    }

    // Sample from each arm's Beta distribution
    const samples = candidates.map(arm => ({
      arm,
      sample: this.sampleBeta(arm.alpha, arm.beta),
    }));

    // Select the arm with highest sample
    samples.sort((a, b) => b.sample - a.sample);
    const selected = samples[0]!;

    // Calculate confidence and exploration score
    const confidence = selected.sample;
    const explorationScore = this.calculateExplorationScore(selected.arm);

    // Update arm
    selected.arm.totalPulls++;
    selected.arm.lastPullAt = new Date().toISOString();

    const selection: BanditSelection = {
      skillId: selected.arm.skillId,
      variantId: selected.arm.variantId,
      confidence,
      explorationScore,
    };

    this.emit("selected", { selection });
    return selection;
  }

  /**
   * Select the best arm (exploitation only).
   */
  selectBest(skillId?: string): BanditSelection {
    const candidates = skillId
      ? this.getSkillArms(skillId)
      : Array.from(this.arms.values());

    if (candidates.length === 0) {
      throw new Error("No arms available for selection");
    }

    // Calculate expected reward for each arm
    const scored = candidates.map(arm => ({
      arm,
      expectedReward: arm.alpha / (arm.alpha + arm.beta),
    }));

    // Select the arm with highest expected reward
    scored.sort((a, b) => b.expectedReward - a.expectedReward);
    const selected = scored[0]!;

    // Update arm
    selected.arm.totalPulls++;
    selected.arm.lastPullAt = new Date().toISOString();

    return {
      skillId: selected.arm.skillId,
      variantId: selected.arm.variantId,
      confidence: selected.expectedReward,
      explorationScore: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Learning
  // ---------------------------------------------------------------------------

  /**
   * Record a reward for an arm.
   */
  reward(skillId: string, reward: number, variantId?: string): void {
    const arm = this.getArm(skillId, variantId);
    if (!arm) return;

    // Update Beta distribution parameters
    if (reward > 0) {
      arm.alpha += reward;
    } else {
      arm.beta += Math.abs(reward);
    }

    arm.totalPulls++;
    arm.lastPullAt = new Date().toISOString();

    this.emit("rewarded", { skillId, variantId, reward, arm });
  }

  /**
   * Record a success.
   */
  success(skillId: string, variantId?: string): void {
    this.reward(skillId, 1, variantId);
  }

  /**
   * Record a failure.
   */
  failure(skillId: string, variantId?: string): void {
    this.reward(skillId, -1, variantId);
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get bandit statistics.
   */
  getStats(): BanditStats {
    const arms = Array.from(this.arms.values());
    const totalPulls = arms.reduce((sum, a) => sum + a.totalPulls, 0);
    const totalReward = arms.reduce((sum, a) => sum + a.alpha, 0);

    // Find best arm
    let bestArm: BanditArm | undefined;
    let bestExpected = 0;
    for (const arm of arms) {
      const expected = arm.alpha / (arm.alpha + arm.beta);
      if (expected > bestExpected) {
        bestExpected = expected;
        bestArm = arm;
      }
    }

    return {
      totalArms: arms.length,
      totalPulls,
      averageReward: totalPulls > 0 ? totalReward / totalPulls : 0,
      bestArm,
    };
  }

  /**
   * Get expected reward for an arm.
   */
  getExpectedReward(skillId: string, variantId?: string): number {
    const arm = this.getArm(skillId, variantId);
    if (!arm) return 0;
    return arm.alpha / (arm.alpha + arm.beta);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getArmKey(skillId: string, variantId?: string): string {
    return variantId ? `${skillId}:${variantId}` : skillId;
  }

  /**
   * Sample from Beta distribution using Jöhnk's algorithm.
   */
  private sampleBeta(alpha: number, beta: number): number {
    // Use Gamma distribution sampling for Beta
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    return x / (x + y);
  }

  /**
   * Sample from Gamma distribution using Marsaglia and Tsang's method.
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      // For shape < 1, use the relationship: Gamma(a) = Gamma(a+1) * U^(1/a)
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x: number;
      let v: number;

      do {
        x = this.sampleNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * (x * x) * (x * x)) {
        return d * v;
      }

      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }

  /**
   * Sample from standard normal distribution using Box-Muller transform.
   */
  private sampleNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Calculate exploration score for an arm.
   */
  private calculateExplorationScore(arm: BanditArm): number {
    // Higher score = more exploration needed
    const uncertainty = 1 / (arm.alpha + arm.beta);
    const recencyFactor = arm.lastPullAt
      ? 1 / (1 + (Date.now() - new Date(arm.lastPullAt).getTime()) / 3600000)
      : 1;
    return uncertainty * recencyFactor * this.explorationBonus;
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): BanditArm[] {
    return Array.from(this.arms.values());
  }

  importData(arms: BanditArm[]): void {
    for (const arm of arms) {
      this.arms.set(this.getArmKey(arm.skillId, arm.variantId), arm);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createThompsonBandit(config?: { explorationBonus?: number }): ThompsonBandit {
  return new ThompsonBandit(config);
}
