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
  "src/app.js",
  "src/styles.css",
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
const app = await readFile(join(root, "src/app.js"), "utf8");

for (const marker of [
  "id=\"authGate\"",
  "id=\"appShell\"",
  "id=\"chatForm\"",
  "id=\"settingsForm\"",
  "id=\"plannerForm\"",
  "id=\"photoInput\"",
]) {
  if (!html.includes(marker)) throw new Error(`Missing HTML marker: ${marker}`);
}

for (const endpoint of [
  "/auth/me",
  "/auth/refresh",
  "/auth/logout",
  "/api/ai/chat",
  "/recognition/image",
  "/meal-planner/intent/parse",
  "/meal-planner/generate",
  "/profile/calculate-calories",
]) {
  if (!app.includes(endpoint)) throw new Error(`Missing endpoint: ${endpoint}`);
}

if (!headers.includes("Content-Security-Policy")) throw new Error("CSP header is missing");
if (html.includes("RadminVPN") || app.includes("RadminVPN")) {
  throw new Error("Legacy VPN connection flow is still present");
}
if (!app.includes("return authRequest(path, options)")) {
  throw new Error("Cloud Core API routing is not enabled");
}
if (app.includes("localStorage.setItem(\"access_token") || app.includes("localStorage.setItem('access_token")) {
  throw new Error("Core bearer token must not be persisted in localStorage");
}

console.log("cremenality-online smoke check passed");
