# AI Food Websites

Production repository for the AI Food web stack.

## Projects

```text
.
├─ /                       cremenality.ru public website
├─ cremenality-online/     cremenality.online browser application
└─ cloudflare-auth-worker/ api.cremenality.ru backend
```

## Production Architecture

```text
cremenality.ru and Android
            |
            v
api.cremenality.ru
Cloudflare Worker
  |- authentication and sessions
  |- deterministic calorie calculation
  |- profile and meal-plan API
  |- OpenAI text chat and image analysis
  |- CRM and support API
            |
      +-----+------+
      |            |
      v            v
Cloudflare D1   OpenAI Responses API
```

The production site and Android app do not require a local PC, VPN, tunnel, Ollama or FastAPI process. The OpenAI API key is stored only as a Cloudflare Worker secret and is never sent to a browser or mobile device.

The legacy `backend/` directory outside this repository can still be used for local experiments, but it is not part of the production request path.

## Required Worker Secrets

```powershell
cd cloudflare-auth-worker
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put SECRET_KEY
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put RESEND_API_KEY
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put OPENAI_API_KEY
```

Optional CRM secret:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put BITRIX_WEBHOOK_URL
```

Full Bitrix24 setup: [docs/bitrix24.md](docs/bitrix24.md).

Never put these values into `wrangler.toml`, frontend files, screenshots or git.

## Checks

```powershell
cd sitebyaidfood
cmd /c check.cmd

cd cremenality-online
& "C:\Program Files\nodejs\node.exe" .\scripts\smoke-check.mjs

cd ..\cloudflare-auth-worker
& "C:\Program Files\nodejs\npm.cmd" run check
```

## Deploy

Apply D1 migrations before deploying the Worker:

```powershell
cd cloudflare-auth-worker
& "C:\Program Files\nodejs\npx.cmd" wrangler d1 migrations apply aifood-auth --remote
& "C:\Program Files\nodejs\npx.cmd" wrangler deploy
```

Main website:

```powershell
cd sitebyaidfood
& "C:\Program Files\nodejs\npx.cmd" wrangler pages deploy . --project-name cremenality
```

Browser application:

```powershell
cd sitebyaidfood\cremenality-online
& "C:\Program Files\nodejs\npx.cmd" wrangler pages deploy . --project-name cremenality-online
```
