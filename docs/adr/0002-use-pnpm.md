# ADR-0002: Use pnpm for Package Management

## Status
Accepted

## Context
The project is a monorepo with multiple packages that share dependencies. We need an efficient, fast, and disk-space-friendly package manager.

## Decision
Use pnpm as the package manager with workspaces for the monorepo. Lockfile version 9+ for modern features.

## Consequences

### Positive
- Content-addressable store saves disk space (single copy of each package version)
- Fast installs via hard links/symlinks
- Strict dependency resolution prevents phantom dependencies
- Native workspace support for monorepos
- Better performance than npm/yarn for large monorepos

### Negative
- Some packages may have compatibility issues (rare)
- Team members need to install pnpm
- CI/CD needs pnpm setup step

### Neutral
- pnpm-lock.yaml must be committed
- Node.js version 22+ required (matches project engines)

## Related
- `pnpm-workspace.yaml` for workspace configuration
- `.github/workflows/ci.yml` uses `pnpm/action-setup@v3`
- Root `package.json` defines workspaces

---

*Created: 2024-06-01*
*Last Updated: 2024-06-01*