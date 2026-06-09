# AI Food Websites

Production repository for the AI Food web stack.

## Projects

```text
.
├─ /                 Main public website for cremenality.ru
├─ cremenality-online/     Browser chat app for cremenality.online
└─ cloudflare-auth-worker/ Auth API Worker for api.cremenality.ru
```

## Architecture

```text
cremenality.ru
  Static website on Cloudflare Pages.
  Handles landing pages, account UI, admin UI and links to the chat app.

cremenality.online
  Static browser chat app on Cloudflare Pages.
  Requires an authenticated account, then shows RadminVPN connection details.

api.cremenality.ru
  Cloudflare Worker + D1.
  Handles registration, login, email verification, password reset, sessions,
  admin users and RadminVPN connection details.

26.192.1.120:8000
  Local AI Food backend on your PC through RadminVPN.
  Handles chat, image recognition, profile sync and meal planner.
```

## RadminVPN Mode

The browser chat offers only RadminVPN in the connection flow.

Current public connection values are configured in:

```text
cloudflare-auth-worker/wrangler.toml
```

```toml
CONNECTION_DEFAULT_PROVIDER = "radmin"
CONNECTION_RADMIN_IP = "26.192.1.120"
CONNECTION_RADMIN_LOGIN = "aifoodwebapp"
CONNECTION_RADMIN_CORE_API_URL = "http://26.192.1.120:8000"
```

The RadminVPN password must be stored as a Worker secret, not in git:

```powershell
cd cloudflare-auth-worker
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" secret put CONNECTION_RADMIN_PASSWORD
```

Important browser limitation: `cremenality.online` is HTTPS, while `http://26.192.1.120:8000` is HTTP. Some browsers may block this as mixed content. If that happens, keep RadminVPN for private network access, but put HTTPS in front of the backend.

## Local Backend Requirements

The local backend must be reachable from another RadminVPN device:

```text
host: 0.0.0.0
port: 8000
```

Windows Firewall must allow inbound TCP `8000` on the RadminVPN network.

Recommended local `backend/.env` values:

```text
SECRET_KEY=[same SECRET_KEY as Cloudflare Worker]
ALLOW_HOSTED_AUTH_TOKENS=true
ACCESS_COOKIE_NAME=__Secure-aifood_access
CORS_ALLOWED_ORIGINS=https://cremenality.ru,https://www.cremenality.ru,https://cremenality.online,https://www.cremenality.online
TRUSTED_HOSTS=localhost,127.0.0.1,26.192.1.120
```

## Checks

Main website:

```powershell
cd sitebyaidfood
cmd /c check.cmd
```

Browser chat:

```powershell
cd sitebyaidfood\cremenality-online
& "C:\Program Files\nodejs\node.exe" .\scripts\smoke-check.mjs
```

Auth Worker:

```powershell
cd sitebyaidfood\cloudflare-auth-worker
& "C:\Program Files\nodejs\node.exe" --check .\src\index.js
```

## Deploy

Main website:

```powershell
cd sitebyaidfood
& "C:\Program Files\nodejs\node.exe" ".\cloudflare-auth-worker\node_modules\wrangler\bin\wrangler.js" pages deploy . --project-name cremenality
```

Browser chat:

```powershell
cd sitebyaidfood\cremenality-online
& "C:\Program Files\nodejs\node.exe" "..\cloudflare-auth-worker\node_modules\wrangler\bin\wrangler.js" pages deploy . --project-name cremenality-online
```

Auth Worker:

```powershell
cd sitebyaidfood\cloudflare-auth-worker
& "C:\Program Files\nodejs\node.exe" ".\node_modules\wrangler\bin\wrangler.js" deploy
```
