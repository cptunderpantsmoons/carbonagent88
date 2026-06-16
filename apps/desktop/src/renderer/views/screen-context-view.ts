/**
 * Screen Context view.
 *
 * Subscribes to screen-context events and shows active window metadata +
 * screenshot, reusing styles from the live-viewport panel.
 */

let cleanupListener: (() => void) | null = null;

function escapeHtml(value: unknown): string {
  const text = value == null ? "" : String(value);
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

export function renderScreenContext(container: HTMLElement): void {
  container.innerHTML = `
    <div class="screen-context-view">
      <h2>Screen Context</h2>
      <div id="screen-context-meta" class="screen-context-meta">Waiting for events…</div>
      <div id="screen-context-image" class="screen-context-image"></div>
      <div class="screen-context-actions">
        <button class="btn btn-primary" id="btn-capture-window">Capture Window</button>
        <button class="btn btn-secondary" id="btn-capture-screen">Capture Screen</button>
        <button class="btn btn-secondary" id="btn-poll-start">Start Polling</button>
        <button class="btn btn-secondary" id="btn-poll-stop">Stop Polling</button>
      </div>
    </div>
  `;

  const meta = container.querySelector<HTMLElement>("#screen-context-meta");
  const image = container.querySelector<HTMLElement>("#screen-context-image");

  const listener = window.carbonAPI.onScreenContext?.((data) => {
    if (!meta || !image) return;
    meta.innerHTML = `
      <div><strong>${escapeHtml(data.window.app)}</strong></div>
      <div>${escapeHtml(data.window.title)}</div>
      <div class="screen-context-bounds">${data.window.bounds.width}×${data.window.bounds.height} @ ${data.window.bounds.x},${data.window.bounds.y}</div>
      <div class="screen-context-time">${escapeHtml(data.window.timestamp)}</div>
    `;
    if (data.image?.base64) {
      image.innerHTML = `<img class="img-viewport" src="data:${data.image.mimeType ?? "image/jpeg"};base64,${data.image.base64}" alt="Screen context" />`;
    } else {
      image.innerHTML = `<div class="live-viewport-placeholder">No image captured.</div>`;
    }
  });

  if (listener) cleanupListener = listener;

  container.querySelector<HTMLButtonElement>("#btn-capture-window")?.addEventListener("click", () => {
    void window.carbonAPI.invoke({ type: "screen-context/capture-window" });
  });
  container.querySelector<HTMLButtonElement>("#btn-capture-screen")?.addEventListener("click", () => {
    void window.carbonAPI.invoke({ type: "screen-context/capture-screen" });
  });
  container.querySelector<HTMLButtonElement>("#btn-poll-start")?.addEventListener("click", () => {
    void window.carbonAPI.invoke({ type: "screen-context/start-polling" });
  });
  container.querySelector<HTMLButtonElement>("#btn-poll-stop")?.addEventListener("click", () => {
    void window.carbonAPI.invoke({ type: "screen-context/stop-polling" });
  });
}

export function cleanupScreenContext(): void {
  if (cleanupListener) {
    cleanupListener();
    cleanupListener = null;
  }
}
