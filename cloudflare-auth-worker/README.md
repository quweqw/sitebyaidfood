# AI Food Cloud Backend

Cloudflare Worker for `api.cremenality.ru`.

## Responsibilities

- registration, email verification, login and password reset;
- HttpOnly browser sessions and bearer tokens for Android;
- user profile and deterministic calorie calculation;
- OpenAI text chat and food image analysis;
- OpenAI-assisted meal-plan generation with D1 persistence;
- admin users, support, partnership requests and CRM delivery.

## Runtime

```text
Cloudflare Worker
Cloudflare D1
OpenAI Responses API
Resend HTTP email API
```

## Secrets

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put SECRET_KEY
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put RESEND_API_KEY
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put OPENAI_API_KEY
```

Optional:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put BITRIX_WEBHOOK_URL
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put TURNSTILE_SECRET_KEY
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put TELEGRAM_BOT_TOKEN
```

Do not put secret values into `wrangler.toml` or git. The OpenAI key visible in any screenshot or message must be revoked before deployment.

## Database

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler d1 migrations apply aifood-auth --remote
```

Migration `0003_cloud_ai_core.sql` adds persisted meal plans.
Migration `0004_crm_production.sql` adds the CRM audit log.

Bitrix24 entity IDs and field mappings are configured through the `BITRIX_*` variables in `wrangler.toml`. See `../docs/bitrix24.md`.

## Deploy

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler deploy
```

## Core API

```text
POST  /chat/message
POST  /api/ai/chat

GET   /profile
PUT   /profile
PATCH /profile
POST  /profile/calculate-calories

POST  /recognition/image

POST  /meal-planner/intent/parse
POST  /meal-planner/generate
POST  /meal-planner/dinner-suggestion
GET   /meal-planner/latest
GET   /meal-planner/:plan_id
PATCH /meal-planner/:plan_id/meals/:meal_id/progress
POST  /meal-planner/:plan_id/meals/:meal_id/replace
POST  /meal-planner/:plan_id/meals/:meal_id/regenerate
```

All Core API routes require an authenticated and verified user.

## OpenAI Configuration

Public model and limit settings are in `wrangler.toml`:

```toml
OPENAI_MODEL = "gpt-5.4-mini"
OPENAI_VISION_MODEL = "gpt-5.4-mini"
OPENAI_PLANNER_MODEL = "gpt-5.4-mini"
```

Requests use `store: false`. Structured outputs are used for image recognition and meal-plan data. Calorie targets are calculated in Worker code rather than delegated to the model.
