const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const WEAK_PASSWORDS = new Set(["12345678", "password", "qwerty123", "password123", "admin1234"]);

export default {
  async fetch(request, env) {
    try {
      const cors = corsHeaders(request, env);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      const response = await route(request, env);
      return withHeaders(response, {
        ...cors,
        ...securityHeaders(),
      });
    } catch (error) {
      if (error instanceof ApiException) {
        return withHeaders(jsonError(error.status, error.code, error.message, error.details), {
          ...corsHeaders(request, env),
          ...securityHeaders(),
        });
      }
      console.error("Unhandled auth worker error", error);
      const details = boolEnv(env, "DEBUG_ERRORS", false)
        ? {
            name: String(error?.name || "Error").slice(0, 80),
            message: String(error?.message || error || "unknown").slice(0, 500),
          }
        : {};
      return withHeaders(jsonError(500, "INTERNAL_ERROR", "Internal server error", details), {
        ...corsHeaders(request, env),
        ...securityHeaders(),
      });
    }
  },
};

async function route(request, env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === "GET" && path === "/") {
    return json({ status: "AI Food Auth API running" });
  }

  await enforceRateLimit(env, request, "general", intEnv(env, "RATE_LIMIT_GENERAL_PER_MINUTE", 300));

  if (request.method === "POST" && path === "/auth/register") {
    await enforceRateLimit(env, request, "auth:register", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return register(request, env);
  }
  if (request.method === "POST" && path === "/auth/verify-email") {
    await enforceRateLimit(env, request, "auth:verify", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return verifyEmail(request, env);
  }
  if (request.method === "POST" && path === "/auth/verify") {
    await enforceRateLimit(env, request, "auth:verify", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return verifyEmail(request, env);
  }
  if (request.method === "POST" && path === "/auth/resend-verification-code") {
    await enforceRateLimit(env, request, "auth:resend", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return resendVerificationCode(request, env);
  }
  if (request.method === "POST" && path === "/auth/login") {
    await enforceRateLimit(env, request, "auth:login", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return login(request, env);
  }
  if (request.method === "POST" && path === "/auth/refresh") {
    await enforceRateLimit(env, request, "auth:refresh", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return refresh(request, env);
  }
  if (request.method === "POST" && path === "/auth/logout") {
    return logout(request, env);
  }
  if (request.method === "GET" && path === "/auth/me") {
    const user = await currentActiveUser(request, env);
    return json(publicUser(user, env));
  }
  if (request.method === "GET" && path === "/connection-info") {
    return connectionInfo(request, env);
  }
  if (request.method === "POST" && path === "/auth/password-reset/request") {
    await enforceRateLimit(env, request, "auth:password-reset-request", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return requestPasswordReset(request, env);
  }
  if (request.method === "POST" && path === "/auth/password-reset/confirm") {
    await enforceRateLimit(env, request, "auth:password-reset-confirm", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return confirmPasswordReset(request, env);
  }
  if ((request.method === "POST" || request.method === "PUT") && (path === "/auth/change-password" || path === "/auth/password")) {
    await enforceRateLimit(env, request, "auth:change-password", intEnv(env, "RATE_LIMIT_AUTH_PER_MINUTE", 20));
    return changePassword(request, env);
  }
  if (request.method === "GET" && path === "/admin/users") {
    return adminUsers(request, env);
  }
  if (request.method === "PATCH" && /^\/admin\/users\/[^/]+\/block$/.test(path)) {
    return adminSetBlocked(request, env, decodeURIComponent(path.split("/")[3]));
  }
  if (request.method === "DELETE" && /^\/admin\/users\/[^/]+$/.test(path)) {
    return adminDeleteUser(request, env, decodeURIComponent(path.split("/")[3]));
  }

  throw new ApiException(404, "NOT_FOUND", "Endpoint not found");
}

async function register(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const password = String(data.password || "");
  if (!email) throw new ApiException(400, "INVALID_EMAIL", "Email is required");
  if (data.confirm_password != null && password !== String(data.confirm_password)) {
    throw new ApiException(400, "PASSWORD_MISMATCH", "Passwords do not match");
  }
  ensureStrongPassword(password);

  const existing = await getUserByEmail(env, email);
  if (existing && await deleteUnverifiedAccountIfExpired(env, existing)) {
    return registerWithFreshEmail(request, env, email, password);
  }
  if (existing) {
    if (!truthy(existing.is_email_verified)) {
      throw new ApiException(409, "EMAIL_NOT_VERIFIED", "Email is already registered but not verified", { email });
    }
    throw new ApiException(409, "EMAIL_ALREADY_EXISTS", "Email is already registered");
  }
  return registerWithFreshEmail(request, env, email, password);
}

async function registerWithFreshEmail(request, env, email, password) {
  const now = new Date();
  const code = generateNumericCode(6);
  const passwordRecord = await hashPassword(password, undefined, passwordHashIterations(env));
  const user = {
    id: crypto.randomUUID(),
    email,
    password_hash: passwordRecord.hash,
    password_salt: passwordRecord.salt,
    password_iterations: passwordRecord.iterations,
    role: isAdminEmail(env, email) ? "admin" : "user",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    verification_code_hash: await sha256Hex(code),
    verification_code_expires_at: addMinutes(now, intEnv(env, "VERIFICATION_CODE_EXPIRE_MINUTES", 10)).toISOString(),
    verification_code_sent_at: now.toISOString(),
  };

  await env.DB.prepare(`
    INSERT INTO users (
      id, email, password_hash, password_salt, password_iterations, role, created_at, updated_at,
      verification_code_hash, verification_code_expires_at, verification_code_sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    user.id,
    user.email,
    user.password_hash,
    user.password_salt,
    user.password_iterations,
    user.role,
    user.created_at,
    user.updated_at,
    user.verification_code_hash,
    user.verification_code_expires_at,
    user.verification_code_sent_at,
  ).run();

  const sent = await sendVerificationCode(env, email, code);
  if (!sent && !boolEnv(env, "EMAIL_DEV_MODE", false)) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    throw new ApiException(500, "EMAIL_SEND_FAILED", "Could not send verification code");
  }

  const body = {
    user_id: user.id,
    email,
    is_email_verified: false,
    message: "Verification code sent to email",
  };
  if (boolEnv(env, "EMAIL_DEV_MODE", false)) body.dev_code = code;
  return json(body, 201);
}

async function verifyEmail(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const code = String(data.code || "").trim();
  const user = await requireUserByEmail(env, email);

  if (truthy(user.is_blocked)) throw new ApiException(403, "ACCOUNT_BLOCKED", "Account is blocked");
  await verifyEmailCode(env, user, code);
  const fresh = await requireUserByEmail(env, email);
  return authResponse(request, env, fresh, "Authenticated");
}

async function resendVerificationCode(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const user = await requireUserByEmail(env, email);

  if (truthy(user.is_blocked)) throw new ApiException(403, "ACCOUNT_BLOCKED", "Account is blocked");
  if (truthy(user.is_email_verified)) return json({ message: "Email is already verified" });
  await ensureUnverifiedAccountActive(env, user);

  const now = new Date();
  if (user.verification_code_sent_at) {
    const elapsed = (now.getTime() - Date.parse(user.verification_code_sent_at)) / 1000;
    const cooldown = intEnv(env, "VERIFICATION_RESEND_COOLDOWN_SECONDS", 60);
    if (elapsed < cooldown) {
      throw new ApiException(429, "VERIFICATION_RESEND_COOLDOWN", "Wait before requesting another code", {
        retry_after_seconds: Math.ceil(cooldown - elapsed),
      });
    }
  }

  const code = generateNumericCode(6);
  await env.DB.prepare(`
    UPDATE users
    SET verification_code_hash = ?, verification_code_expires_at = ?, verification_code_sent_at = ?,
        verification_attempts = 0, updated_at = ?
    WHERE id = ?
  `).bind(
    await sha256Hex(code),
    addMinutes(now, intEnv(env, "VERIFICATION_CODE_EXPIRE_MINUTES", 10)).toISOString(),
    now.toISOString(),
    now.toISOString(),
    user.id,
  ).run();

  const sent = await sendVerificationCode(env, email, code);
  if (!sent && !boolEnv(env, "EMAIL_DEV_MODE", false)) {
    throw new ApiException(500, "EMAIL_SEND_FAILED", "Could not send verification code");
  }
  const body = { message: "Verification code sent again" };
  if (boolEnv(env, "EMAIL_DEV_MODE", false)) body.dev_code = code;
  return json(body);
}

async function login(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const password = String(data.password || "");
  const user = await getUserByEmail(env, email);
  const now = new Date();

  if (user?.login_locked_until && Date.parse(user.login_locked_until) > now.getTime()) {
    throw new ApiException(429, "LOGIN_LOCKED", "Too many login attempts. Try again later.", {
      retry_after_seconds: Math.max(1, Math.ceil((Date.parse(user.login_locked_until) - now.getTime()) / 1000)),
    });
  }

  const valid = user && await verifyPassword(password, user);
  if (!valid) {
    if (user) await recordFailedLogin(env, user, now);
    throw new ApiException(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  ensureUserAllowed(user);
  return authResponse(request, env, user, "Authenticated");
}

async function refresh(request, env) {
  const data = await maybeReadJson(request);
  const refreshToken = data?.refresh_token || getCookie(request, stringEnv(env, "REFRESH_COOKIE_NAME", "__Host-aifood_refresh"));
  if (!refreshToken) throw new ApiException(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");

  const tokenHash = await sha256Hex(refreshToken);
  const session = await env.DB.prepare(`
    SELECT sessions.*, users.email, users.role, users.is_email_verified, users.is_blocked
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.refresh_token_hash = ? AND sessions.revoked_at IS NULL
  `).bind(tokenHash).first();

  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    throw new ApiException(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
  }

  const user = await getUserById(env, session.user_id);
  if (!user) throw new ApiException(401, "INVALID_REFRESH_TOKEN", "Invalid refresh token");
  ensureUserAllowed(user);
  return authResponse(request, env, user, "Authenticated", session.id);
}

async function logout(request, env) {
  const refreshToken = getCookie(request, stringEnv(env, "REFRESH_COOKIE_NAME", "__Host-aifood_refresh"));
  if (refreshToken) {
    await env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE refresh_token_hash = ?")
      .bind(new Date().toISOString(), new Date().toISOString(), await sha256Hex(refreshToken))
      .run();
  } else {
    const access = accessTokenFromRequest(request, env);
    const payload = access ? await verifyJwt(env, access, "access").catch(() => null) : null;
    if (payload?.sid) {
      await env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), new Date().toISOString(), payload.sid)
        .run();
    }
  }
  return withAuthCookies(request, env, json({ message: "Logged out" }), null, null);
}

async function requestPasswordReset(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const user = await getUserByEmail(env, email);
  const generic = { message: "If the email is registered, a password reset code has been sent" };
  if (!user || truthy(user.is_blocked)) return json(generic);

  if (!truthy(user.is_email_verified)) {
    await ensureUnverifiedAccountActive(env, user);
  }

  const now = new Date();
  if (user.password_reset_code_sent_at) {
    const elapsed = (now.getTime() - Date.parse(user.password_reset_code_sent_at)) / 1000;
    const cooldown = intEnv(env, "PASSWORD_RESET_RESEND_COOLDOWN_SECONDS", 60);
    if (elapsed < cooldown) {
      throw new ApiException(429, "PASSWORD_RESET_RESEND_COOLDOWN", "Wait before requesting another code", {
        retry_after_seconds: Math.ceil(cooldown - elapsed),
      });
    }
  }

  const code = generateNumericCode(8);
  await env.DB.prepare(`
    UPDATE users
    SET password_reset_code_hash = ?, password_reset_code_expires_at = ?, password_reset_code_sent_at = ?,
        password_reset_attempts = 0, updated_at = ?
    WHERE id = ?
  `).bind(
    await sha256Hex(code),
    addMinutes(now, intEnv(env, "PASSWORD_RESET_CODE_EXPIRE_MINUTES", 10)).toISOString(),
    now.toISOString(),
    now.toISOString(),
    user.id,
  ).run();

  const sent = await sendPasswordResetCode(env, email, code);
  if (!sent && !boolEnv(env, "EMAIL_DEV_MODE", false)) {
    throw new ApiException(500, "EMAIL_SEND_FAILED", "Could not send password reset code");
  }
  const body = { message: "Password reset code sent to email" };
  if (boolEnv(env, "EMAIL_DEV_MODE", false)) body.dev_code = code;
  return json(body);
}

async function confirmPasswordReset(request, env) {
  const data = await readJson(request);
  const email = normalizeEmail(data.email);
  const code = String(data.code || "").trim();
  const newPassword = String(data.new_password || "");
  const confirmPassword = String(data.confirm_password || "");
  if (newPassword !== confirmPassword) throw new ApiException(400, "PASSWORD_MISMATCH", "Passwords do not match");
  ensureStrongPassword(newPassword);

  const user = await requireUserByEmail(env, email);
  if (truthy(user.is_blocked)) throw new ApiException(403, "ACCOUNT_BLOCKED", "Account is blocked");
  const now = new Date();
  if (!user.password_reset_code_expires_at || Date.parse(user.password_reset_code_expires_at) < now.getTime()) {
    throw new ApiException(400, "PASSWORD_RESET_CODE_EXPIRED", "Password reset code expired");
  }
  if (Number(user.password_reset_attempts || 0) >= 5) {
    throw new ApiException(429, "TOO_MANY_PASSWORD_RESET_ATTEMPTS", "Too many password reset attempts");
  }
  if (!timingSafeEqual(await sha256Hex(code), String(user.password_reset_code_hash || ""))) {
    await env.DB.prepare("UPDATE users SET password_reset_attempts = password_reset_attempts + 1, updated_at = ? WHERE id = ?")
      .bind(now.toISOString(), user.id)
      .run();
    throw new ApiException(400, "INVALID_PASSWORD_RESET_CODE", "Invalid password reset code");
  }

  const passwordRecord = await hashPassword(newPassword, undefined, passwordHashIterations(env));
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET password_hash = ?, password_salt = ?, password_iterations = ?, is_email_verified = 1,
          password_reset_code_hash = NULL, password_reset_code_expires_at = NULL,
          password_reset_code_sent_at = NULL, password_reset_attempts = 0, updated_at = ?
      WHERE id = ?
    `).bind(passwordRecord.hash, passwordRecord.salt, passwordRecord.iterations, now.toISOString(), user.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now.toISOString(), now.toISOString(), user.id),
  ]);
  return json({ message: "Password updated. You can now log in." });
}

async function changePassword(request, env) {
  const user = await currentActiveUser(request, env);
  const data = await readJson(request);
  const currentPassword = String(data.current_password || "");
  const newPassword = String(data.new_password || "");
  const confirmPassword = String(data.confirm_password || "");
  if (!await verifyPassword(currentPassword, user)) {
    throw new ApiException(401, "INVALID_CREDENTIALS", "Current password is invalid");
  }
  if (newPassword !== confirmPassword) throw new ApiException(400, "PASSWORD_MISMATCH", "Passwords do not match");
  ensureStrongPassword(newPassword);

  const passwordRecord = await hashPassword(newPassword, undefined, passwordHashIterations(env));
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
      .bind(passwordRecord.hash, passwordRecord.salt, passwordRecord.iterations, now, user.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, now, user.id),
  ]);
  return withAuthCookies(request, env, json({ message: "Password updated" }), null, null);
}

async function connectionInfo(request, env) {
  const user = await currentActiveUser(request, env);
  if (boolEnv(env, "CONNECTION_INFO_REQUIRE_ADMIN", false) && userRole(user, env) !== "admin") {
    throw new ApiException(403, "ADMIN_REQUIRED", "Connection details are available only to admins");
  }

  const providers = [];
  if (boolEnv(env, "CONNECTION_RADMIN_ENABLED", true)) {
    const ip = stringEnv(env, "CONNECTION_RADMIN_IP", "26.192.1.120");
    providers.push({
      id: "radmin",
      title: "RadminVPN",
      badge: "VPN",
      recommended: true,
      core_api_url: stringEnv(env, "CONNECTION_RADMIN_CORE_API_URL", ip.startsWith("[") ? "" : `http://${ip}:8000`),
      fields: [
        { label: "IP ПК", value: ip },
        { label: "Логин", value: stringEnv(env, "CONNECTION_RADMIN_LOGIN", "aifoodwebapp") },
        { label: "Пароль", value: stringEnv(env, "CONNECTION_RADMIN_PASSWORD", "[Задай secret CONNECTION_RADMIN_PASSWORD]"), secret: true },
      ],
      steps: [
        "Открой RadminVPN и подключись к сети AI Food.",
        "Убедись, что на ПК запущен backend на 0.0.0.0:8000.",
        "Убедись, что Windows Firewall пропускает входящие TCP 8000 для RadminVPN.",
        "После подключения нажми «Я подключился, открыть чат».",
      ],
      note: "Важно: HTTPS-сайт может заблокировать HTTP-запрос к 26.192.1.120:8000. Если браузер не даст отправлять сообщения, понадобится HTTPS-домен для Radmin backend.",
    });
  }

  return json({
    user: publicUser(user, env),
    providers,
    default_provider: stringEnv(env, "CONNECTION_DEFAULT_PROVIDER", "radmin"),
  });
}

async function adminUsers(request, env) {
  const admin = await currentAdminUser(request, env);
  const users = await env.DB.prepare(`
    SELECT id, email, is_email_verified, role, is_blocked, blocked_at, created_at, updated_at, last_login_at
    FROM users
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  return json({ users: (users.results || []).map((user) => publicUser(user, env)), admin: publicUser(admin, env) });
}

async function adminSetBlocked(request, env, userId) {
  const admin = await currentAdminUser(request, env);
  const data = await readJson(request);
  const target = await getUserByIdOrEmail(env, userId);
  if (!target) throw new ApiException(404, "USER_NOT_FOUND", "User not found");
  if (target.id === admin.id) throw new ApiException(400, "CANNOT_BLOCK_SELF", "Admin cannot block own account");

  const blocked = data.blocked === true || data.is_blocked === true;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET is_blocked = ?, blocked_at = ?, updated_at = ? WHERE id = ?")
      .bind(blocked ? 1 : 0, blocked ? now : null, now, target.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, now, target.id),
  ]);
  const fresh = await getUserById(env, target.id);
  return json(publicUser(fresh, env));
}

async function adminDeleteUser(request, env, userId) {
  const admin = await currentAdminUser(request, env);
  const target = await getUserByIdOrEmail(env, userId);
  if (!target) throw new ApiException(404, "USER_NOT_FOUND", "User not found");
  if (target.id === admin.id) throw new ApiException(400, "CANNOT_DELETE_SELF", "Admin cannot delete own account");

  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(target.id),
  ]);
  return json({ message: "User deleted" });
}

async function authResponse(request, env, user, message, existingSessionId = null) {
  const tokens = await issueTokens(request, env, user, existingSessionId);
  const body = { user: publicUser(user, env), message };
  if (wantsNativeTokens(request)) {
    body.token_type = "bearer";
    body.access_token = tokens.accessToken;
    body.refresh_token = tokens.refreshToken;
  }
  return withAuthCookies(request, env, json(body), tokens.accessToken, tokens.refreshToken);
}

async function issueTokens(request, env, user, existingSessionId = null) {
  const now = new Date();
  const sessionId = existingSessionId || crypto.randomUUID();
  const refreshToken = randomBase64Url(32);
  const refreshExpiresAt = addDays(now, intEnv(env, "REFRESH_TOKEN_EXPIRE_DAYS", 30));
  const accessExpiresAt = Math.floor(addMinutes(now, intEnv(env, "ACCESS_TOKEN_EXPIRE_MINUTES", 60)).getTime() / 1000);
  const role = userRole(user, env);

  const accessToken = await signJwt(env, {
    sub: user.id,
    email: user.email,
    type: "access",
    sid: sessionId,
    role,
    is_admin: role === "admin",
    exp: accessExpiresAt,
  });

  const refreshHash = await sha256Hex(refreshToken);
  const ipHash = await sha256Hex(clientIp(request));
  const userAgent = String(request.headers.get("user-agent") || "").slice(0, 500);

  if (existingSessionId) {
    await env.DB.prepare(`
      UPDATE sessions
      SET refresh_token_hash = ?, expires_at = ?, updated_at = ?, user_agent = ?, ip_hash = ?, revoked_at = NULL
      WHERE id = ?
    `).bind(refreshHash, refreshExpiresAt.toISOString(), now.toISOString(), userAgent, ipHash, sessionId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, created_at, updated_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(sessionId, user.id, refreshHash, refreshExpiresAt.toISOString(), now.toISOString(), now.toISOString(), userAgent, ipHash).run();
  }

  await env.DB.prepare(`
    UPDATE users
    SET last_login_at = ?, login_failed_attempts = 0, login_locked_until = NULL, updated_at = ?
    WHERE id = ?
  `).bind(now.toISOString(), now.toISOString(), user.id).run();

  return { accessToken, refreshToken };
}

async function currentAdminUser(request, env) {
  const user = await currentActiveUser(request, env);
  if (userRole(user, env) !== "admin") throw new ApiException(403, "ADMIN_REQUIRED", "Admin access required");
  return user;
}

async function currentActiveUser(request, env) {
  const accessToken = accessTokenFromRequest(request, env);
  if (!accessToken) throw new ApiException(401, "NOT_AUTHENTICATED", "Authentication required");
  const payload = await verifyJwt(env, accessToken, "access");
  const user = await getUserById(env, payload.sub);
  if (!user) throw new ApiException(401, "INVALID_TOKEN", "Invalid token");

  if (payload.sid) {
    const session = await env.DB.prepare("SELECT id, revoked_at, expires_at FROM sessions WHERE id = ?").bind(payload.sid).first();
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
      throw new ApiException(401, "INVALID_SESSION", "Invalid session");
    }
  }

  ensureUserAllowed(user);
  return user;
}

async function verifyEmailCode(env, user, code) {
  await ensureUnverifiedAccountActive(env, user);
  const now = new Date();
  if (!user.verification_code_expires_at || Date.parse(user.verification_code_expires_at) < now.getTime()) {
    throw new ApiException(400, "VERIFICATION_CODE_EXPIRED", "Verification code expired");
  }
  if (Number(user.verification_attempts || 0) >= 5) {
    throw new ApiException(429, "TOO_MANY_VERIFICATION_ATTEMPTS", "Too many verification attempts");
  }
  if (!timingSafeEqual(await sha256Hex(code), String(user.verification_code_hash || ""))) {
    await env.DB.prepare("UPDATE users SET verification_attempts = verification_attempts + 1, updated_at = ? WHERE id = ?")
      .bind(now.toISOString(), user.id)
      .run();
    throw new ApiException(400, "INVALID_VERIFICATION_CODE", "Invalid verification code");
  }

  await env.DB.prepare(`
    UPDATE users
    SET is_email_verified = 1, verification_code_hash = NULL, verification_code_expires_at = NULL,
        verification_attempts = 0, updated_at = ?
    WHERE id = ?
  `).bind(now.toISOString(), user.id).run();
}

async function recordFailedLogin(env, user, now) {
  const attempts = Number(user.login_failed_attempts || 0) + 1;
  const maxAttempts = intEnv(env, "LOGIN_MAX_FAILED_ATTEMPTS", 5);
  const lockedUntil = attempts >= maxAttempts ? addMinutes(now, intEnv(env, "LOGIN_LOCKOUT_MINUTES", 15)).toISOString() : null;
  await env.DB.prepare("UPDATE users SET login_failed_attempts = ?, login_locked_until = ?, updated_at = ? WHERE id = ?")
    .bind(attempts, lockedUntil, now.toISOString(), user.id)
    .run();
}

async function deleteUnverifiedAccountIfExpired(env, user) {
  if (truthy(user.is_email_verified) || !user.created_at) return false;
  const ttlMs = intEnv(env, "UNVERIFIED_ACCOUNT_TTL_HOURS", 24) * 60 * 60 * 1000;
  if (Date.now() - Date.parse(user.created_at) <= ttlMs) return false;
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
  return true;
}

async function ensureUnverifiedAccountActive(env, user) {
  if (await deleteUnverifiedAccountIfExpired(env, user)) {
    throw new ApiException(410, "EMAIL_VERIFICATION_EXPIRED", "Verification expired. Register again.");
  }
}

function ensureUserAllowed(user) {
  if (truthy(user.is_blocked)) throw new ApiException(403, "ACCOUNT_BLOCKED", "Account is blocked");
  if (!truthy(user.is_email_verified)) {
    throw new ApiException(403, "EMAIL_NOT_VERIFIED", "Verify email first", { email: user.email });
  }
}

function ensureStrongPassword(password) {
  const value = String(password || "");
  const checks = {
    min_length: value.length >= 8,
    has_letter: /[A-Za-z]/.test(value),
    has_digit: /\d/.test(value),
    has_uppercase: /[A-Z]/.test(value),
    has_lowercase: /[a-z]/.test(value),
    has_special: /[^A-Za-z0-9]/.test(value),
    not_common: !WEAK_PASSWORDS.has(value.toLowerCase()),
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new ApiException(400, "WEAK_PASSWORD", "Password is not strong enough", checks);
  }
}

async function getUserByEmail(env, email) {
  if (!email) return null;
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(normalizeEmail(email)).first();
}

async function requireUserByEmail(env, email) {
  const user = await getUserByEmail(env, email);
  if (!user) throw new ApiException(404, "USER_NOT_FOUND", "User not found");
  return user;
}

async function getUserById(env, id) {
  if (!id) return null;
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
}

async function getUserByIdOrEmail(env, value) {
  if (!value) return null;
  return env.DB.prepare("SELECT * FROM users WHERE id = ? OR email = ?").bind(value, normalizeEmail(value)).first();
}

function publicUser(user, env) {
  return {
    id: String(user.id),
    email: user.email,
    is_email_verified: truthy(user.is_email_verified),
    role: userRole(user, env),
    is_admin: userRole(user, env) === "admin",
    is_blocked: truthy(user.is_blocked),
    blocked_at: user.blocked_at || null,
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    last_login_at: user.last_login_at || null,
    profile: parseProfile(user.profile_json),
  };
}

function parseProfile(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function userRole(user, env) {
  if (isAdminEmail(env, user.email)) return "admin";
  return String(user.role || "user").toLowerCase() === "admin" ? "admin" : "user";
}

function isAdminEmail(env, email) {
  return csvEnv(env, "ADMIN_EMAILS").map(normalizeEmail).includes(normalizeEmail(email));
}

async function hashPassword(password, salt = randomBase64Url(16), iterations = 210000) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBytes = base64UrlToBytes(salt);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return { hash: bytesToBase64Url(new Uint8Array(bits)), salt, iterations };
}

function passwordHashIterations(env) {
  return Math.max(60000, Math.min(210000, intEnv(env, "PASSWORD_HASH_ITERATIONS", 60000)));
}

async function verifyPassword(password, user) {
  const record = await hashPassword(password, user.password_salt, Number(user.password_iterations || 210000));
  return timingSafeEqual(record.hash, String(user.password_hash || ""));
}

async function signJwt(env, payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(env, signingInput);
  return `${signingInput}.${signature}`;
}

async function verifyJwt(env, token, expectedType) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new ApiException(401, "INVALID_TOKEN", "Invalid token");
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = await hmacSha256(env, signingInput);
  if (!timingSafeEqual(parts[2], expectedSignature)) {
    throw new ApiException(401, "INVALID_TOKEN", "Invalid token");
  }
  const payload = JSON.parse(textDecoder.decode(base64UrlToBytes(parts[1])));
  if (payload.type !== expectedType) throw new ApiException(401, "INVALID_TOKEN", "Invalid token");
  if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) {
    throw new ApiException(401, "TOKEN_EXPIRED", "Token expired");
  }
  return payload;
}

async function hmacSha256(env, signingInput) {
  const secret = stringEnv(env, "SECRET_KEY", "") || stringEnv(env, "JWT_SECRET", "");
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(signingInput));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function sendVerificationCode(env, to, code) {
  return sendEmail(env, to, "AI Food email verification", `Your AI Food verification code: ${code}`, `<p>Your AI Food verification code:</p><p><strong>${code}</strong></p>`);
}

async function sendPasswordResetCode(env, to, code) {
  return sendEmail(env, to, "AI Food password reset", `Your AI Food password reset code: ${code}`, `<p>Your AI Food password reset code:</p><p><strong>${code}</strong></p>`);
}

async function sendEmail(env, to, subject, text, html) {
  if (boolEnv(env, "EMAIL_DEV_MODE", false)) {
    console.log(`EMAIL_DEV_MODE to=${to} subject=${subject} text=${text}`);
    return true;
  }
  const provider = stringEnv(env, "EMAIL_PROVIDER", "resend").toLowerCase();
  if (provider === "resend") return sendResendEmail(env, to, subject, text, html);
  throw new ApiException(500, "EMAIL_PROVIDER_NOT_CONFIGURED", "Email provider is not configured");
}

async function sendResendEmail(env, to, subject, text, html) {
  const apiKey = stringEnv(env, "RESEND_API_KEY", "");
  const from = stringEnv(env, "EMAIL_FROM", "");
  if (!apiKey || !from) {
    throw new ApiException(500, "EMAIL_PROVIDER_NOT_CONFIGURED", "RESEND_API_KEY and EMAIL_FROM must be set");
  }
  let response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });
  } catch (error) {
    console.error("Resend email request failed", error?.message || error);
    throw new ApiException(500, "EMAIL_SEND_FAILED", "Could not reach email provider", {
      provider: "resend",
      reason: String(error?.message || error || "fetch_failed").slice(0, 240),
    });
  }
  if (!response.ok) {
    const body = await response.text();
    console.error("Resend email failed", response.status, body.slice(0, 500));
    throw new ApiException(500, "EMAIL_SEND_FAILED", "Email provider rejected the message", {
      provider: "resend",
      status: response.status,
      response: body.slice(0, 500),
    });
  }
  return true;
}

async function enforceRateLimit(env, request, scope, limit) {
  if (boolEnv(env, "RATE_LIMIT_DISABLED", false) || !env.DB || limit <= 0) return;
  const windowSeconds = intEnv(env, "RATE_LIMIT_WINDOW_SECONDS", 60);
  const now = Date.now();
  const key = await sha256Hex(`${scope}:${clientIp(request)}`);
  const row = await env.DB.prepare("SELECT count, window_expires_at FROM rate_limits WHERE key = ?").bind(key).first();

  if (!row || Number(row.window_expires_at) <= now) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits (key, count, window_expires_at) VALUES (?, 1, ?)")
      .bind(key, now + windowSeconds * 1000)
      .run();
    return;
  }
  if (Number(row.count) >= limit) {
    throw new ApiException(429, "RATE_LIMITED", "Too many requests. Try again later.", {
      retry_after_seconds: Math.max(1, Math.ceil((Number(row.window_expires_at) - now) / 1000)),
    });
  }
  await env.DB.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
}

function withAuthCookies(request, env, response, accessToken, refreshToken) {
  const headers = new Headers(response.headers);
  const accessName = stringEnv(env, "ACCESS_COOKIE_NAME", "__Secure-aifood_access");
  const refreshName = stringEnv(env, "REFRESH_COOKIE_NAME", "__Host-aifood_refresh");
  if (accessToken) {
    headers.append("Set-Cookie", buildCookie(accessName, accessToken, {
      httpOnly: true,
      secure: boolEnv(env, "COOKIE_SECURE", true),
      sameSite: cookieSameSite(env),
      path: "/",
      maxAge: intEnv(env, "ACCESS_TOKEN_EXPIRE_MINUTES", 60) * 60,
      domain: accessCookieDomain(request, env, accessName),
    }));
  } else {
    headers.append("Set-Cookie", buildCookie(accessName, "", {
      httpOnly: true,
      secure: boolEnv(env, "COOKIE_SECURE", true),
      sameSite: cookieSameSite(env),
      path: "/",
      maxAge: 0,
      domain: accessCookieDomain(request, env, accessName),
    }));
  }

  if (refreshToken) {
    headers.append("Set-Cookie", buildCookie(refreshName, refreshToken, {
      httpOnly: true,
      secure: boolEnv(env, "COOKIE_SECURE", true),
      sameSite: cookieSameSite(env),
      path: "/",
      maxAge: intEnv(env, "REFRESH_TOKEN_EXPIRE_DAYS", 30) * 86400,
    }));
  } else {
    headers.append("Set-Cookie", buildCookie(refreshName, "", {
      httpOnly: true,
      secure: boolEnv(env, "COOKIE_SECURE", true),
      sameSite: cookieSameSite(env),
      path: "/",
      maxAge: 0,
    }));
  }
  return new Response(response.body, { status: response.status, headers });
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Number(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

function cookieSameSite(env) {
  const value = stringEnv(env, "COOKIE_SAMESITE", "Lax").toLowerCase();
  if (value === "none") return "None";
  if (value === "strict") return "Strict";
  return "Lax";
}

function accessCookieDomain(request, env, cookieName) {
  if (cookieName.startsWith("__Host-")) return "";
  const configured = stringEnv(env, "COOKIE_DOMAIN", "").trim();
  if (configured) return configured;
  const host = new URL(request.url).hostname;
  if (host.endsWith(".cremenality.ru")) return ".cremenality.ru";
  if (host.endsWith(".cremenality.online")) return ".cremenality.online";
  return "";
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

function accessTokenFromRequest(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return getCookie(request, stringEnv(env, "ACCESS_COOKIE_NAME", "__Secure-aifood_access"));
}

function wantsNativeTokens(request) {
  return new Set(["native", "mobile", "android", "ios"]).has(String(request.headers.get("x-ai-food-client") || "").toLowerCase());
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = csvEnv(env, "ALLOWED_ORIGINS");
  const headers = {
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AI-Food-Client",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new ApiException(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json");
  }
  try {
    return await request.json();
  } catch {
    throw new ApiException(400, "INVALID_JSON", "Invalid JSON body");
  }
}

async function maybeReadJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonError(status, code, message, details = {}) {
  return json({ detail: { error: { code, message, details } } }, status);
}

function withHeaders(response, headers) {
  const merged = new Headers(response.headers);
  Object.entries(headers).forEach(([key, value]) => {
    if (value != null && value !== "") merged.set(key, value);
  });
  return new Response(response.body, { status: response.status, headers: merged });
}

class ApiException extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function assertConfigured(env) {
  if (!env.DB) throw new ApiException(500, "DB_NOT_CONFIGURED", "D1 database binding DB is not configured");
  const secret = stringEnv(env, "SECRET_KEY", "") || stringEnv(env, "JWT_SECRET", "");
  if (!secret || secret === "change-me-in-production" || secret.length < 32) {
    throw new ApiException(500, "SECRET_KEY_NOT_CONFIGURED", "SECRET_KEY must be set to at least 32 characters");
  }
}

function normalizePath(pathname) {
  const value = pathname.replace(/\/+$/, "");
  return value || "/";
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function boolEnv(env, key, fallback) {
  const value = env[key];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intEnv(env, key, fallback) {
  const value = Number.parseInt(env[key], 10);
  return Number.isFinite(value) ? value : fallback;
}

function stringEnv(env, key, fallback = "") {
  const value = env[key];
  return value == null ? fallback : String(value);
}

function csvEnv(env, key) {
  return stringEnv(env, key, "").split(",").map((item) => item.trim()).filter(Boolean);
}

function truthy(value) {
  return value === true || value === 1 || value === "1";
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400 * 1000);
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function generateNumericCode(length) {
  const max = 10 ** length;
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return String(value).padStart(length, "0");
}

function randomBase64Url(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64UrlJson(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value).length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function timingSafeEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  let mismatch = a.length === b.length ? 0 : 1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
