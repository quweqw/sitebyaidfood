import { appConfig } from "./config.js";
import { clearAuth, getAccessToken, saveAuth } from "./session.js";

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const AUTH_API = "auth";
const CORE_API = "core";

export const api = {
  checkHealth: () => request("/", { method: "GET", auth: false, timeoutMs: 7000, target: AUTH_API }),
  register: (email, password) => request("/auth/register", { method: "POST", auth: false, body: { email, password, confirm_password: password } }),
  verifyEmail: (email, code) => request("/auth/verify-email", { method: "POST", auth: false, body: { email, code } }),
  resendVerificationCode: (email) => request("/auth/resend-verification-code", { method: "POST", auth: false, body: { email } }),
  login: (email, password) => request("/auth/login", { method: "POST", auth: false, body: { email, password } }),
  requestPasswordReset: (email) => request("/auth/password-reset/request", { method: "POST", auth: false, body: { email } }),
  confirmPasswordReset: (email, code, newPassword) => request("/auth/password-reset/confirm", { method: "POST", auth: false, body: { email, code, new_password: newPassword, confirm_password: newPassword } }),
  me: () => request("/auth/me", { method: "GET", auth: true }),
  logout: () => request("/auth/logout", { method: "POST", auth: true, retryOnUnauthorized: false }),
  chatMessage: (payload) => request("/chat/message", { method: "POST", auth: true, body: payload, timeoutMs: 120000, target: CORE_API }),
  adminUsers: () => request("/admin/users", { method: "GET", auth: true }),
  setUserBlocked: (userId, blocked) => request(`/admin/users/${encodeURIComponent(userId)}/block`, { method: "PATCH", auth: true, body: { blocked } }),
  deleteUser: (userId) => request(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", auth: true }),
};

async function request(path, options = {}) {
  const { method = "GET", body, auth = true, timeoutMs = appConfig.requestTimeoutMs, retryOnUnauthorized = true, target = AUTH_API } = options;
  const response = await fetchWithTimeout(path, { method, body, auth, timeoutMs, target });
  const parsed = await parseResponse(response);

  if (response.status === 401 && auth && retryOnUnauthorized) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retry = await fetchWithTimeout(path, { method, body, auth, timeoutMs, target });
      const retryParsed = await parseResponse(retry);
      if (!retry.ok) throw toApiError(retryParsed, retry.status);
      return retryParsed;
    }
  }

  if (!response.ok) throw toApiError(parsed, response.status);
  return parsed;
}

async function fetchWithTimeout(path, { method, body, auth, timeoutMs, target }) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const baseUrl = apiBaseUrl(target);
  try {
    return await fetch(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      signal: controller.signal,
      headers: buildHeaders(auth),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === "AbortError") throw new ApiError("Сервер не ответил вовремя. Попробуйте позже.", 0);
    throw new ApiError("Не удалось подключиться к API. Проверьте api.cremenality.ru, HTTPS и CORS.", 0);
  } finally {
    window.clearTimeout(timer);
  }
}

function apiBaseUrl(target) {
  return target === CORE_API ? appConfig.coreApiBaseUrl : appConfig.authApiBaseUrl;
}

function buildHeaders(auth) {
  const headers = { "Content-Type": "application/json", "X-AI-Food-Client": "native" };
  const token = auth ? getAccessToken() : "";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  return text ? { message: text } : {};
}

async function refreshAccessToken() {
  try {
    const response = await fetch(`${appConfig.authApiBaseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-AI-Food-Client": "native" },
    });
    const parsed = await parseResponse(response);
    if (!response.ok) throw toApiError(parsed, response.status);
    saveAuth(parsed);
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

function toApiError(body, status) {
  if (body && typeof body === "object") {
    const detail = body.detail;
    if (typeof detail === "string") return new ApiError(localizeError(null, detail), status, body);
    if (detail?.error?.message) return new ApiError(localizeError(detail.error.code, detail.error.message), status, detail.error);
    if (detail?.message) return new ApiError(detail.message, status, detail);
    if (body.message) return new ApiError(body.message, status, body);
  }
  return new ApiError(`Ошибка API (${status})`, status, body);
}

function localizeError(code, fallback) {
  const messages = {
    WEAK_PASSWORD: "Пароль должен быть не короче 8 символов и содержать строчную и заглавную латинскую букву, цифру и спецсимвол.",
    EMAIL_SEND_FAILED: "Не удалось отправить письмо. Проверьте настройки Resend и попробуйте еще раз.",
    EMAIL_PROVIDER_NOT_CONFIGURED: "Почтовый провайдер API не настроен. Проверьте RESEND_API_KEY и EMAIL_FROM.",
    SECRET_KEY_NOT_CONFIGURED: "SECRET_KEY не настроен на сервере авторизации.",
  };
  return messages[code] || fallback || "Ошибка API";
}
