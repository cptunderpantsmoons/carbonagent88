/**
 * Self-Improving Skill System — Barrel Exports
 *
 * Skill evolution, selection, and composition components for Carbon Agent.
 */

// Outcome tracker
export {
  OutcomeTracker,
  createOutcomeTracker,
  type SkillOutcome,
  type OutcomeStats,
} from "./outcome-tracker.js";

// Skill evolution
export {
  SkillEvolution,
  createSkillEvolution,
  type SkillVariant,
  type EvolutionReport,
  type SkillDefinition,
} from "./evolution.js";

// Thompson bandit
export {
  ThompsonBandit,
  createThompsonBandit,
  type BanditArm,
  type BanditSelection,
  type BanditStats,
} from "./bandit.js";
