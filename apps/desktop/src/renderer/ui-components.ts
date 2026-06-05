function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export const Toast = {
  show(message: string, type: "success" | "error" | "warning" | "info" = "info", duration = 3000): void {
    let container = document.getElementById("toast-container") as HTMLElement | null;
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add("toast-exit");
      el.addEventListener("animationend", () => el.remove());
    }, duration);
  },
};

export const Modal = {
  confirm(title: string, body: string): Promise<boolean> {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.innerHTML = `
        <div class="modal">
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-body">${escapeHtml(body)}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary modal-cancel">Cancel</button>
            <button class="btn btn-danger modal-confirm">Confirm</button>
          </div>
        </div>
      `;

      const cancelBtn = backdrop.querySelector(".modal-cancel") as HTMLButtonElement;
      const confirmBtn = backdrop.querySelector(".modal-confirm") as HTMLButtonElement;

      const cleanup = () => backdrop.remove();
      cancelBtn.onclick = () => { cleanup(); resolve(false); };
      confirmBtn.onclick = () => { cleanup(); resolve(true); };
      backdrop.onclick = (event) => {
        if (event.target === backdrop) {
          cleanup();
          resolve(false);
        }
      };

      document.body.appendChild(backdrop);
    });
  },
};
