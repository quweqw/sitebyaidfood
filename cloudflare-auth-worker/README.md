# AI Food Auth Worker

Cloudflare Worker for `api.cremenality.ru`.

It handles:

- registration;
- email verification;
- login/logout;
- HttpOnly cookie sessions;
- password reset;
- admin user management;
- RadminVPN connection details for `cremenality.online`.

## Runtime

```text
Cloudflare Worker
Cloudflare D1
Resend HTTP email API
```

## Important Files

```text
src/index.js       Worker source
wrangler.toml      Worker config and public env values
migrations/        D1 schema migrations
```

## Secrets

Do not put secrets into git.

Required Worker secrets:

```powershell
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" secret put SECRET_KEY
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" secret put RESEND_API_KEY
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" secret put CONNECTION_RADMIN_PASSWORD
```

`SECRET_KEY` must match the local backend `SECRET_KEY` so the local backend can accept hosted auth tokens.

## RadminVPN Public Values

Configured in `wrangler.toml`:

```toml
CONNECTION_DEFAULT_PROVIDER = "radmin"
CONNECTION_RADMIN_IP = "26.192.1.120"
CONNECTION_RADMIN_LOGIN = "aifoodwebapp"
CONNECTION_RADMIN_CORE_API_URL = "http://26.192.1.120:8000"
```

## Deploy

```powershell
cd cloudflare-auth-worker
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" deploy
```

## D1

Current D1 binding in `wrangler.toml`:

```toml
binding = "DB"
database_name = "aifood-auth"
```

Apply migrations:

```powershell
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" d1 migrations apply aifood-auth --remote
```

## API

Public:

```text
GET  /
POST /auth/register
POST /auth/verify-email
POST /auth/resend-verification-code
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /auth/password-reset/request
POST /auth/password-reset/confirm
POST /auth/change-password
```

Authenticated:

```text
GET /connection-info
```

Admin:

```text
GET    /admin/users
PATCH  /admin/users/:id/block
DELETE /admin/users/:id
```
