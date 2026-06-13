# AI Food Browser App

Static browser application for `cremenality.online`.

## Runtime

- account and session: `https://api.cremenality.ru`;
- text chat: OpenAI through the Cloudflare Worker;
- food photo analysis: OpenAI vision through the Worker;
- calorie calculation: deterministic Worker code;
- profile and meal plans: Cloudflare D1;
- local chat history: browser storage scoped by account email.

The app does not connect to a local PC and does not need RadminVPN, Tailscale or Cloudflare Tunnel.

## Deploy

Deploy this directory as the `cremenality-online` Cloudflare Pages project:

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler pages deploy . --project-name cremenality-online
```

Attach:

```text
cremenality.online
www.cremenality.online
```

No build command is required.
