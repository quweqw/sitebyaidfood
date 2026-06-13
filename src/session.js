const keys = {
  access: "cremenality_access_token",
  refresh: "cremenality_refresh_token",
  email: "cremenality_user_email",
  user: "cremenality_user",
  pendingEmail: "cremenality_pending_email",
};

dropLegacyRefreshTokenStorage();

export const session = {
  email: localStorage.getItem(keys.email),
  user: readUser(),
  pendingEmail: localStorage.getItem(keys.pendingEmail) || "",
};

export function saveAuth(payload) {
  dropLegacyRefreshTokenStorage();
  if (payload.access_token) localStorage.setItem(keys.access, payload.access_token);
  if (payload.user) saveUser(payload.user);
}

export function saveUser(user) {
  session.user = user || null;
  session.email = user?.email || session.email || "";
  if (session.email) localStorage.setItem(keys.email, session.email);
  if (user) localStorage.setItem(keys.user, JSON.stringify(user));
}

export function savePendingEmail(email) {
  session.pendingEmail = String(email || "").trim();
  if (session.pendingEmail) localStorage.setItem(keys.pendingEmail, session.pendingEmail);
}

export function clearPendingEmail() {
  session.pendingEmail = "";
  localStorage.removeItem(keys.pendingEmail);
}

export function clearAuth() {
  session.email = null;
  session.user = null;
  localStorage.removeItem(keys.access);
  dropLegacyRefreshTokenStorage();
  localStorage.removeItem(keys.email);
  localStorage.removeItem(keys.user);
}

export function getAccessToken() {
  return localStorage.getItem(keys.access) || "";
}

export function withAccessToken(url) {
  const token = getAccessToken();
  if (!token) return url;
  const target = new URL(url, window.location.href);
  const hash = new URLSearchParams(target.hash.replace(/^#/, ""));
  hash.set("token", token);
  target.hash = hash.toString();
  return target.toString();
}

export function isAuthenticated() {
  return Boolean(session.user || session.email);
}

export function isAdmin() {
  const user = session.user || {};
  return user.role === "admin" || user.is_admin === true || user.admin === true;
}

export function isStaff() {
  const role = String(session.user?.role || "");
  return isAdmin() || ["crm_manager", "support_manager", "developer"].includes(role);
}

export function canManageUsers() {
  return permission("manage_users", isAdmin());
}

export function canManagePartnerships() {
  return permission("manage_partnerships", isAdmin() || session.user?.role === "crm_manager");
}

export function canManageSupport() {
  return permission("manage_support", isAdmin() || session.user?.role === "support_manager");
}

export function canManageIntegration() {
  return permission("manage_integration", isAdmin() || session.user?.role === "developer");
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(keys.user) || "null");
  } catch {
    return null;
  }
}

function permission(name, fallback) {
  const value = session.user?.permissions?.[name];
  return typeof value === "boolean" ? value : Boolean(fallback);
}

function dropLegacyRefreshTokenStorage() {
  localStorage.removeItem(keys.refresh);
}
