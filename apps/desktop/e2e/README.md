# Carbon Agent Desktop E2E Tests

This directory contains Electron end-to-end tests using Playwright.

## Running locally

1. Install Playwright browsers (one-time):
   `https://pnpm --filter carbon-agent-desktop e2e:install`

2. Build the TypeScript main + renderer output:
   `https://pnpm --filter carbon-agent-desktop build`

   > Note: `dist/main.js` and `dist/renderer/` are produced by `tsc`. The renderer still relies on the `index.html` and compiled assets in `dist/renderer/`.

3. Run the tests:
   `https://pnpm --filter carbon-agent-desktop e2e`

## Headless / CI environments

If the environment cannot open a real window, Playwright will fall back to running Electron in headless mode on most Linux CI runners. For local systems without an X server, run with:

```bash
xvfb-run pnpm --filter carbon-agent-desktop e2e
```

On Wayland-only desktops Playwright may need `WAYLAND_DISPLAY` unset or XWayland available.

## Visual regression

Baseline snapshots are stored under `e2e/__snapshots__/`. New snapshots can be recorded with:

```bash
pnpm --filter carbon-agent-desktop e2e --update-snapshots
```

- `maxDiffPixelRatio` is set to `0.05` in `playwright.config.ts`.
- Snapshots should be committed for stable reference environments only; the directory is gitignored by default in this repo for generated test outputs.
