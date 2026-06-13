import { routeCloudCore } from "./cloud-core.js";

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
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(retryDueCrmEvents(env));
  },
};

async function route(request, env) {
  assertConfigured(env);
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === "GET" && path === "/") {
    return json({ status: "AI Food Cloud API running" });
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
  if (request.method === "POST" && path === "/api/ai/chat") {
    await enforceRateLimit(env, request, "ai:chat", intEnv(env, "RATE_LIMIT_AI_PER_MINUTE", 20));
    return openAiChat(request, env);
  }
  if (request.method === "POST" && path === "/chat/message") {
    await enforceRateLimit(env, request, "ai:chat", intEnv(env, "RATE_LIMIT_AI_PER_MINUTE", 20));
    return openAiChat(request, env);
  }

  const cloudCoreResponse = await routeCloudCore(request, env, path, {
    ApiException,
    currentActiveUser,
    rateLimit: (scope) => enforceRateLimit(
      env,
      request,
      scope,
      intEnv(env, "RATE_LIMIT_AI_PER_MINUTE", 20),
    ),
  });
  if (cloudCoreResponse) return cloudCoreResponse;

  if (request.method === "POST" && path === "/api/partnership/requests") {
    await enforceRateLimit(env, request, "partnership:create", intEnv(env, "RATE_LIMIT_CRM_PER_MINUTE", 10));
    return createPartnershipRequest(request, env);
  }
  if (request.method === "POST" && path === "/api/crm/users/sync") {
    await enforceRateLimit(env, request, "crm:user-sync", intEnv(env, "RATE_LIMIT_CRM_PER_MINUTE", 10));
    return syncCurrentUserToCrm(request, env);
  }
  if (request.method === "GET" && path === "/api/partnership/threads") {
    return partnershipThreads(request, env);
  }
  if (request.method === "GET" && /^\/api\/partnership\/threads\/[^/]+$/.test(path)) {
    return partnershipThread(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "POST" && /^\/api\/partnership\/threads\/[^/]+\/messages$/.test(path)) {
    await enforceRateLimit(env, request, "partnership:message", intEnv(env, "RATE_LIMIT_CRM_PER_MINUTE", 10));
    return addPartnershipMessage(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "POST" && path === "/api/support/tickets") {
    await enforceRateLimit(env, request, "support:create", intEnv(env, "RATE_LIMIT_CRM_PER_MINUTE", 10));
    return createSupportTicket(request, env);
  }
  if (request.method === "GET" && path === "/api/support/tickets") {
    return supportTickets(request, env);
  }
  if (request.method === "GET" && /^\/api\/support\/tickets\/[^/]+$/.test(path)) {
    return supportTicket(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "POST" && /^\/api\/support\/tickets\/[^/]+\/messages$/.test(path)) {
    await enforceRateLimit(env, request, "support:message", intEnv(env, "RATE_LIMIT_CRM_PER_MINUTE", 10));
    return addSupportMessage(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "GET" && path === "/admin/users") {
    return adminUsers(request, env);
  }
  if (request.method === "PATCH" && /^\/admin\/users\/[^/]+\/block$/.test(path)) {
    return adminSetBlocked(request, env, decodeURIComponent(path.split("/")[3]));
  }
  if (request.method === "PATCH" && /^\/admin\/users\/[^/]+\/role$/.test(path)) {
    return adminSetRole(request, env, decodeURIComponent(path.split("/")[3]));
  }
  if (request.method === "DELETE" && /^\/admin\/users\/[^/]+$/.test(path)) {
    return adminDeleteUser(request, env, decodeURIComponent(path.split("/")[3]));
  }
  if (request.method === "GET" && path === "/admin/crm/partnerships") {
    return adminPartnershipThreads(request, env);
  }
  if (request.method === "POST" && /^\/admin\/crm\/partnerships\/[^/]+\/messages$/.test(path)) {
    return adminAddPartnershipMessage(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "PATCH" && /^\/admin\/crm\/partnerships\/[^/]+$/.test(path)) {
    return adminUpdatePartnership(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "GET" && path === "/admin/crm/support") {
    return adminSupportTickets(request, env);
  }
  if (request.method === "POST" && /^\/admin\/crm\/support\/[^/]+\/messages$/.test(path)) {
    return adminAddSupportMessage(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "PATCH" && /^\/admin\/crm\/support\/[^/]+$/.test(path)) {
    return adminUpdateSupportTicket(request, env, decodeURIComponent(path.split("/")[4]));
  }
  if (request.method === "POST" && path === "/api/crm/retry-failed") {
    return retryFailedCrmEvents(request, env);
  }
  if (request.method === "GET" && path === "/admin/crm/outbox") {
    return adminCrmOutbox(request, env);
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
  await queueUserContactSync(env, fresh, clientSource(request));
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

async function openAiChat(request, env) {
  const user = await currentActiveUser(request, env);
  const data = await readJson(request);
  const message = cleanText(data.message, 4000, "message");
  const history = Array.isArray(data.history) ? data.history.slice(-12) : [];
  const apiKey = stringEnv(env, "OPENAI_API_KEY", "");
  if (!apiKey) throw new ApiException(503, "OPENAI_NOT_CONFIGURED", "OpenAI API is not configured");

  const storedProfile = parseProfile(user.profile_json);
  const profile = {
    age: boundedNumber(data.age ?? storedProfile.age, 10, 100, 25),
    gender: cleanOptionalText(data.gender ?? storedProfile.gender ?? storedProfile.sex, 20) || "male",
    height_cm: boundedNumber(data.height ?? data.height_cm ?? storedProfile.height ?? storedProfile.height_cm, 80, 250, 175),
    weight_kg: boundedNumber(data.weight ?? data.weight_kg ?? storedProfile.weight ?? storedProfile.weight_kg, 25, 350, 70),
    activity_level: cleanOptionalText(data.activity_level ?? storedProfile.activity_level, 40) || "moderate",
    daily_calories: boundedNumber(
      data.daily_calories ?? data.target_calories ?? storedProfile.daily_calories ?? storedProfile.target_calories,
      900,
      5000,
      2000,
    ),
    diet_type: cleanOptionalText(data.diet_type ?? storedProfile.diet_type, 40) || "normal",
    meals_per_day: boundedNumber(data.meals_per_day ?? storedProfile.meals_per_day, 1, 6, 3),
    allergens: cleanStringList(data.allergens ?? storedProfile.allergens ?? storedProfile.allergies, 30, 80),
    favorite_products: cleanStringList(
      data.favorite_products ?? storedProfile.favorite_products ?? storedProfile.preferred_ingredients,
      30,
      80,
    ),
    disliked_products: cleanStringList(
      data.disliked_products ?? storedProfile.disliked_products ?? storedProfile.disliked_ingredients,
      30,
      80,
    ),
    excluded_products: cleanStringList(
      data.excluded_products ?? storedProfile.excluded_products ?? storedProfile.excluded_ingredients,
      30,
      80,
    ),
  };
  const input = history
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: cleanOptionalText(item?.content, 4000),
    }))
    .filter((item) => item.content);
  input.push({ role: "user", content: message });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: stringEnv(env, "OPENAI_MODEL", "gpt-5.4-mini"),
      instructions: buildAiFoodInstructions(profile),
      input,
      max_output_tokens: intEnv(env, "OPENAI_MAX_OUTPUT_TOKENS", 900),
      store: false,
      metadata: { app: "ai-food" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("OpenAI request failed", response.status, JSON.stringify(body).slice(0, 800));
    throw new ApiException(502, "OPENAI_REQUEST_FAILED", "AI provider could not complete the request");
  }
  const output = extractOpenAiText(body);
  if (!output) throw new ApiException(502, "OPENAI_EMPTY_RESPONSE", "AI provider returned an empty response");
  return json({ response: output, provider: "openai", model: body.model || stringEnv(env, "OPENAI_MODEL", "gpt-5.4-mini") });
}

async function createPartnershipRequest(request, env) {
  const data = await readJson(request);
  if (data.consent !== true) throw new ApiException(400, "CONSENT_REQUIRED", "Consent is required");
  rejectHoneypot(data);
  await verifyTurnstile(env, request, data.turnstile_token, "partnership");
  const user = await optionalActiveUser(request, env);
  const email = user?.email || normalizeEmail(data.email);
  if (!isEmail(email)) throw new ApiException(400, "INVALID_EMAIL", "Valid email is required");

  const cooperationType = enumValue(data.cooperation_type, ["small_business", "enterprise_api"], "cooperation_type");
  const authorName = cleanText(data.author_name, 120, "author_name");
  const companyName = cleanOptionalText(data.company_name, 160);
  const subject = cleanText(data.subject, 180, "subject");
  const proposalMessage = cleanText(data.proposal_message, 6000, "proposal_message");
  ensureMinimumLength(subject, 3, "subject");
  ensureMinimumLength(proposalMessage, 10, "proposal_message");
  const preferredContact = enumValue(data.preferred_contact || "email", ["email", "telegram", "phone", "other"], "preferred_contact");
  const now = new Date().toISOString();
  const threadId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const guestToken = user ? "" : randomBase64Url(32);
  const outboxId = crypto.randomUUID();
  const payload = {
    cooperation_type: cooperationType,
    email,
    author_name: authorName,
    company_name: companyName,
    subject,
    proposal_message: proposalMessage,
    preferred_contact: preferredContact,
    user_id: user?.id || null,
    thread_id: threadId,
    status: "new",
    source: "website_cooperation",
    created_at: now,
  };

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO partnership_threads (
        id, user_id, email, cooperation_type, author_name, company_name, subject,
        preferred_contact, status, source, guest_token_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 'website_cooperation', ?, ?, ?)
    `).bind(
      threadId, user?.id || null, email, cooperationType, authorName, companyName || null,
      subject, preferredContact, guestToken ? await sha256Hex(guestToken) : null, now, now,
    ),
    env.DB.prepare(`
      INSERT INTO partnership_messages (id, thread_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'user', ?, ?, 0, ?)
    `).bind(messageId, threadId, authorName, proposalMessage, now),
    outboxInsert(env, outboxId, "partnership_created", "partnership", threadId, payload, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, user, "partnership.created", "partnership", threadId, {
    cooperation_type: cooperationType,
    email,
  });
  const emailSent = await sendCrmConfirmationEmail(
    env,
    email,
    `Заявка AI Food принята: ${subject}`,
    `Мы получили вашу заявку «${subject}». Ответ появится в чате с представителем и придет на этот email.`,
  );
  await notifyTeam(
    env,
    `Новая заявка на сотрудничество: ${subject}`,
    `${authorName} (${email})\n${proposalMessage}`,
    "CRM_MANAGER_EMAILS",
  );

  return json({
    thread: await getPartnershipThreadRecord(env, threadId),
    guest_access_token: guestToken || undefined,
    email_sent: emailSent,
    message: "Заявка отправлена. Ответ появится в чате и придет на email.",
  }, 201);
}

async function partnershipThreads(request, env) {
  const user = await currentActiveUser(request, env);
  const rows = await env.DB.prepare(`
    SELECT id, email, cooperation_type, author_name, company_name, subject, preferred_contact,
           status, source, crm_sync_status, created_at, updated_at
    FROM partnership_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100
  `).bind(user.id).all();
  return json({ threads: rows.results || [] });
}

async function partnershipThread(request, env, threadId) {
  const thread = await requirePartnershipAccess(request, env, threadId);
  const messages = await env.DB.prepare(`
    SELECT id, sender_type, sender_name, message, is_read, created_at
    FROM partnership_messages WHERE thread_id = ? ORDER BY created_at ASC
  `).bind(threadId).all();
  const user = await optionalActiveUser(request, env);
  if (!user || !staffPermissions(user, env).manage_partnerships) {
    await env.DB.prepare("UPDATE partnership_messages SET is_read = 1 WHERE thread_id = ? AND sender_type = 'manager'")
      .bind(threadId).run();
  }
  return json({ thread: publicPartnershipThread(thread), messages: messages.results || [] });
}

async function addPartnershipMessage(request, env, threadId) {
  const thread = await requirePartnershipAccess(request, env, threadId);
  if (thread.status === "closed") throw new ApiException(409, "THREAD_CLOSED", "This conversation is closed");
  const user = await optionalActiveUser(request, env);
  const data = await readJson(request);
  const message = cleanText(data.message, 6000, "message");
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO partnership_messages (id, thread_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'user', ?, ?, 0, ?)
    `).bind(messageId, threadId, user?.email || thread.author_name || thread.email, message, now),
    env.DB.prepare("UPDATE partnership_threads SET status = 'in_progress', crm_sync_status = 'pending', updated_at = ? WHERE id = ?").bind(now, threadId),
    outboxInsert(env, outboxId, "partnership_message", "partnership", threadId, {
      thread_id: threadId, message, sender_type: "user", status: "in_progress", created_at: now,
    }, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, user, "partnership.message.user", "partnership", threadId);
  return json({ message: "Message sent", id: messageId }, 201);
}

async function createSupportTicket(request, env) {
  const user = await currentActiveUser(request, env);
  const data = await readJson(request);
  if (data.consent !== true) throw new ApiException(400, "CONSENT_REQUIRED", "Consent is required");
  rejectHoneypot(data);
  await verifyTurnstile(env, request, data.turnstile_token, "support");
  const subject = cleanText(data.subject, 180, "subject");
  const message = cleanText(data.message, 6000, "message");
  ensureMinimumLength(subject, 3, "subject");
  ensureMinimumLength(message, 10, "message");
  const category = enumValue(
    data.category || "other",
    ["account", "ai_chat", "food_recognition", "bug", "other", "general", "billing", "feature", "privacy"],
    "category",
  );
  const now = new Date().toISOString();
  const ticketId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const payload = {
    ticket_id: ticketId,
    user_id: user.id,
    email: user.email,
    subject,
    message,
    category,
    status: "new",
    priority: "normal",
    created_at: now,
  };
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_tickets (id, user_id, email, subject, category, status, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'new', 'normal', ?, ?)
    `).bind(ticketId, user.id, user.email, subject, category, now, now),
    env.DB.prepare(`
      INSERT INTO support_messages (id, ticket_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'user', ?, ?, 0, ?)
    `).bind(messageId, ticketId, user.email, message, now),
    outboxInsert(env, outboxId, "support_created", "support", ticketId, payload, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, user, "support.created", "support", ticketId, { category, email: user.email });
  const emailSent = await sendCrmConfirmationEmail(
    env,
    user.email,
    `Обращение AI Food принято: ${subject}`,
    `Мы получили ваше обращение «${subject}». Ответ появится в профиле и придет на этот email.`,
  );
  await notifyTeam(
    env,
    `Новое обращение в поддержку: ${subject}`,
    `${user.email}\n${message}`,
    "SUPPORT_MANAGER_EMAILS",
  );
  return json({
    ticket: await getSupportTicketRecord(env, ticketId),
    email_sent: emailSent,
    message: "Обращение создано. Подтверждение отправлено на email.",
  }, 201);
}

async function supportTickets(request, env) {
  const user = await currentActiveUser(request, env);
  const rows = await env.DB.prepare(`
    SELECT id, email, subject, category, status, priority, crm_sync_status, created_at, updated_at
    FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100
  `).bind(user.id).all();
  return json({ tickets: rows.results || [] });
}

async function supportTicket(request, env, ticketId) {
  const user = await currentActiveUser(request, env);
  const ticket = await getSupportTicketRecord(env, ticketId);
  if (!ticket) throw new ApiException(404, "TICKET_NOT_FOUND", "Support ticket not found");
  if (ticket.user_id !== user.id && !staffPermissions(user, env).manage_support) {
    throw new ApiException(403, "FORBIDDEN", "Access denied");
  }
  const messages = await env.DB.prepare(`
    SELECT id, sender_type, sender_name, message, is_read, created_at
    FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC
  `).bind(ticketId).all();
  if (ticket.user_id === user.id) {
    await env.DB.prepare("UPDATE support_messages SET is_read = 1 WHERE ticket_id = ? AND sender_type = 'manager'")
      .bind(ticketId).run();
  }
  return json({ ticket, messages: messages.results || [] });
}

async function addSupportMessage(request, env, ticketId) {
  const user = await currentActiveUser(request, env);
  const ticket = await getSupportTicketRecord(env, ticketId);
  if (!ticket) throw new ApiException(404, "TICKET_NOT_FOUND", "Support ticket not found");
  if (ticket.user_id !== user.id) throw new ApiException(403, "FORBIDDEN", "Access denied");
  if (ticket.status === "closed") throw new ApiException(409, "TICKET_CLOSED", "This support ticket is closed");
  const data = await readJson(request);
  const message = cleanText(data.message, 6000, "message");
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_messages (id, ticket_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'user', ?, ?, 0, ?)
    `).bind(messageId, ticketId, user.email, message, now),
    env.DB.prepare("UPDATE support_tickets SET status = 'in_progress', crm_sync_status = 'pending', updated_at = ? WHERE id = ?").bind(now, ticketId),
    outboxInsert(env, outboxId, "support_message", "support", ticketId, {
      ticket_id: ticketId, message, sender_type: "user", status: "in_progress", created_at: now,
    }, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, user, "support.message.user", "support", ticketId);
  return json({ message: "Message sent", id: messageId }, 201);
}

async function adminPartnershipThreads(request, env) {
  const admin = await currentPartnershipManager(request, env);
  const rows = await env.DB.prepare(`
    SELECT id, user_id, email, cooperation_type, author_name, company_name, subject,
           preferred_contact, status, crm_sync_status, crm_entity_id, created_at, updated_at
    FROM partnership_threads ORDER BY updated_at DESC LIMIT 200
  `).all();
  return json({ threads: rows.results || [], admin: publicUser(admin, env) });
}

async function adminAddPartnershipMessage(request, env, threadId) {
  const admin = await currentPartnershipManager(request, env);
  const thread = await getPartnershipThreadRecord(env, threadId);
  if (!thread) throw new ApiException(404, "THREAD_NOT_FOUND", "Partnership thread not found");
  const data = await readJson(request);
  const message = cleanText(data.message, 6000, "message");
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO partnership_messages (id, thread_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'manager', ?, ?, 0, ?)
    `).bind(messageId, threadId, admin.email, message, now),
    env.DB.prepare("UPDATE partnership_threads SET status = 'waiting_user', crm_sync_status = 'pending', updated_at = ? WHERE id = ?").bind(now, threadId),
    outboxInsert(env, outboxId, "partnership_message", "partnership", threadId, {
      thread_id: threadId, message, sender_type: "manager", status: "waiting_user", created_at: now,
    }, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, admin, "partnership.message.manager", "partnership", threadId);
  const emailSent = await sendCrmReplyEmail(
    env,
    thread.email,
    `Ответ AI Food: ${thread.subject}`,
    message,
  );
  return json({ message: "Reply sent", id: messageId, email_sent: emailSent }, 201);
}

async function adminUpdatePartnership(request, env, threadId) {
  const manager = await currentPartnershipManager(request, env);
  const data = await readJson(request);
  const status = enumValue(data.status, ["new", "in_progress", "waiting_user", "closed"], "status");
  const now = new Date().toISOString();
  const outboxId = crypto.randomUUID();
  const result = await env.DB.prepare("UPDATE partnership_threads SET status = ?, crm_sync_status = 'pending', updated_at = ? WHERE id = ?")
    .bind(status, now, threadId).run();
  if (!result.meta?.changes) throw new ApiException(404, "THREAD_NOT_FOUND", "Partnership thread not found");
  await outboxInsert(env, outboxId, "partnership_status", "partnership", threadId, {
    thread_id: threadId,
    status,
    changed_by: manager.email,
    created_at: now,
  }, now).run();
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, manager, "partnership.status", "partnership", threadId, { status });
  return json({ thread: await getPartnershipThreadRecord(env, threadId) });
}

async function adminSupportTickets(request, env) {
  const admin = await currentSupportManager(request, env);
  const rows = await env.DB.prepare(`
    SELECT id, user_id, email, subject, category, status, priority, crm_sync_status,
           crm_entity_id, created_at, updated_at
    FROM support_tickets ORDER BY updated_at DESC LIMIT 200
  `).all();
  return json({ tickets: rows.results || [], admin: publicUser(admin, env) });
}

async function adminAddSupportMessage(request, env, ticketId) {
  const admin = await currentSupportManager(request, env);
  const ticket = await getSupportTicketRecord(env, ticketId);
  if (!ticket) throw new ApiException(404, "TICKET_NOT_FOUND", "Support ticket not found");
  const data = await readJson(request);
  const message = cleanText(data.message, 6000, "message");
  const now = new Date().toISOString();
  const messageId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO support_messages (id, ticket_id, sender_type, sender_name, message, is_read, created_at)
      VALUES (?, ?, 'manager', ?, ?, 0, ?)
    `).bind(messageId, ticketId, admin.email, message, now),
    env.DB.prepare("UPDATE support_tickets SET status = 'waiting_user', crm_sync_status = 'pending', updated_at = ? WHERE id = ?").bind(now, ticketId),
    outboxInsert(env, outboxId, "support_message", "support", ticketId, {
      ticket_id: ticketId, message, sender_type: "manager", status: "waiting_user", created_at: now,
    }, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, admin, "support.message.manager", "support", ticketId);
  const emailSent = await sendCrmReplyEmail(
    env,
    ticket.email,
    `Ответ поддержки AI Food: ${ticket.subject}`,
    message,
  );
  return json({ message: "Reply sent", id: messageId, email_sent: emailSent }, 201);
}

async function sendCrmReplyEmail(env, recipient, subject, message) {
  try {
    await sendEmail(env, recipient, subject, message, `<p>${escapeHtmlForEmail(message)}</p>`);
    return true;
  } catch (error) {
    console.error("CRM reply email failed", {
      recipient,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function adminUpdateSupportTicket(request, env, ticketId) {
  const manager = await currentSupportManager(request, env);
  const data = await readJson(request);
  const status = enumValue(data.status, ["new", "in_progress", "waiting_user", "resolved", "closed"], "status");
  const priority = enumValue(data.priority || "normal", ["low", "normal", "high", "urgent"], "priority");
  const now = new Date().toISOString();
  const outboxId = crypto.randomUUID();
  const result = await env.DB.prepare("UPDATE support_tickets SET status = ?, priority = ?, crm_sync_status = 'pending', updated_at = ? WHERE id = ?")
    .bind(status, priority, now, ticketId).run();
  if (!result.meta?.changes) throw new ApiException(404, "TICKET_NOT_FOUND", "Support ticket not found");
  await outboxInsert(env, outboxId, "support_status", "support", ticketId, {
    ticket_id: ticketId,
    status,
    priority,
    changed_by: manager.email,
    created_at: now,
  }, now).run();
  await trySyncCrmEvent(env, outboxId);
  await writeAudit(env, manager, "support.status", "support", ticketId, { status, priority });
  return json({ ticket: await getSupportTicketRecord(env, ticketId) });
}

async function retryFailedCrmEvents(request, env) {
  const integrator = await currentIntegrator(request, env);
  await writeAudit(env, integrator, "crm.retry", "crm", null);
  return json(await retryDueCrmEvents(env));
}

async function adminCrmOutbox(request, env) {
  const integrator = await currentIntegrator(request, env);
  const rows = await env.DB.prepare(`
    SELECT id, event_type, entity_type, entity_id, status, attempts, next_retry_at,
           last_error, created_at, updated_at
    FROM crm_outbox
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  return json({ events: rows.results || [], staff: publicUser(integrator, env) });
}

async function retryDueCrmEvents(env) {
  if (!stringEnv(env, "BITRIX_WEBHOOK_URL", "")) return { checked: 0, synced: 0 };
  const rows = await env.DB.prepare(`
    SELECT id FROM crm_outbox
    WHERE status IN ('pending', 'failed') AND (next_retry_at IS NULL OR next_retry_at <= ?)
    ORDER BY created_at ASC LIMIT 50
  `).bind(new Date().toISOString()).all();
  let synced = 0;
  for (const row of rows.results || []) {
    if (await trySyncCrmEvent(env, row.id)) synced += 1;
  }
  return { checked: rows.results?.length || 0, synced };
}

async function syncCurrentUserToCrm(request, env) {
  const user = await currentActiveUser(request, env);
  const data = await maybeReadJson(request) || {};
  const source = enumValue(data.source || "website", ["website", "web-chat", "android"], "source");
  await queueUserContactSync(env, user, source);
  return json({ message: "CRM synchronization queued" }, 202);
}

async function queueUserContactSync(env, user, source) {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT crm_entity_id, source FROM crm_user_contacts WHERE user_id = ?").bind(user.id).first();
  const resolvedSource = source || existing?.source || "website";
  const payload = {
    user_id: user.id,
    email: user.email,
    role: userRole(user, env),
    source: resolvedSource,
    is_blocked: truthy(user.is_blocked),
    created_at: user.created_at,
    crm_entity_id: existing?.crm_entity_id || null,
  };
  const outboxId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO crm_user_contacts (user_id, email, source, is_blocked, crm_entity_id, sync_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        email = excluded.email, source = excluded.source, is_blocked = excluded.is_blocked,
        sync_status = 'pending', updated_at = excluded.updated_at
    `).bind(user.id, user.email, resolvedSource, truthy(user.is_blocked) ? 1 : 0, existing?.crm_entity_id || null, user.created_at, now),
    outboxInsert(env, outboxId, existing?.crm_entity_id ? "user_updated" : "user_created", "user", user.id, payload, now),
  ]);
  await trySyncCrmEvent(env, outboxId);
}

function outboxInsert(env, id, eventType, entityType, entityId, payload, now) {
  return env.DB.prepare(`
    INSERT INTO crm_outbox (id, event_type, entity_type, entity_id, payload_json, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).bind(id, eventType, entityType, entityId, JSON.stringify(payload), now, now);
}

async function trySyncCrmEvent(env, outboxId) {
  const webhook = stringEnv(env, "BITRIX_WEBHOOK_URL", "").replace(/\/$/, "");
  if (!webhook) return false;
  const row = await env.DB.prepare("SELECT * FROM crm_outbox WHERE id = ?").bind(outboxId).first();
  if (!row || row.status === "synced") return true;
  const payload = JSON.parse(row.payload_json);
  const entityTypeId = crmEntityTypeId(env, row.entity_type);
  if (!entityTypeId) return false;

  try {
    const crmEntityId = payload.crm_entity_id || await currentCrmEntityId(env, row.entity_type, row.entity_id);
    let remoteId = String(crmEntityId || "");

    if (row.event_type.endsWith("_message")) {
      if (!crmEntityId) throw new Error("CRM entity is not created yet");
      const statusFields = bitrixStatusFields(env, row.entity_type, payload);
      if (Object.keys(statusFields).length) {
        await bitrixRequest(env, webhook, "crm.item.update.json", {
          entityTypeId,
          id: crmEntityId,
          fields: statusFields,
        });
      }
      await bitrixRequest(env, webhook, "crm.timeline.comment.add.json", {
        fields: {
          ENTITY_ID: crmEntityId,
          ENTITY_TYPE: stringEnv(env, `BITRIX_${row.entity_type.toUpperCase()}_OWNER_TYPE`, `dynamic_${entityTypeId}`),
          COMMENT: bitrixTimelineComment(payload),
        },
      });
    } else if (row.event_type.endsWith("_status")) {
      if (!crmEntityId) throw new Error("CRM entity is not created yet");
      const fields = bitrixStatusFields(env, row.entity_type, payload);
      if (Object.keys(fields).length) {
        await bitrixRequest(env, webhook, "crm.item.update.json", {
          entityTypeId,
          id: crmEntityId,
          fields,
        });
      }
      await bitrixRequest(env, webhook, "crm.timeline.comment.add.json", {
        fields: {
          ENTITY_ID: crmEntityId,
          ENTITY_TYPE: stringEnv(env, `BITRIX_${row.entity_type.toUpperCase()}_OWNER_TYPE`, `dynamic_${entityTypeId}`),
          COMMENT: bitrixStatusComment(row.entity_type, payload),
        },
      });
    } else {
      const fields = bitrixFields(env, row.entity_type, payload);
      const result = await bitrixRequest(
        env,
        webhook,
        crmEntityId ? "crm.item.update.json" : "crm.item.add.json",
        crmEntityId
          ? { entityTypeId, id: crmEntityId, fields }
          : { entityTypeId, fields },
      );
      remoteId = String(result.result?.item?.id || result.result?.id || crmEntityId || "");
    }

    await markCrmSynced(env, row.entity_type, row.entity_id, remoteId);
    await env.DB.prepare("UPDATE crm_outbox SET status = 'synced', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), outboxId).run();
    return true;
  } catch (error) {
    const attempts = Number(row.attempts || 0) + 1;
    const retryAt = new Date(Date.now() + Math.min(3600, 30 * (2 ** Math.min(attempts, 7))) * 1000).toISOString();
    await env.DB.prepare(`
      UPDATE crm_outbox SET status = 'failed', attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?
    `).bind(attempts, retryAt, String(error?.message || error).slice(0, 1000), new Date().toISOString(), outboxId).run();
    await markCrmFailed(env, row.entity_type, row.entity_id);
    await writeAudit(env, null, "crm.sync.failed", row.entity_type, row.entity_id, {
      event_type: row.event_type,
      error: String(error?.message || error).slice(0, 500),
    });
    console.error("CRM sync failed", row.event_type, row.entity_id, error?.message || error);
    await notifyTelegram(env, `AI Food CRM error\n${row.event_type} ${row.entity_id}\n${String(error?.message || error).slice(0, 500)}`);
    return false;
  }
}

async function bitrixRequest(env, webhook, method, body) {
  const response = await fetch(`${webhook}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(intEnv(env, "BITRIX_TIMEOUT_MS", 12000)),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    throw new Error(result.error_description || result.error || `HTTP ${response.status}`);
  }
  return result;
}

function crmEntityTypeId(env, entityType) {
  if (entityType === "partnership") return stringEnv(env, "BITRIX_PARTNERSHIP_ENTITY_TYPE_ID", "");
  if (entityType === "support") return stringEnv(env, "BITRIX_SUPPORT_ENTITY_TYPE_ID", "");
  if (entityType === "user") return stringEnv(env, "BITRIX_USER_ENTITY_TYPE_ID", "");
  return "";
}

function bitrixFields(env, entityType, payload) {
  if (entityType === "partnership") {
    const fields = {
      title: payload.subject || `Partnership ${payload.thread_id}`,
      originatorId: "AI_FOOD",
      originId: payload.thread_id || "",
    };
    addResponsible(env, fields, "PARTNERSHIP");
    addBitrixField(
      env,
      fields,
      "BITRIX_PARTNERSHIP_FIELD_COOPERATION_TYPE",
      bitrixEnumValue(env, "partnership", "cooperation_type", payload.cooperation_type),
    );
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_EMAIL", payload.email);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_AUTHOR_NAME", payload.author_name);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_COMPANY_NAME", payload.company_name);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_SUBJECT", payload.subject);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_PROPOSAL_MESSAGE", payload.proposal_message);
    addBitrixField(
      env,
      fields,
      "BITRIX_PARTNERSHIP_FIELD_PREFERRED_CONTACT",
      bitrixEnumValue(env, "partnership", "preferred_contact", payload.preferred_contact),
    );
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_USER_ID", payload.user_id);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_THREAD_ID", payload.thread_id);
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_STATUS", bitrixEnumValue(env, "partnership", "status", payload.status));
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_SOURCE", bitrixEnumValue(env, "partnership", "source", payload.source));
    addBitrixField(env, fields, "BITRIX_PARTNERSHIP_FIELD_CREATED_AT", payload.created_at);
    return fields;
  }
  if (entityType === "support") {
    const fields = {
      title: payload.subject || `Support ${payload.ticket_id}`,
      originatorId: "AI_FOOD",
      originId: payload.ticket_id || "",
    };
    addResponsible(env, fields, "SUPPORT");
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_EMAIL", payload.email);
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_USER_ID", payload.user_id);
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_SUBJECT", payload.subject);
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_MESSAGE", payload.message);
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_CATEGORY", bitrixEnumValue(env, "support", "category", payload.category));
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_STATUS", bitrixEnumValue(env, "support", "status", payload.status));
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_PRIORITY", bitrixEnumValue(env, "support", "priority", payload.priority));
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_TICKET_ID", payload.ticket_id);
    addBitrixField(
      env,
      fields,
      "BITRIX_SUPPORT_FIELD_SOURCE",
      bitrixEnumValue(env, "support", "source", payload.source || "profile_support"),
    );
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_CREATED_AT", payload.created_at);
    return fields;
  }
  const fields = {
    title: payload.email,
    originatorId: "AI_FOOD",
    originId: payload.user_id || "",
  };
  addResponsible(env, fields, "USER");
  addBitrixField(env, fields, "BITRIX_USER_FIELD_USER_ID", payload.user_id);
  addBitrixField(env, fields, "BITRIX_USER_FIELD_EMAIL", payload.email);
  addBitrixField(env, fields, "BITRIX_USER_FIELD_ROLE", payload.role);
  addBitrixField(env, fields, "BITRIX_USER_FIELD_SOURCE", bitrixEnumValue(env, "user", "source", payload.source || "website"));
  addBitrixField(env, fields, "BITRIX_USER_FIELD_IS_BLOCKED", payload.is_blocked ? "Y" : "N");
  addBitrixField(env, fields, "BITRIX_USER_FIELD_CREATED_AT", payload.created_at);
  return fields;
}

function bitrixStatusFields(env, entityType, payload) {
  const fields = {};
  if (entityType === "partnership") {
    addBitrixField(
      env,
      fields,
      "BITRIX_PARTNERSHIP_FIELD_STATUS",
      bitrixEnumValue(env, "partnership", "status", payload.status),
    );
  }
  if (entityType === "support") {
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_STATUS", bitrixEnumValue(env, "support", "status", payload.status));
    addBitrixField(env, fields, "BITRIX_SUPPORT_FIELD_PRIORITY", bitrixEnumValue(env, "support", "priority", payload.priority));
  }
  return fields;
}

function addResponsible(env, fields, prefix) {
  const value = Number(stringEnv(env, `BITRIX_${prefix}_RESPONSIBLE_ID`, ""));
  if (Number.isInteger(value) && value > 0) fields.assignedById = value;
}

function addBitrixField(env, fields, envName, value) {
  const fieldName = stringEnv(env, envName, "").trim();
  if (!fieldName || value == null || value === "") return;
  fields[fieldName] = value;
}

function bitrixEnumValue(env, entityType, fieldName, value) {
  if (value == null || value === "") return value;
  try {
    const mapping = JSON.parse(stringEnv(env, "BITRIX_ENUM_MAP_JSON", "{}"));
    return mapping[`${entityType}.${fieldName}.${value}`] ?? value;
  } catch {
    return value;
  }
}

function bitrixTimelineComment(payload) {
  const sender = payload.sender_type === "manager" ? "Представитель AI Food" : "Пользователь";
  return `${sender}: ${String(payload.message || "").slice(0, 6000)}`;
}

function bitrixStatusComment(entityType, payload) {
  const label = entityType === "support" ? "Обращение поддержки" : "Заявка на сотрудничество";
  const priority = payload.priority ? `, приоритет: ${payload.priority}` : "";
  return `${label}: статус изменен на ${payload.status}${priority}.`;
}

async function currentCrmEntityId(env, entityType, entityId) {
  if (entityType === "partnership") {
    return (await env.DB.prepare("SELECT crm_entity_id FROM partnership_threads WHERE id = ?").bind(entityId).first())?.crm_entity_id || "";
  }
  if (entityType === "support") {
    return (await env.DB.prepare("SELECT crm_entity_id FROM support_tickets WHERE id = ?").bind(entityId).first())?.crm_entity_id || "";
  }
  if (entityType === "user") {
    return (await env.DB.prepare("SELECT crm_entity_id FROM crm_user_contacts WHERE user_id = ?").bind(entityId).first())?.crm_entity_id || "";
  }
  return "";
}

async function markCrmSynced(env, entityType, entityId, remoteId) {
  const now = new Date().toISOString();
  if (entityType === "partnership") {
    await env.DB.prepare("UPDATE partnership_threads SET crm_entity_id = ?, crm_sync_status = 'synced', updated_at = ? WHERE id = ?")
      .bind(remoteId || null, now, entityId).run();
  } else if (entityType === "support") {
    await env.DB.prepare("UPDATE support_tickets SET crm_entity_id = ?, crm_sync_status = 'synced', updated_at = ? WHERE id = ?")
      .bind(remoteId || null, now, entityId).run();
  } else if (entityType === "user") {
    await env.DB.prepare("UPDATE crm_user_contacts SET crm_entity_id = ?, sync_status = 'synced', last_error = NULL, updated_at = ? WHERE user_id = ?")
      .bind(remoteId || null, now, entityId).run();
  }
}

async function markCrmFailed(env, entityType, entityId) {
  if (entityType === "partnership") {
    await env.DB.prepare("UPDATE partnership_threads SET crm_sync_status = 'failed' WHERE id = ?").bind(entityId).run();
  } else if (entityType === "support") {
    await env.DB.prepare("UPDATE support_tickets SET crm_sync_status = 'failed' WHERE id = ?").bind(entityId).run();
  } else if (entityType === "user") {
    await env.DB.prepare("UPDATE crm_user_contacts SET sync_status = 'failed' WHERE user_id = ?").bind(entityId).run();
  }
}

async function requirePartnershipAccess(request, env, threadId) {
  const thread = await getPartnershipThreadRecord(env, threadId);
  if (!thread) throw new ApiException(404, "THREAD_NOT_FOUND", "Partnership thread not found");
  const user = await optionalActiveUser(request, env);
  if (user && (thread.user_id === user.id || staffPermissions(user, env).manage_partnerships)) return thread;
  const guestToken = String(request.headers.get("x-thread-token") || "");
  if (guestToken && thread.guest_token_hash && timingSafeEqual(await sha256Hex(guestToken), thread.guest_token_hash)) return thread;
  throw new ApiException(403, "FORBIDDEN", "Access denied");
}

async function optionalActiveUser(request, env) {
  if (!accessTokenFromRequest(request, env)) return null;
  return currentActiveUser(request, env);
}

async function getPartnershipThreadRecord(env, id) {
  return env.DB.prepare("SELECT * FROM partnership_threads WHERE id = ?").bind(id).first();
}

async function getSupportTicketRecord(env, id) {
  return env.DB.prepare("SELECT * FROM support_tickets WHERE id = ?").bind(id).first();
}

function publicPartnershipThread(thread) {
  const copy = { ...thread };
  delete copy.guest_token_hash;
  return copy;
}

async function sendCrmConfirmationEmail(env, recipient, subject, message) {
  try {
    await sendEmail(env, recipient, subject, message, `<p>${escapeHtmlForEmail(message)}</p>`);
    return true;
  } catch (error) {
    console.error("CRM confirmation email failed", recipient, error?.message || error);
    return false;
  }
}

async function notifyTeam(env, subject, text, additionalEmailEnv = "") {
  const recipients = new Set([
    ...roleEmails(env, "ADMIN_EMAILS"),
    ...(additionalEmailEnv ? roleEmails(env, additionalEmailEnv) : []),
  ]);
  for (const email of recipients) {
    try {
      await sendEmail(env, email, subject, text, `<p>${escapeHtmlForEmail(text).replace(/\n/g, "<br>")}</p>`);
    } catch (error) {
      console.error("Admin notification failed", email, error?.message || error);
    }
  }
  await notifyTelegram(env, `${subject}\n${text}`);
}

async function notifyTelegram(env, text) {
  const token = stringEnv(env, "TELEGRAM_BOT_TOKEN", "");
  const chatIds = csvEnv(env, "TELEGRAM_CHAT_IDS");
  if (!token || chatIds.length === 0) return false;
  let sent = false;
  for (const chatId of chatIds) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: String(text || "").slice(0, 3900),
          disable_web_page_preview: true,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sent = true;
    } catch (error) {
      console.error("Telegram notification failed", chatId, error?.message || error);
    }
  }
  return sent;
}

