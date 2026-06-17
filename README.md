# Carbon Agent

**Enterprise document reasoning with authenticated browser sessions.**

Carbon Agent is a desktop application that autonomously collects and reasons over documents from authenticated browser sessions — including Outlook, SharePoint, Monday, Xero, and browser-based spreadsheets — then assembles structured working sets with provenance tracking for downstream deliverables (financial statements, dashboards, reports, and more).

[![CI](https://github.com/cptunderpantsmoons/carbonagent88/actions/workflows/ci.yml/badge.svg)](https://github.com/cptunderpantsmoons/carbonagent88/actions/workflows/ci.yml)

---

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Development](#development)
- [Configuration](#configuration)
- [Security](#security)
- [Building & Distribution](#building--distribution)
- [License](#license)

---

## Quick Start

> **Requirements:** Node.js ≥ 22, pnpm ≥ 9

```bash
# Clone & install
gh repo clone your-org/carbon-agent
cd carbon-agent
pnpm install

# Run all tests (must pass before deployment)
pnpm test

# Build everything
pnpm build

# Start desktop app in development
pnpm --filter carbon-agent-desktop dev
```

---

## Architecture

```
carbon-agent/
├── .github/workflows/        # CI/CD (build, test, package, release)
├── apps/
│   └── desktop/              # Electron desktop app
│       ├── src/
│       │   ├── main.ts      # Electron main process
│       │   ├── preload.ts   # Secure IPC bridge (contextIsolation)
│       │   ├── renderer/    # UI (vanilla TS + CSS)
│       │   │   ├── index.html
│       │   │   ├── renderer.ts
│       │   │   ├── styles.css
│       │   │   └── views/   # View modules
│       │   ├── ipc-handlers.ts
│       │   ├── agent-runner.ts
│       │   ├── db-context.ts
│       │   ├── env.ts       # .env loading & validation
│       │   ├── secure-storage.ts  # safeStorage/OS keychain wrapper
│       │   └── ...
│       ├── assets/          # App icons (.ico, .icns, .png)
│       ├── build.sh
│       └── package.json
│
├── packages/
│   ├── shared-schemas/      # Zod schemas & IPC contracts
│   ├── core-runtime/        # Agent loop, LLM gateway, providers
│   ├── cloak-bridge/        # Playwright browser orchestration
│   ├── ingestion/           # File parsing, chunking, local RAG
│   └── local-store/         # SQLite/filesystem adapters, crypto
│
├── docs/                    # Architecture specs & plans
└── wiki/                    # Documentation
```

---

## Development

### Workspace Commands

```bash
pnpm lint           # ESLint all workspaces
pnpm lint:fix       # Auto-fix lint issues
pnpm -r typecheck   # TypeScript check all packages
pnpm -r test        # Run tests in all packages
pnpm -r build       # Build all packages
```

### Package Commands

```bash
# Desktop app only
pnpm --filter carbon-agent-desktop dev      # Launch Electron
pnpm --filter carbon-agent-desktop build    # Compile TypeScript
pnpm --filter carbon-agent-desktop dist     # Package with electron-builder

# Individual packages
pnpm --filter @carbon-agent/core-runtime test
pnpm --filter @carbon-agent/ingestion typecheck
```

---

## Configuration

### First-Run Setup

Create an `.env` file in your app data directory (or project root for development):

```bash
cp .env.example ~/.config/carbon-agent/.env   # Linux
# or
open -e ~/.config/carbon-agent/.env           # macOS
# or
notepad %APPDATA%/carbon-agent/.env           # Windows
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | *Optional* | OpenAI API key |
| `ANTHROPIC_API_KEY` | *Optional* | Anthropic API key |
| `CUSTOM_OPENAI_BASE_URL` | *Optional* | Custom OpenAI-compatible endpoint |
| `CUSTOM_OPENAI_API_KEY` | *Optional* | API key for custom endpoint |
| `CUSTOM_OPENAI_MODEL` | *Optional* | Model ID for custom endpoint |
| `CARBON_DATA_DIR` | *Optional* | Override default data directory |
| `CARBON_LOG_LEVEL` | *Optional* | `debug` \| `info` \| `warn` \| `error` |
| `CARBON_TELEMETRY` | *Optional* | `true` to enable anonymous analytics |

> The first provider with credentials will be seeded as the default on first start. All credentials are then encrypted at rest using AES-256-GCM (with OS keychain via Electron `safeStorage` on supported platforms).

---

## Security

- **Context Isolation**: Renderer process is fully sandboxed. IPC bridge is the only communication channel.
- **No Node Integration**: `nodeIntegration: false` in renderer.
- **Content Security Policy (CSP)**: Enforces `default-src 'self'` with controlled external font/style loading.
- **Credential Encryption**: API keys are encrypted at rest using AES-256-GCM with machine-derived keys, and `safeStorage`/OS keychain on platforms that support it (macOS, Windows, Linux with libsecret).
- **No Inline Scripts**: All JavaScript is delivered via `type="module"` script tags.
- **Process Sandboxing**: Chromium sandbox is enabled for the renderer.
- **noUnusedLocals / noUnusedParameters**: Strict TypeScript compilation prevents dead code paths that could hide security issues.

See `apps/desktop/src/secure-storage.ts` and `apps/desktop/src/preload.ts` for implementation details.

---

## Building & Distribution

### Development Build

```bash
cd apps/desktop
./build.sh           # Compiles TS + copies renderer assets
```

### Installer Distribution

```bash
cd apps/desktop
pnpm dist            # electron-builder (NSIS/DMG/AppImage)
```

The desktop package.json is configured to produce:
- **Windows**: `nsis` installer → `release/Carbon Agent Setup.exe`
- **macOS**: `dmg` → `release/Carbon Agent.dmg`
- **Linux**: `AppImage` → `release/Carbon Agent.AppImage`

### CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`):
- **Every push**: lint, typecheck, unit test across all workspaces
- **Release tag**: cross-platform build + artifact upload to release

---

## License

All rights reserved.

---

*Built with Electron, Playwright, TypeScript, SQLite, and vanilla JS.*
