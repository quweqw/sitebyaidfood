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

- `api.cremenality.ru` must serve FastAPI over HTTPS.
- CORS should allow only `https://cremenality.ru`, `https://www.cremenality.ru`, and localhost for development.