async function writeAudit(env, actor, action, entityType, entityId, metadata = {}) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (id, actor_user_id, actor_email, action, entity_type, entity_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      actor?.id || null,
      actor?.email || null,
      String(action || "").slice(0, 120),
      String(entityType || "").slice(0, 80),
      entityId || null,
      JSON.stringify(metadata || {}).slice(0, 8000),
      new Date().toISOString(),
    ).run();
  } catch (error) {
    console.error("Audit log write failed", error?.message || error);
  }
}

function buildAiFoodInstructions(profile) {
  return [
    "Ты AI Food, русскоязычный помощник по питанию.",
    "Отвечай конкретно, доброжелательно и без выдуманных медицинских диагнозов.",
    "При риске аллергии явно предупреждай пользователя. Не предлагай исключенные продукты.",
    "Не выдавай ответ за консультацию врача; при опасных симптомах советуй обратиться к специалисту.",
    `Профиль пользователя: ${JSON.stringify(profile)}.`,
  ].join("\n");
}

function extractOpenAiText(body) {
  if (typeof body.output_text === "string") return body.output_text.trim();
  return (body.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
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
  await queueUserContactSync(env, fresh, "");
  await writeAudit(env, admin, blocked ? "user.blocked" : "user.unblocked", "user", target.id, {
    email: target.email,
  });
  return json(publicUser(fresh, env));
}

async function adminSetRole(request, env, userId) {
  const admin = await currentAdminUser(request, env);
  const data = await readJson(request);
  const target = await getUserByIdOrEmail(env, userId);
  if (!target) throw new ApiException(404, "USER_NOT_FOUND", "User not found");
  if (isAdminEmail(env, target.email)) {
    throw new ApiException(400, "PROTECTED_ADMIN_ROLE", "Configured administrator role cannot be changed");
  }

  const role = enumValue(
    data.role,
    ["user", "crm_manager", "support_manager", "developer"],
    "role",
  );
  const previousRole = userRole(target, env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
      .bind(role, now, target.id),
    env.DB.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .bind(now, now, target.id),
  ]);

  const fresh = await getUserById(env, target.id);
  await queueUserContactSync(env, fresh, "");
  await writeAudit(env, admin, "user.role_changed", "user", target.id, {
    email: target.email,
    previous_role: previousRole,
    role,
  });
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
  await writeAudit(env, admin, "user.deleted", "user", target.id, { email: target.email });
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

async function currentPartnershipManager(request, env) {
  const user = await currentActiveUser(request, env);
  if (!staffPermissions(user, env).manage_partnerships) {
    throw new ApiException(403, "CRM_MANAGER_REQUIRED", "CRM manager access required");
  }
  return user;
}

async function currentSupportManager(request, env) {
  const user = await currentActiveUser(request, env);
  if (!staffPermissions(user, env).manage_support) {
    throw new ApiException(403, "SUPPORT_MANAGER_REQUIRED", "Support manager access required");
  }
  return user;
}

async function currentIntegrator(request, env) {
  const user = await currentActiveUser(request, env);
  if (!staffPermissions(user, env).manage_integration) {
    throw new ApiException(403, "INTEGRATOR_REQUIRED", "Integration access required");
  }
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
  const role = userRole(user, env);
  return {
    id: String(user.id),
    email: user.email,
    is_email_verified: truthy(user.is_email_verified),
    role,
    is_admin: role === "admin",
    permissions: staffPermissions(user, env),
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
  const email = normalizeEmail(user.email);
  if (roleEmails(env, "CRM_MANAGER_EMAILS").map(normalizeEmail).includes(email)) return "crm_manager";
  if (roleEmails(env, "SUPPORT_MANAGER_EMAILS").map(normalizeEmail).includes(email)) return "support_manager";
  if (roleEmails(env, "DEVELOPER_EMAILS").map(normalizeEmail).includes(email)) return "developer";
  const stored = String(user.role || "user").trim().toLowerCase();
  return ["crm_manager", "support_manager", "developer"].includes(stored) ? stored : "user";
}

function isAdminEmail(env, email) {
  return roleEmails(env, "ADMIN_EMAILS").map(normalizeEmail).includes(normalizeEmail(email));
}

function roleEmails(env, key) {
  const secretValues = csvEnv(env, `${key}_SECRET`);
  return secretValues.length ? secretValues : csvEnv(env, key);
}

function staffPermissions(user, env) {
  const role = userRole(user, env);
  return {
    manage_users: role === "admin",
    manage_partnerships: role === "admin" || role === "crm_manager",
    manage_support: role === "admin" || role === "support_manager",
    manage_integration: role === "admin" || role === "developer",
  };
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AI-Food-Client,X-Thread-Token",
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

function rejectHoneypot(data) {
  if (String(data?.website || "").trim()) {
    throw new ApiException(400, "SPAM_REJECTED", "Request rejected");
  }
}

async function verifyTurnstile(env, request, token, expectedAction) {
  const secret = stringEnv(env, "TURNSTILE_SECRET_KEY", "");
  if (!secret) return;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret,
      response: String(token || ""),
      remoteip: clientIp(request),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({}));
  const requestOrigin = request.headers.get("Origin");
  const expectedHostname = requestOrigin ? new URL(requestOrigin).hostname : "";
  const actionMatches = !expectedAction || result.action === expectedAction;
  const hostnameMatches = !expectedHostname || result.hostname === expectedHostname;
  if (!response.ok || result.success !== true || !actionMatches || !hostnameMatches) {
    throw new ApiException(400, "TURNSTILE_FAILED", "Anti-spam verification failed", {
      error_codes: Array.isArray(result["error-codes"]) ? result["error-codes"].slice(0, 5) : [],
    });
  }
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

function cleanText(value, maxLength, fieldName) {
  const text = String(value || "").trim();
  if (!text) throw new ApiException(400, "VALIDATION_ERROR", `${fieldName} is required`, { field: fieldName });
  if (text.length > maxLength) {
    throw new ApiException(400, "VALIDATION_ERROR", `${fieldName} is too long`, { field: fieldName, max_length: maxLength });
  }
  return text;
}

function ensureMinimumLength(value, minLength, fieldName) {
  if (String(value).length < minLength) {
    throw new ApiException(400, "VALIDATION_ERROR", `${fieldName} is too short`, {
      field: fieldName,
      min_length: minLength,
    });
  }
}

function cleanOptionalText(value, maxLength) {
  const text = String(value || "").trim();
  return text.slice(0, maxLength);
}

function cleanStringList(value, maxItems, maxItemLength) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => cleanOptionalText(item, maxItemLength))
    .filter(Boolean);
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function enumValue(value, allowed, fieldName) {
  const normalized = String(value || "").trim();
  if (!allowed.includes(normalized)) {
    throw new ApiException(400, "VALIDATION_ERROR", `${fieldName} has an invalid value`, {
      field: fieldName,
      allowed,
    });
  }
  return normalized;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && String(value).length <= 254;
}

function escapeHtmlForEmail(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function clientSource(request) {
  const client = String(request.headers.get("x-ai-food-client") || "").toLowerCase();
  if (client === "android" || client === "mobile" || client === "ios") return "android";
  const origin = String(request.headers.get("origin") || "").toLowerCase();
  if (origin.includes("cremenality.online")) return "web-chat";
  return "website";
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
