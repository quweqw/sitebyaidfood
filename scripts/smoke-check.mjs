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
  "src/admin.js",
  "src/router.js",
  "src/session.js",
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

for (const marker of [
  "id=\"registerForm\"",
  "id=\"verifyForm\"",
  "id=\"loginForm\"",
  "id=\"chatForm\"",
  "id=\"adminUsersBody\"",
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
  "/chat/message",
  "/admin/users",
]) {
  if (!api.includes(path)) throw new Error(`Missing API path: ${path}`);
}

if (html.includes("unpkg.com") || html.includes("https://cdn")) throw new Error("External CDN script found in HTML");
if (!headers.includes("Content-Security-Policy")) throw new Error("CSP header is missing");
if (!config.includes("https://api.cremenality.ru")) throw new Error("Production API URL is not configured");

console.log("Smoke check passed");
