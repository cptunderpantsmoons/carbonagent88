# Carbon Agent
<details open><summary><b>Click to expand/collapse</b><br/></summary>
<a href="https://github.com/psf/black"><img alt="Code style: black" src="https://img.shields.io/badge/code%20style-black-000000.svg"></a>
</details>

Enterprise document reasoning with authenticated browser sessions.

## Quick Start

```bash
pnpm install
pnpm build
```

## Architecture

```
carbon-agent/
├── apps/desktop/          # Electron desktop app
├── packages/
│   ├── shared-schemas/    # Zod schemas & IPC contracts
│   ├── core-runtime/      # Agent loop, tools, LLM gateway
│   ├── cloak-bridge/      # CloakBrowser session control
│   ├── ingestion/         # File parsing, chunking, local RAG
│   └── local-store/       # SQLite/filesystem adapters
```

## License

All rights reserved.
