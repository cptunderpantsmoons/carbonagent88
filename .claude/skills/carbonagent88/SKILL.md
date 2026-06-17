```markdown
# carbonagent88 Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill introduces the core development patterns and conventions used in the `carbonagent88` TypeScript codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns. By following these guidelines, contributors can ensure consistency and maintainability across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myComponent.ts`, `dataFetcher.test.ts`

### Imports
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { fetchData } from './dataFetcher';
    ```

### Exports
- Use **named exports** for all modules.
  - Example:
    ```typescript
    export function fetchData() { /* ... */ }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `chore` prefix for maintenance or non-feature changes.
  - Example:
    ```
    chore: update dependencies for security patch
    ```

## Workflows

### Code Update
**Trigger:** When adding, updating, or refactoring code.
**Command:** `/code-update`

1. Create or modify files using camelCase naming.
2. Use relative imports and named exports.
3. Write or update corresponding test files (`*.test.ts`).
4. Stage your changes.
5. Commit using the conventional format with a `chore` prefix.
    ```
    git commit -m "chore: refactor dataFetcher for performance"
    ```
6. Push your changes to the repository.

### Testing
**Trigger:** When verifying code correctness or before submitting a pull request.
**Command:** `/run-tests`

1. Ensure all test files follow the `*.test.ts` pattern.
2. Run your test suite using your preferred test runner.
    ```
    # Example (replace with actual command if known)
    npx ts-node dataFetcher.test.ts
    ```
3. Review test results and fix any failing tests.
4. Commit any necessary changes.

## Testing Patterns

- Test files are named with the pattern `*.test.ts`.
- The specific testing framework is not detected; use your preferred TypeScript-compatible test runner.
- Place test files alongside the modules they test or in a dedicated test directory.

**Example:**
```typescript
// dataFetcher.test.ts
import { fetchData } from './dataFetcher';

describe('fetchData', () => {
  it('should return expected data', () => {
    // test implementation
  });
});
```

## Commands
| Command        | Purpose                                         |
|----------------|-------------------------------------------------|
| /code-update   | Standard workflow for updating code             |
| /run-tests     | Run all test files and review results           |
```
