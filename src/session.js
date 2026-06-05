const keys = {
  access: "cremenality_access_token",
  refresh: "cremenality_refresh_token",
  email: "cremenality_user_email",
  user: "cremenality_user",
  pendingEmail: "cremenality_pending_email",
};

export const session = {
  accessToken: localStorage.getItem(keys.access),
  refreshToken: localStorage.getItem(keys.refresh),
  email: localStorage.getItem(keys.email),
  user: readUser(),
  pendingEmail: localStorage.getItem(keys.pendingEmail) || "",
};

export function saveAuth(payload) {
  session.accessToken = payload.access_token;
  session.refreshToken = payload.refresh_token;
  if (payload.user) saveUser(payload.user);
  localStorage.setItem(keys.access, session.accessToken);
  localStorage.setItem(keys.refresh, session.refreshToken);
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
  session.accessToken = null;
  session.refreshToken = null;
  session.email = null;
  session.user = null;
  localStorage.removeItem(keys.access);
  localStorage.removeItem(keys.refresh);
  localStorage.removeItem(keys.email);
  localStorage.removeItem(keys.user);
}

export function isAuthenticated() {
  return Boolean(session.accessToken);
}

export function isAdmin() {
  const user = session.user || {};
  return user.role === "admin" || user.is_admin === true || user.admin === true;
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(keys.user) || "null");
  } catch {
    return null;
  }
}
