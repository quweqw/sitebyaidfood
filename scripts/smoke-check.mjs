import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredFiles = [
  "index.html",
  "config.js",
  "_headers",
  "_redirects",
  "assets/favicon.svg",
  "assets/hero-ai-food.png",
  "src/styles.css",
  "src/main.js",
  "src/api.js",
  "src/auth.js",
  "src/chat.js",
  "src/crm.js",
  "src/admin.js",
  "src/router.js",
  "src/session.js",
  "src/turnstile.js",
  "src/config.js",
  "src/icons.js",
  "src/ui.js",
];

for (const file of requiredFiles) {
  await access(join(root, file), constants.R_OK);
}

const sourceFiles = (await readdir(join(root, "src")))
  .filter((file) => file.endsWith(".js"))
  .map((file) => join(root, "src", file));

for (const file of sourceFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${file}\n${result.stderr}`);
}

const html = await readFile(join(root, "index.html"), "utf8");
const headers = await readFile(join(root, "_headers"), "utf8");
const config = await readFile(join(root, "config.js"), "utf8");
const api = await readFile(join(root, "src/api.js"), "utf8");
const session = await readFile(join(root, "src/session.js"), "utf8");
const auth = await readFile(join(root, "src/auth.js"), "utf8");
const router = await readFile(join(root, "src/router.js"), "utf8");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate HTML ids: ${[...new Set(duplicateIds)].join(", ")}`);

for (const marker of [
  "id=\"registerForm\"",
  "id=\"verifyForm\"",
  "id=\"loginForm\"",
  "id=\"chatForm\"",
  "id=\"adminUsersBody\"",
  "id=\"partnershipForm\"",
  "id=\"supportForm\"",
  "id=\"adminUserSearch\"",
  "data-view=\"cooperation\"",
  "data-view=\"support\"",
  "data-view=\"requests\"",
  "data-turnstile-action=\"partnership\"",
  "data-turnstile-action=\"support\"",
  "id=\"adminCrmOutbox\"",
  "data-view=\"admin\"",
  "data-admin-only",
  "id=\"androidDownloadLink\"",
]) {
  if (!html.includes(marker)) throw new Error(`Missing HTML marker: ${marker}`);
}

for (const path of [
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification-code",
  "/auth/login",
  "/auth/me",
  "/auth/refresh",
  "/auth/logout",
  "/api/ai/chat",
  "/api/partnership/requests",
  "/api/support/tickets",
  "/admin/crm/outbox",
  "/admin/users",
  "/role",
]) {
  if (!api.includes(path)) throw new Error(`Missing API path: ${path}`);
}

if (html.includes("unpkg.com") || html.includes("https://cdn")) throw new Error("External CDN script found in HTML");
if (!headers.includes("Content-Security-Policy")) throw new Error("CSP header is missing");
if (!config.includes("https://api.cremenality.ru")) throw new Error("Production API URL is not configured");
if (!api.includes('credentials: "include"')) throw new Error("Cookie credentials are not enabled for API calls");
if (!api.includes('"X-AI-Food-Client": "native"')) throw new Error("Native token responses are required for chat handoff");
if (!session.includes("hash.set(\"token\"")) throw new Error("Chat handoff must pass access token in URL hash");
if (!auth.includes("withAccessToken(appConfig.chatAppUrl)")) throw new Error("Account chat link must include token handoff");
if (!router.includes("withAccessToken(appConfig.chatAppUrl)")) throw new Error("Hash router chat redirect must include token handoff");
if (session.includes("localStorage.setItem(keys.refresh")) {
  throw new Error("Browser must not persist refresh tokens in localStorage");
}

console.log("Smoke check passed");
