# AI Food Web App

Static browser app for `cremenality.online`.

## What It Does

- Uses `https://api.cremenality.ru` for account/session checks.
- Shows an authenticated RadminVPN connection screen before chat.
- Receives RadminVPN connection details from `https://api.cremenality.ru/connection-info`.
- Uses the selected local Core API URL for chat, recognition, profile and meal planner.
- Keeps auth cookies HttpOnly on `api.cremenality.ru`.
- Requests a short-lived bearer token from `/auth/refresh` only in memory when it needs to call the local backend.
- Stores chat history and profile settings locally per email.

## Deploy

Deploy this folder as a separate Cloudflare Pages project and attach:

```text
cremenality.online
www.cremenality.online
```

Build command:

```text
none
```

Output directory:

```text
/
```

## Local Backend Env

Your local `backend/.env` should include:

```text
SECRET_KEY=[the same SECRET_KEY as Cloudflare Worker]
ALLOW_HOSTED_AUTH_TOKENS=true
ACCESS_COOKIE_NAME=__Secure-aifood_access
CORS_ALLOWED_ORIGINS=https://cremenality.ru,https://www.cremenality.ru,https://cremenality.online,https://www.cremenality.online
TRUSTED_HOSTS=localhost,127.0.0.1,26.192.1.120
```

The backend must listen on the VPN interface, not only loopback:

```powershell
python run.py
```

`run.py` should start Uvicorn on `0.0.0.0:8000`. Also allow inbound TCP `8000` in Windows Firewall for the private VPN network.

## RadminVPN Connection Info Env

Put public/non-secret connection values into `cloudflare-auth-worker/wrangler.toml`:

```text
CONNECTION_DEFAULT_PROVIDER=radmin
CONNECTION_RADMIN_IP=26.192.1.120
CONNECTION_RADMIN_LOGIN=aifoodwebapp
CONNECTION_RADMIN_CORE_API_URL=http://26.192.1.120:8000
```

Put the Radmin password as a Worker secret, not into static files:

```powershell
& "C:\Program Files\nodejs\node.exe" "C:\Users\pacani\Documents\Programms\AI Food\cloudflare-auth-worker\node_modules\wrangler\bin\wrangler.js" secret put CONNECTION_RADMIN_PASSWORD
```

Direct `http://26.192.1.120:8000` RadminVPN URLs can be blocked from an HTTPS website by browser mixed-content rules. If that happens, keep RadminVPN for transport, but put HTTPS in front of the backend with a private DNS-only domain and a valid certificate.
