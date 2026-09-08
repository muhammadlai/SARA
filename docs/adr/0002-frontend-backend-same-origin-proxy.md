# ADR 0002 — Browser talks to the API same-origin via a server-side proxy

- **Status:** Accepted (Phase 1)
- **Context:** The dashboard (apps/web) and API (apps/api) run on different
  ports/origins. Pointing the browser at a configurable absolute API URL
  breaks behind preview proxies and creates CORS coupling.
- **Decision:** Browser code only ever uses **relative** `/api/*` URLs.
  Next.js rewrites proxy `/api/:path*` to `API_INTERNAL_URL` (default
  `http://127.0.0.1:4000`) on the server side. CORS stays closed by default
  and only opens for explicitly configured origins.
- **Consequences:** One origin to secure, zero browser-side API configuration,
  preview-proxy friendly. Direct browser→API channels (e.g. WebSockets later)
  will go through the same proxy or an explicitly configured public origin.
