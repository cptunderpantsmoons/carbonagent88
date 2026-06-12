# 10. Appendix

## A.1 Complete File Inventory

### Monorepo Source Files (excluding node_modules, dist, .git)

```mermaid
graph TB
    subgraph "Root"
        R1[package.json]
        R2[pnpm-workspace.yaml]
        R3[pnpm-lock.yaml]
        R4[eslint.config.mjs]
        R5[README.md]
        R6[PROGRESS.md]
        R7[GUI_RECTIFICATION_REPORT.md]
        R8[JUDGE_EVALUATION_REPORT.md]
        R9[WORKING_OBJECTIVES.md]
    end

    subgraph "apps/desktop/src"
        D1[main.ts]
        D2[preload.ts]
        D3[ipc-handlers.ts]
        D4[agent-runner.ts]
        D5[watcher-manager.ts]
        D6[document-generator.ts]
        D7[document-records.ts]
        D8[db-context.ts]
        D9[session-events.ts]
        D10[desktop-events.ts]
        D11[cli-subagent.ts]
        D12[global.d.ts]
    end

    subgraph "apps/desktop/src/renderer"
        R13[renderer.ts]
        R14[styles.css]
        R15[vault.ts]
        R16[topology.ts]
        R17[axtree.ts]
        R18[components.ts]
        R19[view-helpers.ts]
        R20[ui-components.ts]
        R21[watcher-analytics.ts]
        R22[index.html]
        R23[types.d.ts]
    end

    subgraph "views/"
        V1[playground-view.ts]
        V2[session-view.ts]
        V3[profiles-view.ts]
        V4[providers-view.ts]
        V5[workspaces-view.ts]
        V6[ingestion-view.ts]
        V7[skills-view.ts]
        V8[watchers-view.ts]
        V9[outputs-view.ts]
    end

    subgraph "packages/shared-schemas"
        S1[src/index.ts]
    end

    subgraph "packages/core-runtime"
        C1[src/index.ts]
        C2[src/agent.ts]
        C3[src/gateway.ts]
        C4[src/orchestrator.ts]
        C5[src/browser-orchestration.ts]
        C6[src/skills.ts]
        C7[src/providers/anthropic.ts]
        C8[src/providers/openai.ts]
        C9[src/providers/custom-openai.ts]
    end

    subgraph "packages/cloak-bridge"
        CB1[src/index.ts]
    end

    subgraph "packages/ingestion"
        I1[src/index.ts]
        I2[src/graph.ts]
        I3[src/semantic-embed.ts]
    end

    subgraph "packages/local-store"
        L1[src/index.ts]
        L2[src/sqlite.ts]
        L3[src/memory.ts]
        L4[src/model-roles.ts]
        L5[src/skills.ts]
        L6[src/crypto.ts]
        L7[src/jsonl.ts]
        L8[src/paths.ts]
    end

    style D3 fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style R13 fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style S1 fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    style C2 fill:#fce4ec,stroke:#c2185b,stroke-width:2px
```

## A.2 JUDGE Evaluation Framework

Quality gates used to evaluate all GUI iterations:

```mermaid
graph TB
    subgraph "JUDGE Evaluation Gates"
        G1[Gate 1: Visual Hierarchy & Cohesion]
        G2[Gate 2: Information Density & Clarity]
        G3[Gate 3: Architectural Integrity]
        G4[Gate 4: Provisional Polish]
    end

    G1 --> C1[Typography scale
    Navigation groups
    Status color system]
    G2 --> C2[Session context
    File tree with search
    Operational status
    Pipeline phases]
    G3 --> C3[No IPC changes
    TypeScript clean
    Zero backend logic changes]
    G4 --> C4[Version badge
    Zero inline styles
    Zero Unicode symbols]

    G1 -.->|Pass| R[Overall: PASS]
    G2 -.->|Pass| R
    G3 -.->|Pass| R
    G4 -.->|Pass| R

    style R fill:#e8f5e9,stroke:#2e7d32,stroke-width:3px
    style G1 fill:#e3f2fd
    style G2 fill:#fff3e0
    style G3 fill:#fce4ec
    style G4 fill:#e0f2f1
```

| Gate | Criteria | Iteration 6 Result |
|------|----------|-------------------|
| **Gate 1** | Visual hierarchy established, typography scale, nav groups | ✅ PASS |
| **Gate 2** | Session context, info density, inspector panel, pipeline phases | ✅ PASS |
| **Gate 3** | No IPC changes, strict UI-only, clean typecheck | ✅ PASS |
| **Gate 4** | Version badge design, zero inline styles, zero Unicode | ✅ PASS |

## A.3 Design System Tokens

### Typography

```mermaid
graph LR
    subgraph "Font Stack"
        F1[IBM Plex Sans
    400, 500, 600, 700]
        F2[IBM Plex Mono
    400, 500]
    end

    F1 --> B[Body text]
    F1 --> H[Headings]
    F2 --> C[Code blocks]
    F2 --> M[Metadata]

    style F1 fill:#e3f2fd
    style F2 fill:#fff3e0
```

