/**
 * Shared UI components — used by renderer sub-modules
 */

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function createEmptyState(iconClass: string, title: string, text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-state-icon ${iconClass}"></div>
    <div class="empty-state-title">${escapeHtml(title)}</div>
    <div class="empty-state-text">${escapeHtml(text)}</div>
  `;
  return div;
}

export const Toast = {
  show(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration = 3000): void {
    let container = document.getElementById('toast-container') as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-exit');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  },
};
