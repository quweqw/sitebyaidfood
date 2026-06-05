# Security notes

The website is a static Cloudflare Pages frontend. It cannot be the source of truth for permissions.

## Required backend protections

Admin actions must be protected by the backend:

- verify JWT signature and expiration;
- reject unverified users;
- reject blocked users;
- require `role = admin` or equivalent server-side claim;
- never trust a role stored in browser localStorage;
- return `403` for non-admin users;
- rate-limit auth, verification, chat and admin endpoints;
- audit-log admin actions.

## Admin API contract

The frontend expects:

```text
GET    /admin/users
PATCH  /admin/users/{user_id}/block
DELETE /admin/users/{user_id}
```

`PATCH /admin/users/{user_id}/block` body:

```json
{ "blocked": true }
```

Recommended user shape:

```json
{
  "id": "123",
  "email": "user@example.com",
  "role": "user",
  "is_blocked": false,
  "is_email_verified": true,
  "created_at": "2026-06-06T00:00:00Z"
}
```

## Frontend hardening already included

- No third-party script CDN.
- Cloudflare Pages CSP in `_headers`.
- `X-Frame-Options: DENY`.
- `X-Content-Type-Options: nosniff`.
- Strict referrer policy.
- Permissions Policy disables camera, microphone, geolocation, payment and USB.
- Admin link is hidden unless token user claims look like admin.
- Admin endpoints are still called only with Bearer token.
- Delete action requires confirmation.
- Current admin account delete button is disabled in UI.

## Remaining production recommendations

- Prefer HttpOnly Secure SameSite cookies for web auth in a later backend iteration.
- Keep access tokens short-lived.
- Store refresh tokens hashed server-side.
- Add CSRF protection if cookie auth is introduced.
- Add account lock/rate limits for brute-force protection.
- Add backend-side self-delete prevention for admin accounts.
- Add backups before enabling permanent user deletion.
