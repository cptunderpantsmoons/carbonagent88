/**
 * Self-Improving Skill System — Tests
 *
 * Comprehensive tests for outcome tracker, skill evolution, and Thompson bandit.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OutcomeTracker, createOutcomeTracker } from "./outcome-tracker.js";
import { SkillEvolution, createSkillEvolution, type SkillDefinition } from "./evolution.js";
import { ThompsonBandit, createThompsonBandit } from "./bandit.js";

// ---------------------------------------------------------------------------
// Outcome Tracker Tests
// ---------------------------------------------------------------------------

describe("OutcomeTracker", () => {
  let tracker: OutcomeTracker;

  beforeEach(() => {
    tracker = createOutcomeTracker({ maxOutcomesPerSkill: 50 });
  });

  it("should record outcomes", () => {
    const outcome = tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: true,
      duration: 1000,
      context: {
        inputSummary: "Test input",
        outputSummary: "Test output",
        toolCalls: [],
      },
    });

    expect(outcome.id).toBeDefined();
    expect(outcome.success).toBe(true);
  });

  it("should get outcomes for a skill", () => {
    tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: true,
      duration: 1000,
      context: { inputSummary: "", outputSummary: "", toolCalls: [] },
    });

    tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: false,
      duration: 2000,
      context: { inputSummary: "", outputSummary: "", toolCalls: [] },
    });

    const outcomes = tracker.getOutcomes("skill1");
    expect(outcomes).toHaveLength(2);
  });

  it("should get statistics", () => {
    tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: true,
      duration: 1000,
      context: { inputSummary: "", outputSummary: "", toolCalls: [] },
    });

    tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: false,
      duration: 2000,
      errorType: "timeout",
      context: { inputSummary: "", outputSummary: "", toolCalls: [] },
    });

    const stats = tracker.getStats("skill1");
    expect(stats.totalExecutions).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.failurePatterns).toHaveLength(1);
  });

  it("should detect consecutive failures", () => {
    for (let i = 0; i < 3; i++) {
      tracker.record({
        skillId: "skill1",
        workspaceId: "ws1",
        success: false,
        duration: 1000,
        context: { inputSummary: "", outputSummary: "", toolCalls: [] },
      });
    }

    expect(tracker.detectConsecutiveFailures("skill1", 3)).toBe(true);
  });

  it("should get success rate trend", () => {
    for (let i = 0; i < 20; i++) {
      tracker.record({
        skillId: "skill1",
        workspaceId: "ws1",
        success: i % 2 === 0,  // Alternating success/failure
        duration: 1000,
        context: { inputSummary: "", outputSummary: "", toolCalls: [] },
      });
    }

    const trend = tracker.getSuccessRateTrend("skill1", 5);
    expect(trend.length).toBeGreaterThan(0);
  });

  it("should export and import data", () => {
    tracker.record({
      skillId: "skill1",
      workspaceId: "ws1",
      success: true,
      duration: 1000,
      context: { inputSummary: "", outputSummary: "", toolCalls: [] },
    });

    const data = tracker.exportData();
    expect(data).toHaveLength(1);

    const newTracker = createOutcomeTracker();
    newTracker.importData(data);
    expect(newTracker.getOutcomes("skill1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Skill Evolution Tests
// ---------------------------------------------------------------------------

describe("SkillEvolution", () => {
  let tracker: OutcomeTracker;
  let evolution: SkillEvolution;
  let testSkill: SkillDefinition;

  beforeEach(() => {
    tracker = createOutcomeTracker();
    evolution = createSkillEvolution(tracker);
    testSkill = {
      id: "skill1",
      name: "Test Skill",
      trigger: "test task",
      toolSequence: [
        { toolName: "step1", input: {} },
        { toolName: "step2", input: {} },
      ],
      parameters: { timeout: 5000 },
    };
  });

  it("should analyze a skill", () => {
    // Add some outcomes
    for (let i = 0; i < 10; i++) {
      tracker.record({
        skillId: "skill1",
        workspaceId: "ws1",
        success: i < 7,  // 70% success rate
        duration: 1000 + i * 100,
        context: { inputSummary: "", outputSummary: "", toolCalls: [] },
      });
    }

    const report = evolution.analyze(testSkill);
    expect(report.skillId).toBe("skill1");
    expect(report.totalExecutions).toBe(10);
    expect(report.successRate).toBe(0.7);
  });

  it("should generate variants", () => {
    const variant = evolution.generateVariant(testSkill, {
      type: "parameter",
      description: "Optimize parameters",
      estimatedImpact: 0.2,
    });

    expect(variant.id).toBeDefined();
    expect(variant.skillId).toBe("skill1");
    expect(variant.version).toBe(1);
  });

  it("should get variants", () => {
    evolution.generateVariant(testSkill, {
      type: "parameter",
      description: "Test",
      estimatedImpact: 0.1,
    });

    const variants = evolution.getVariants("skill1");
    expect(variants).toHaveLength(1);
  });

  it("should update variant stats", () => {
    const variant = evolution.generateVariant(testSkill, {
      type: "parameter",
      description: "Test",
      estimatedImpact: 0.1,
    });

    evolution.updateVariantStats(variant.id, true);
    evolution.updateVariantStats(variant.id, true);
    evolution.updateVariantStats(variant.id, false);

    const updated = evolution.getVariants("skill1")[0];
    expect(updated?.executionCount).toBe(3);
    expect(updated?.successRate).toBeGreaterThan(0);
  });

  it("should export and import data", () => {
    evolution.generateVariant(testSkill, {
      type: "parameter",
      description: "Test",
      estimatedImpact: 0.1,
    });

    const data = evolution.exportData();
    expect(data).toHaveLength(1);

    const newEvolution = createSkillEvolution(tracker);
    newEvolution.importData(data);
    expect(newEvolution.getVariants("skill1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Thompson Bandit Tests
// ---------------------------------------------------------------------------

describe("ThompsonBandit", () => {
  let bandit: ThompsonBandit;

  beforeEach(() => {
    bandit = createThompsonBandit();
  });

  it("should register arms", () => {
    bandit.registerArm("skill1");
    bandit.registerArm("skill2", "variant1");

    const arms = bandit.getAllArms();
    expect(arms).toHaveLength(2);
  });

  it("should select an arm", () => {
    bandit.registerArm("skill1");
    bandit.registerArm("skill2");

    const selection = bandit.select();
    expect(selection.skillId).toBeDefined();
    expect(selection.confidence).toBeGreaterThan(0);
  });

  it("should record rewards", () => {
    bandit.registerArm("skill1");
    bandit.registerArm("skill2");

    bandit.success("skill1");
    bandit.success("skill1");
    bandit.failure("skill2");

    const arm1 = bandit.getArm("skill1");
    const arm2 = bandit.getArm("skill2");

    expect(arm1?.alpha).toBe(3);  // 1 prior + 2 successes
    expect(arm2?.beta).toBe(2);   // 1 prior + 1 failure
  });

  it("should get expected reward", () => {
    bandit.registerArm("skill1");
    bandit.success("skill1");
    bandit.success("skill1");

    const reward = bandit.getExpectedReward("skill1");
    expect(reward).toBeGreaterThan(0.5);  // Should be > 50% with 2 successes
  });

  it("should get statistics", () => {
    bandit.registerArm("skill1");
    bandit.registerArm("skill2");

    bandit.success("skill1");
    bandit.failure("skill2");

    const stats = bandit.getStats();
    expect(stats.totalArms).toBe(2);
    expect(stats.totalPulls).toBe(2);
  });

  it("should select best arm", () => {
    bandit.registerArm("skill1");
    bandit.registerArm("skill2");

    // Make skill1 better
    for (let i = 0; i < 10; i++) {
      bandit.success("skill1");
    }
    for (let i = 0; i < 10; i++) {
      bandit.failure("skill2");
    }

    const selection = bandit.selectBest();
    expect(selection.skillId).toBe("skill1");
  });

  it("should export and import data", () => {
    bandit.registerArm("skill1");
    bandit.success("skill1");

    const data = bandit.exportData();
    expect(data).toHaveLength(1);

    const newBandit = createThompsonBandit();
    newBandit.importData(data);
    expect(newBandit.getAllArms()).toHaveLength(1);
  });
});
