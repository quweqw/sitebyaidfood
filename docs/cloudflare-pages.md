# Cloudflare Pages

Project root:

```text
cremenality-site
```

Build settings:

- Framework preset: none
- Build command: empty
- Output directory: `/`

Domains:

- `cremenality.ru`
- `www.cremenality.ru`

Redirect `cremenality.online` to `https://cremenality.ru`.

Backend:

- `api.cremenality.ru` should serve the Cloudflare Worker auth/users/admin API over HTTPS.
- `llm.cremenality.ru` is optional and should point to the local PC backend only when the AI backend is available.
- CORS on `api.cremenality.ru` should allow only `https://cremenality.ru` and `https://www.cremenality.ru` in production.
- For personal usage, deploy a second Pages project/domain (`cremenality.online`) and connect it to the local backend through RadminVPN.
