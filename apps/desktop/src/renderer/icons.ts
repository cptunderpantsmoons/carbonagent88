/**
 * Inline SVG icon system for the Carbon Agent renderer.
 *
 * All icons are monochromatic, 16x16 viewBox, and use currentColor so they inherit
 * the surrounding text color. No external icon font or dependency is required.
 */

export type IconName =
  | "playground"
  | "sessions"
  | "vault"
  | "watchers"
  | "workspaces"
  | "ingestion"
  | "outputs"
  | "harnesses"
  | "providers"
  | "profiles"
  | "skills"
  | "topology"
  | "axtree"
  | "analytics"
  | "monitor"
  | "empty"
  | "input"
  | "output"
  | "browser"
  | "claude-code"
  | "codex"
  | "local"
  | "plus"
  | "switch"
  | "launch"
  | "clear"
  | "settings";

const ICON_PATHS: Record<IconName, string> = {
  // Core – filled circle ringed to evoke an active control surface
  playground:
    "M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 2.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z",

  // Sessions – stacked rectangles resembling browser tabs/runs
  sessions:
    "M2 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-9Z M3.5 3a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5Z",

  // Vault – closed box / safe
  vault:
    "M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Zm2 1v6h8V5H4Zm3 2h2v1.5H7V7Z",

  // Watchers – eye with clock motif
  watchers:
    "M8 3c-3 0-5.5 2.5-6 3 .5.5 3 3 6 3s5.5-2.5 6-3c-.5-.5-3-3-6-3Zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM8 10v2.5M6.5 12.5h3",

  // Workspaces – layered panes / windows
  workspaces:
    "M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-9ZM5 7h6v5H5V7Zm1 1v3h4V8H6Z",

  // Ingestion – arrow into tray / inbox
  ingestion:
    "M8 2v7M5.5 5.5L8 8l2.5-2.5M2 10.5h12v2a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-2Z",

  // Outputs – document with folded corner
  outputs:
    "M9 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.5V2H9Zm0 0v3h3L9 2Z M5.5 7h5M5.5 9.5h5",

  // Harnesses – puzzle piece
  harnesses:
    "M5.5 2a1.5 1.5 0 0 1 3 0v1.5H12v2.5h-1.5a1.5 1.5 0 0 0 0 3H12V12H8.5v1.5a1.5 1.5 0 0 1-3 0V12H2V9.5h1.5a1.5 1.5 0 0 0 0-3H2V3.5h3.5V2Z",

  // Providers – crystal / diamond facet
  providers:
    "M8 1.5l6.5 6.5L8 14.5 1.5 8 8 1.5ZM8 3.5L3.5 8 8 12.5 12.5 8 8 3.5Z",

  // Profiles / cloak bridge – mask / bridge arch
  profiles:
    "M8 2a5 5 0 0 0-5 5v4a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V7a5 5 0 0 0-5-5Zm0 1a4 4 0 0 1 4 4v3.5H4V7a4 4 0 0 1 4-4Zm-2 4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z",

  // Skills – lightbulb / sparkle
  skills:
    "M8 1a4 4 0 0 0-4 4 4 4 0 0 0 3 3.86V11H6v1.5h4V11H9V8.86A4 4 0 0 0 12 5a4 4 0 0 0-4-4Zm0 1.5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1-2 2.45V10H6V7.45A2.5 2.5 0 0 1 8 2.5ZM7 13h2v1H7v-1Z",

  // Topology – connected nodes / graph
  topology:
    "M10.5 3.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm8 0a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM6.8 8.8l2.4 1.4M9.2 8.8l-2.4 1.4",

  // AXTree – hierarchy / branching tree
  axtree:
    "M5.5 2v2.5M5.5 5.5H9a1.5 1.5 0 0 1 1.5 1.5v2M5.5 5.5H3A1.5 1.5 0 0 0 1.5 7v2M5.5 5.5V8M5.5 11.5v2",

  // Analytics – simple bar chart
  analytics:
    "M2 12.5V8h3v4.5H2Zm4.5 0V4h3v8.5h-3Zm4.5 0V6h3v6.5h-3Z",

  // Monitor – screen context daemon
  monitor:
    "M2 3.5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 10.5v-7Zm1.5-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-9ZM6 13h4v1.5H6V13Z",

  // Empty / placeholder – dashed square
  empty:
    "M4.5 3.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm0 1v7h7v-7h-7Z",

  // Input – arrow entering left side
  input:
    "M10 2.5v3h-6v-3h-2v11h2v-3h6v3h2v-11h-2ZM5 8l2.5 2.5L5 13v-2H2V8h3Z",

  // Output – arrow exiting right side
  output:
    "M2 2.5v3h6v-3h2v11h-2v-3h-6v3h-2v-11h2Zm9 5.5l-2.5 2.5 2.5 2.5v-2h3V8h-3Z",

  // Browser – window with pointer / location bar
  browser:
    "M2.5 3h11a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Zm1 1v1.5h9V4h-9Zm0 2.5v5.5h9V6.5h-9ZM4 5h1v.5H4V5Z",

  // Claude Code – stylized "C" bracket suggestive of code assistant
  "claude-code":
    "M10.5 3.5l-5 9M13 7a3 3 0 0 0-3-3M3 9a3 3 0 0 0 3 3",

  // Codex – angle brackets with slash
  codex:
    "M5 2.5L1.5 8 5 13.5M11 2.5L14.5 8 11 13.5M9 1l-2 14",

  // Local – home / box on desk
  local:
    "M8 1.5L1.5 6.5v8h13v-8L8 1.5Zm0 1.5l5 3.75v5.25H3v-5.25l5-3.75Z M6 10.5h4v2H6v-2Z",

  // Plus – simple plus sign
  plus:
    "M8 2.5v11M2.5 8h11",

  // Switch – two arrows crossing
  switch:
    "M4.5 4.5L1.5 8l3 3.5M11.5 11.5l3-3.5-3-3.5M6 13h5M5 3h5",

  // Launch – play arrow inside rounded box
  launch:
    "M6 4.5l6 3.5-6 3.5V4.5Z M2.5 3h11a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5Z",

  // Clear – X
  clear:
    "M3 3l10 10M13 3L3 13",

  // Settings – gear
  settings:
    "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.5 1h3v1.6a5 5 0 0 1 1.4.8l1.1-1.1 2.1 2.1-1.1 1.1a5 5 0 0 1 .8 1.4H15v3h-1.6a5 5 0 0 1-.8 1.4l1.1 1.1-2.1 2.1-1.1-1.1a5 5 0 0 1-1.4.8V15h-3v-1.6a5 5 0 0 1-1.4-.8l-1.1 1.1-2.1-2.1 1.1-1.1a5 5 0 0 1-.8-1.4H1v-3h1.6a5 5 0 0 1 .8-1.4l-1.1-1.1 2.1-2.1 1.1 1.1a5 5 0 0 1 1.4-.8V1Z",
};

const DEFAULT_ICON: IconName = "empty";

export function icon(name: string, className?: string): string {
  const safeName = (name in ICON_PATHS ? name : DEFAULT_ICON) as IconName;
  const path = ICON_PATHS[safeName];
  const cls = className ? ` class="${className}"` : "";
  return `<svg${cls} viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
}
