import { createButton, createFormGroup, createInput, Toast } from "../view-helpers.js";

export function renderLogin(container: HTMLElement, onLogin: (token: string) => void): HTMLElement {
  container.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card login-card";
  card.innerHTML = `
    <div class="card-header"><div class="card-title">Sign In</div></div>
    <div class="card-subtitle">Enter your credentials to access Carbon Agent.</div>
  `;

  const emailInput = createInput("admin@local", "email");
  const passwordInput = createInput("password", "password");
  passwordInput.type = "password";
  card.append(
    createFormGroup("Email", emailInput),
    createFormGroup("Password", passwordInput),
  );

  const submitBtn = createButton("Sign In", "primary");
  submitBtn.className = "btn btn-primary w-100 mt-8";
  card.appendChild(submitBtn);
  container.appendChild(card);

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";
    try {
      const resp = await window.carbonAPI.invoke({ type: "auth/login", email: emailInput.value, password: passwordInput.value }) as { type: string; data?: { token?: string }; error?: string };
      if (resp.type === "auth/login.success" && resp.data?.token) {
        sessionStorage.setItem("carbonAuthToken", resp.data.token);
        Toast.show("Signed in", "success");
        onLogin(resp.data.token);
      } else {
        Toast.show(resp.error || "Sign in failed", "error");
      }
    } catch (e: unknown) {
      Toast.show(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign In";
    }
  });

  return card;
}
