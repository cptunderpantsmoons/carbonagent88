# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the Carbon Agent project.

## ADR List

| Number | Title | Status | Date |
|--------|-------|--------|------|
| 0001 | [Use TypeScript for All Packages](0001-use-typescript.md) | Accepted | 2024-06-01 |
| 0002 | [Use pnpm for Package Management](0002-use-pnpm.md) | Accepted | 2024-06-01 |
| 0003 | [Electron for Desktop Application](0003-electron-for-desktop.md) | Accepted | 2024-06-01 |

## Process

1. **When to create an ADR**: Any non-trivial architectural decision (new patterns, tech choices, structural changes)
2. **Naming**: `NNNN-short-title.md` (zero-padded 4 digits)
3. **Status flow**: Proposed → Accepted → (Superseded/Deprecated)
4. **Review**: ADRs are reviewed as part of code review via the ADR gate

## Template

Use [template.md](template.md) as a starting point for new ADRs.

## Reverse-Engineering

If you make a significant change without an ADR, the code review ADR gate will:
1. Detect the missing ADR
2. Draft one from git history
3. Ask you to confirm/create it

See [ADR Gate Protocol](../.claude/skills/code-review/adr-gate.md) for details.