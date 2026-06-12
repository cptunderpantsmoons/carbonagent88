# ADR-0003: Electron for Desktop Application

## Status
Accepted

## Context
The Carbon Agent needs a cross-platform desktop application that can run on Windows, macOS, and Linux. The app needs to integrate with local file systems, run background processes, and provide a rich UI.

## Decision
Use Electron as the desktop framework with:
- TypeScript for main and renderer processes
- Vite for renderer bundling
- electron-builder for packaging
- electron-updater for auto-updates

## Consequences

### Positive
- Mature, well-supported framework
- Large ecosystem and community
- Full Node.js access in main process
- Cross-platform with single codebase
- Good developer tooling (DevTools)
- Native OS integration capabilities

### Negative
- Large bundle size (~100MB+)
- Higher memory usage than native apps
- Security considerations (context isolation, sandbox)
- Version upgrades can be breaking

### Neutral
- Requires maintaining main/renderer process separation
- IPC communication needed between processes
- ASAR packaging for production

## Related
- `apps/desktop/package.json` for Electron config
- `electron-builder` config in package.json build section
- IPC patterns defined in `@carbon-agent/cloak-bridge`

---

*Created: 2024-06-01*
*Last Updated: 2024-06-01*