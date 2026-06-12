# ADR-0001: Use TypeScript for All Packages

## Status
Accepted

## Context
The project is a monorepo with multiple packages and a desktop application. We need consistent type safety across all codebases to prevent runtime errors and improve developer experience.

## Decision
All packages and applications will use TypeScript with strict mode enabled. Configuration will be shared via a root `tsconfig.base.json` with package-specific extensions.

## Consequences

### Positive
- Compile-time type checking catches errors early
- Better IDE support and refactoring
- Self-documenting code through types
- Easier onboarding for new contributors

### Negative
- Additional build step required
- Learning curve for team members unfamiliar with TypeScript
- Slightly more verbose code

### Neutral
- Migration from JavaScript would be needed for any existing JS code

## Related
- Root `tsconfig.base.json` for shared configuration
- Each package has its own `tsconfig.json` extending the base
- ESLint with `typescript-eslint` for linting

---

*Created: 2024-06-01*
*Last Updated: 2024-06-01*