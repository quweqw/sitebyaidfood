import { appConfig } from "./config.js";
import { clearAuth, saveAuth, session } from "./session.js";

export class ApiError extends Error {
  constructor(message, status = 0, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export const api = {
  checkHealth: () => request("/", { method: "GET", auth: false, timeoutMs: 7000 }),
  register: (email, password) => request("/auth/register", { method: "POST", auth: false, body: { email, password, confirm_password: password } }),
  verifyEmail: (email, code) => request("/auth/verify-email", { method: "POST", auth: false, body: { email, code } }),
  resendVerificationCode: (email) => request("/auth/resend-verification-code", { method: "POST", auth: false, body: { email } }),
  login: (email, password) => request("/auth/login", { method: "POST", auth: false, body: { email, password } }),
  me: () => request("/auth/me", { method: "GET", auth: true }),
  logout: () => request("/auth/logout", { method: "POST", auth: true, retryOnUnauthorized: false }),
  chatMessage: (payload) => request("/chat/message", { method: "POST", auth: true, body: payload, timeoutMs: 120000 }),
  adminUsers: () => request("/admin/users", { method: "GET", auth: true }),
  setUserBlocked: (userId, blocked) => request(`/admin/users/${encodeURIComponent(userId)}/block`, { method: "PATCH", auth: true, body: { blocked } }),
  deleteUser: (userId) => request(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", auth: true }),
};

async function request(path, options = {}) {
  const { method = "GET", body, auth = true, timeoutMs = appConfig.requestTimeoutMs, retryOnUnauthorized = true } = options;
  const response = await fetchWithTimeout(path, { method, body, auth, timeoutMs });
  const parsed = await parseResponse(response);

  if (response.status === 401 && auth && retryOnUnauthorized && session.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retry = await fetchWithTimeout(path, { method, body, auth, timeoutMs });
      const retryParsed = await parseResponse(retry);
      if (!retry.ok) throw toApiError(retryParsed, retry.status);
      return retryParsed;
    }
  }

  if (!response.ok) throw toApiError(parsed, response.status);
  return parsed;
}

async function fetchWithTimeout(path, { method, body, auth, timeoutMs }) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${appConfig.apiBaseUrl}${path}`, {
      method,
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

function buildHeaders(auth) {
  const headers = { "Content-Type": "application/json" };
  if (auth && session.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
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
    const response = await fetch(`${appConfig.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
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
    if (typeof detail === "string") return new ApiError(detail, status, body);
    if (detail?.error?.message) return new ApiError(detail.error.message, status, detail.error);
    if (detail?.message) return new ApiError(detail.message, status, detail);
    if (body.message) return new ApiError(body.message, status, body);
  }
  return new ApiError(`Ошибка API (${status})`, status, body);
}
