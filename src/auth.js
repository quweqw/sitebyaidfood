import { api } from "./api.js";
import { appConfig } from "./config.js";
import { clearAuth, clearPendingEmail, isAdmin, isAuthenticated, saveAuth, savePendingEmail, saveUser, session, withAccessToken } from "./session.js";
import { formValues, setStatus } from "./ui.js";

const authStatus = document.querySelector("#authStatus");
const sessionLabel = document.querySelector("#sessionLabel");
const chatGate = document.querySelector("#chatGate");
const chatShell = document.querySelector("#chatShell");
const adminNav = document.querySelector("[data-admin-only]");
const logoutButton = document.querySelector("#logoutButton");
const accountSession = document.querySelector("#accountSession");
const authForms = document.querySelector("#authForms");
const accountSessionEmail = document.querySelector("#accountSessionEmail");
const accountSessionRole = document.querySelector("#accountSessionRole");
const accountAdminLink = document.querySelector("#accountAdminLink");
const accountLogoutButton = document.querySelector("#accountLogoutButton");

export function initAuth() {
  bindTabs();
  bindForms();
  updateAuthUi();
  hydrateSession();
}

export function updateAuthUi() {
  const authenticated = isAuthenticated();
  const admin = isAdmin();
  sessionLabel.textContent = session.email || "Гость";
  chatGate.hidden = authenticated;
  chatShell.hidden = !authenticated;
  logoutButton.hidden = !authenticated;
  adminNav.hidden = !admin;
  accountSession.hidden = !authenticated;
  authForms.hidden = authenticated;
  accountAdminLink.hidden = !admin;
  document.querySelectorAll("[data-chat-link]").forEach((link) => {
    link.href = authenticated ? withAccessToken(appConfig.chatAppUrl) : appConfig.chatAppUrl;
  });

  if (authenticated) {
    accountSessionEmail.textContent = session.email || "Аккаунт активен";
    accountSessionRole.textContent = admin ? "Роль: admin" : "Роль: user";
  }

  window.dispatchEvent(new CustomEvent("auth:changed"));
}

async function hydrateSession() {
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
    const active = button.dataset.authTab === name || (name === "reset-confirm" && button.dataset.authTab === "reset");
    button.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-auth-pane]").forEach((pane) => {
    pane.classList.toggle("active", pane.dataset.authPane === name);
  });
  if (name === "verify" && session.pendingEmail) {
    document.querySelector("#verifyForm [name='email']").value = session.pendingEmail;
  }
  if (name === "reset" && session.email) {
    document.querySelector("#passwordResetRequestForm [name='email']").value = session.email;
  }
}

function bindForms() {
  document.querySelector("#registerForm").addEventListener("submit", onRegister);
  document.querySelector("#verifyForm").addEventListener("submit", onVerify);
  document.querySelector("#loginForm").addEventListener("submit", onLogin);
  document.querySelector("#passwordResetRequestForm").addEventListener("submit", onPasswordResetRequest);
  document.querySelector("#passwordResetConfirmForm").addEventListener("submit", onPasswordResetConfirm);
  document.querySelector("#resendCodeButton").addEventListener("click", onResendCode);
  document.querySelector("#forgotPasswordButton").addEventListener("click", () => setAuthTab("reset"));
  document.querySelector("#backToResetRequestButton").addEventListener("click", () => setAuthTab("reset"));
  logoutButton.addEventListener("click", onLogout);
  accountLogoutButton.addEventListener("click", onLogout);
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
    if (error.details?.code === "EMAIL_NOT_VERIFIED") {
      const email = error.details?.details?.email || data.email;
      savePendingEmail(email);
      document.querySelector("#verifyForm [name='email']").value = email;
      setStatus(authStatus, "Аккаунт уже создан. Введите код подтверждения из письма.", "ok");
      setAuthTab("verify");
      return;
    }
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
    window.location.hash = "#account";
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
    window.location.hash = "#account";
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

async function onPasswordResetRequest(event) {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  setStatus(authStatus, "Отправляю код восстановления...");
  try {
    const response = await api.requestPasswordReset(data.email);
    savePendingEmail(data.email);
    document.querySelector("#passwordResetConfirmForm [name='email']").value = data.email;
    setStatus(authStatus, response.message || "Код восстановления отправлен на email.", "ok");
    setAuthTab("reset-confirm");
  } catch (error) {
    setStatus(authStatus, error.message, "error");
  }
}

async function onPasswordResetConfirm(event) {
  event.preventDefault();
  const data = formValues(event.currentTarget);
  setStatus(authStatus, "Меняю пароль...");
  try {
    const response = await api.confirmPasswordReset(data.email, data.code, data.password);
    clearPendingEmail();
    setStatus(authStatus, response.message || "Пароль изменен. Теперь можно войти.", "ok");
    setAuthTab("login");
    document.querySelector("#loginForm [name='email']").value = data.email;
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
