import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0004_crm_production.sql", import.meta.url), "utf8");
const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

for (const marker of [
  'path === "/api/crm/users/sync"',
  'path === "/admin/crm/outbox"',
  '"crm.timeline.comment.add.json"',
  "BITRIX_PARTNERSHIP_FIELD_THREAD_ID",
  "BITRIX_SUPPORT_FIELD_TICKET_ID",
  "BITRIX_ENUM_MAP_JSON",
  "TURNSTILE_SECRET_KEY",
  "TELEGRAM_BOT_TOKEN",
  "staffPermissions",
  'roleEmails(env, "ADMIN_EMAILS")',
  'roleEmails(env, "CRM_MANAGER_EMAILS")',
  '`${key}_SECRET`',
  "crm.sync.failed",
]) {
  if (!source.includes(marker)) throw new Error(`Missing CRM marker: ${marker}`);
}

for (const marker of [
  "CREATE TABLE IF NOT EXISTS audit_logs",
  "idx_audit_logs_entity",
]) {
  if (!migration.includes(marker)) throw new Error(`Missing migration marker: ${marker}`);
}

for (const marker of [
  "BITRIX_PARTNERSHIP_FIELD_STATUS",
  "BITRIX_SUPPORT_FIELD_STATUS",
]) {
  if (!config.includes(marker)) throw new Error(`Missing config marker: ${marker}`);
}

console.log("CRM smoke check passed");
