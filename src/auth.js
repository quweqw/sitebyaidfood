import { api } from "./api.js";
import { clearAuth, clearPendingEmail, isAdmin, isAuthenticated, saveAuth, savePendingEmail, saveUser, session } from "./session.js";
import { formValues, setStatus } from "./ui.js";

const authStatus = document.querySelector("#authStatus");
const sessionLabel = document.querySelector("#sessionLabel");
const chatGate = document.querySelector("#chatGate");
const chatShell = document.querySelector("#chatShell");
const adminNav = document.querySelector("[data-admin-only]");
const logoutButton = document.querySelector("#logoutButton");

export function initAuth() {
  bindTabs();
  bindForms();
  updateAuthUi();
  hydrateSession();
}

export function updateAuthUi() {
  const authenticated = isAuthenticated();
  sessionLabel.textContent = session.email || "Гость";
  chatGate.hidden = authenticated;
  chatShell.hidden = !authenticated;
  logoutButton.hidden = !authenticated;
  adminNav.hidden = !isAdmin();
}

async function hydrateSession() {
  if (!isAuthenticated()) return;
  try {
    const me = await api.me();
    saveUser(me);
  } catch {
    clearAuth();
  } finally {
    updateAuthUi();
  }
}

function bindTabs() {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
  });
}

function setAuthTab(name) {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === name);
  });
  document.querySelectorAll("[data-auth-pane]").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.authPane === name);
  });
  if (name === "verify" && session.pendingEmail) {
    document.querySelector("#verifyForm [name='email']").value = session.pendingEmail;
  }
}

function bindForms() {
  document.querySelector("#registerForm").addEventListener("submit", onRegister);
  document.querySelector("#verifyForm").addEventListener("submit", onVerify);
  document.querySelector("#loginForm").addEventListener("submit", onLogin);
  document.querySelector("#resendCodeButton").addEventListener("click", onResendCode);
  logoutButton.addEventListener("click", onLogout);
}

async function onRegister(event) {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  setStatus(authStatus, "Создаю аккаунт...");
  try {
    const response = await api.register(data.email, data.password);
    savePendingEmail(response.email || data.email);
    setStatus(authStatus, "Аккаунт создан. Введите код подтверждения из письма.", "ok");
    setAuthTab("verify");
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
}

async function onVerify(event) {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  setStatus(authStatus, "Проверяю код...");
  try {
    const response = await api.verifyEmail(data.email, data.code);
    saveAuth(response);
    clearPendingEmail();
    updateAuthUi();
    setStatus(authStatus, "Аккаунт подтвержден. Чат открыт.", "ok");
    window.location.hash = "#chat";
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
}

async function onLogin(event) {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  setStatus(authStatus, "Выполняю вход...");
  try {
    const response = await api.login(data.email, data.password);
    saveAuth(response);
    updateAuthUi();
    setStatus(authStatus, "Вход выполнен. Чат открыт.", "ok");
    window.location.hash = "#chat";
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
}

async function onResendCode() {
  const email = document.querySelector("#verifyForm [name='email']").value || session.pendingEmail;
  if (!email) {
    setStatus(authStatus, "Введите email для повторной отправки кода.", "error");
    return;
  }
  setStatus(authStatus, "Отправляю код повторно...");
  try {
    const response = await api.resendVerificationCode(email);
    savePendingEmail(email);
    setStatus(authStatus, response.message || "Код отправлен повторно.", "ok");
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
}

async function onLogout() {
  try {
    if (isAuthenticated()) await api.logout();
  } catch {
    // Local logout is enough when API is unavailable.
  } finally {
    clearAuth();
    updateAuthUi();
    window.location.hash = "#home";
  }
}