### Size Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--font-xs` | 11px | Metadata, timestamps, badges |
| `--font-sm` | 12px | Secondary labels, small text |
| `--font-base` | 14px | Body text, primary content |
| `--font-lg` | 17px | Section headings, card titles |
| `--font-xl` | 20px | Page titles |

### Layout Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--sidebar-width` | 200px | Navigation panel |
| `--sidebar-collapsed` | 60px | Collapsed nav (future) |
| `--topbar-height` | 48px | Top bar |
| `--inspector-width` | 380px | Right detail panel |
| `--border-radius` | 6px | Card corners |
| `--border-radius-sm` | 4px | Button corners |

### Spacing Scale

| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 12px |
| `--space-lg` | 16px |
| `--space-xl` | 24px |
| `--space-2xl` | 32px |

## A.4 Color System

```mermaid
graph LR
    subgraph "Semantic Colors"
        P[Primary Blue]
        S[Success Green]
        D[Danger Red]
        W[Warning Yellow]
        I[Info Cyan]
        N[Neutral Gray]
    end

    P --> A[Active nav item]
    S --> B[Healthy status]
    D --> C[Failed status]
    W --> D[Warning badge]
    I --> E[Running status]
    N --> F[Idle / Default]

    style P fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style S fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style D fill:#ffebee,stroke:#c62828,stroke-width:2px
    style W fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    style I fill:#e0f2f1,stroke:#00897b,stroke-width:2px
    style N fill:#f5f5f5,stroke:#616161,stroke-width:2px
```

## A.5 Icon System Reference

### CSS Icon Classes

```mermaid
graph LR
    subgraph "Navigation Icons"
        I1[.icon-playground]
        I2[.icon-sessions]
        I3[.icon-vault]
        I4[.icon-providers]
        I5[.icon-profiles]
        I6[.icon-workspace]
        I7[.icon-skills]
        I8[.icon-watcher]
        I9[.icon-output]
    end

    subgraph "Rendered Via CSS ::before"
        CSS[content: "●"]
    end

    I1 --> CSS
    I2 --> CSS
    I3 --> CSS

    style CSS fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## A.6 Build Configuration

### Electron Builder Config

| Property | Value |
|----------|-------|
| `appId` | `com.corporatecarbon.carbon-agent` |
| `productName` | `Carbon Agent` |
| `outputDir` | `release/` |
| `files` | `dist/**/*`, `src/renderer/**/*` |
| `win.target` | `nsis` |
| `nsis.oneClick` | `false` |
| `nsis.allowToChangeInstallationDirectory` | `true` |
| `mac.target` | `dmg` |
| `linux.target` | `AppImage` |

## A.7 External Dependencies

### Production

| Package | Version | Purpose |
|---------|---------|---------|
| `electron` | ^33.0.0 | Desktop shell |
| `docx` | ^9.7.1 | Document generation |
| `pdf-lib` | ^1.17.1 | PDF manipulation |
| `better-sqlite3` | latest | SQLite driver |
| `zod` | latest | Schema validation |
| `@xenova/transformers` | ^2.17.2 | Local embeddings |
| `cron-parser` | ^5.5.0 | Cron expression parsing |

### Dev

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.7.0 | Type checker |
| `vitest` | ^3.0.0 | Test runner |
| `electron-builder` | ^25.1.0 | App packaging |
| `eslint` | ^10.4.1 | Linter |
| `@electron/*` | ^33.0.0 | Electron types |

## A.8 License & Legal

```
All rights reserved.
Corporate Carbon Pty Ltd
```

## A.9 Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-06 | Initial release, all 15 views, browser orchestration spec |

## A.10 Quick Command Reference

```mermaid
graph LR
    subgraph "Development Commands"
        I[pnpm install] --> B[pnpm build]
        B --> T[pnpm test]
        T --> L[pnpm lint]
        L --> D[cd apps/desktop
    && pnpm dev]
    end

    style I fill:#e3f2fd
    style D fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

| Task | Command |
|------|---------|
| Install deps | `pnpm install` |
| Build all | `pnpm build` |
| Type check | `pnpm typecheck` |
| Test all | `pnpm test` |
| Lint | `pnpm lint` |
| Fix lint | `pnpm lint:fix` |
| Start dev | `cd apps/desktop && pnpm dev` |
| Test desktop | `cd apps/desktop && pnpm test` |

---

## A.11 Wiki File Map

| File | Contents |
|------|----------|
| `WIKI.md` | Master index + quick reference |
| `01-SYSTEM-OVERVIEW.md` | Architecture at a glance |
| `02-ARCHITECTURE.md` | Detailed system architecture |
| `03-ELECTRON-APP.md` | Main process, IPC, agent runner |
| `04-PACKAGES.md` | Package reference & APIs |
| `05-USER-INTERFACE.md` | All 13 views + design system |
| `06-DATA-MODELS.md` | Entity relationships & state machines |
| `07-CORE-FEATURES.md` | Feature diagrams & flows |
| `08-BROWSER-ORCHESTRATION.md` | Multi-agent collection |
| `09-DEVELOPER-GUIDE.md` | Build, test, security |
| `10-APPENDIX.md` | File inventory, tokens, commands |

---

*Wiki Generated: 2026-06-06*
*Carbon Agent v0.1.0*
*Total Wiki Files: 11*
*Total Diagrams: 40+*
