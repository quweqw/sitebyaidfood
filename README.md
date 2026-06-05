# AI Food by Cremenality

Clean standalone production website repository.

This repository is separate from the original AI-Food app/backend repository and contains only the website:

- dark welcome page with application features;
- account registration, email verification and login;
- protected LLM chat;
- Android download section;
- admin panel for blocking/unblocking and deleting accounts;
- Cloudflare Pages headers, redirects and CSP.

## Run checks

On Windows:

```bat
check.cmd
```

Local preview:

```bat
serve.cmd
```

Open:

```text
http://127.0.0.1:5178
```

## Production config

Edit `config.js`:

```js
window.CREMENALITY_CONFIG = {
  apiBaseUrl: "https://api.cremenality.ru",
  androidDownloadUrl: "...",
  githubUrl: "...",
  chatPreset: "..."
};
```

## Backend contracts

See:

- `docs/security.md`
- `docs/cloudflare-pages.md`
"# sitebyaidfood" 
