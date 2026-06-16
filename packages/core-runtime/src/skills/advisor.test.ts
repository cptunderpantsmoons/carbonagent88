/**
 * Skill Advisor — Learning Layer Tests
 */

import { describe, it, expect } from "vitest";
import { SkillAdvisor, createSkillAdvisor } from "./advisor.js";
import type { SkillDefinition } from "./evolution.js";

const createTestSkill = (): SkillDefinition => ({
  id: "skill-advisor-test",
  name: "Test Skill",
  trigger: "run test skill",
  toolSequence: [{ toolName: "noop", input: {} }],
  parameters: { timeout: 1000 },
});

describe("SkillAdvisor", () => {
  it("should instantiate via factory and class", () => {
    const a1 = createSkillAdvisor();
    expect(a1).toBeInstanceOf(SkillAdvisor);

    const a2 = new SkillAdvisor();
    expect(a2).toBeInstanceOf(SkillAdvisor);
  });

  it("should record outcomes and shift bandit expected reward", () => {
    const advisor = new SkillAdvisor();
    const bandit = (advisor as unknown as { bandit: { getExpectedReward(skillId: string): number } }).bandit;

    // No arm registered yet.
    expect(bandit.getExpectedReward("skill1")).toBe(0);

    advisor.recordOutcome("skill1", true, 1000);
    const afterSuccess = bandit.getExpectedReward("skill1");
    expect(afterSuccess).toBeGreaterThan(0.5);

    advisor.recordOutcome("skill1", false, 1000);
    const afterFailure = bandit.getExpectedReward("skill1");
    expect(afterFailure).toBeLessThan(afterSuccess);
  });

  it("should select a variant with a confidence score", () => {
    const advisor = new SkillAdvisor();

    advisor.recordOutcome("skill1", true, 100);
    const selection = advisor.selectVariant("skill1");
    expect(selection.skillId).toBe("skill1");
    expect(selection.confidence).toBeGreaterThanOrEqual(0);
    expect(selection.confidence).toBeLessThanOrEqual(1);
  });

  it("should analyze a skill and return an evolution report", () => {
    const advisor = new SkillAdvisor();
    const skill = createTestSkill();

    const report = advisor.analyzeSkill(skill);
    expect(report.skillId).toBe(skill.id);
    expect(report.totalExecutions).toBe(0);
    expect(report.successRate).toBe(0);
    expect(Array.isArray(report.commonFailures)).toBe(true);
    expect(Array.isArray(report.improvementOpportunities)).toBe(true);
  });

  it("should include a recommended variant when there are opportunities", () => {
    const advisor = new SkillAdvisor();
    const skill: SkillDefinition = {
      ...createTestSkill(),
      toolSequence: Array.from({ length: 7 }, (_, i) => ({
        toolName: `step${i}`,
        input: {},
      })),
    };

    const report = advisor.analyzeSkill(skill);
    expect(report.improvementOpportunities.length).toBeGreaterThan(0);
    expect(report.recommendedVariant).toBeDefined();
    expect(report.recommendedVariant?.skillId).toBe(skill.id);
  });
});
