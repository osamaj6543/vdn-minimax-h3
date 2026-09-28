# VDN Studio — frontend

Next.js (App Router) + Tailwind v4 + ShadCN UI, on top of Appwrite Auth and
the VDN gateway (`../server`). TypeScript throughout.

## Setup

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in your Appwrite project + gateway URL
npm run dev                        # http://localhost:3000
```

Required server-side keys (no `NEXT_PUBLIC_` prefix: they live only on the
Next.js server and never reach the client bundle):

| Key | Meaning |
|---|---|
| `APPWRITE_ENDPOINT` | e.g. `https://cloud.appwrite.io/v1` or your self-hosted host |
| `APPWRITE_PROJECT` | Appwrite project ID |
| `APPWRITE_API_KEY` | **Server** API key — scopes `sessions.write` (login) and `users.write` (gateway JWT minting). Appwrite only returns a session's `secret` to API-key-authenticated calls, so server-side sign-in is impossible without it |
| `SESSION_SECRET` | 32+ chars; seals the session cookie (AES-256-GCM). `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `GATEWAY_URL` | VDN gateway (`../server`), e.g. `http://localhost:8000` — called by the server only |

Optional legacy fallbacks (`NEXT_PUBLIC_APPWRITE_*`, `NEXT_PUBLIC_API_BASE_URL`)
are still honoured when the names above are absent, so an existing `.env` keeps
working during migration. They are not required and nothing in the browser reads
them.

In the Appwrite Console, add your frontend origin (e.g. `http://localhost:3000`)
under Platforms → Web App.

## Auth architecture (server-side)

The browser never holds a credential, mints a token, or reaches the gateway:

```
browser ──POST /api/auth/login──▶ Next route handler ──▶ Appwrite (API key)
   ▲                                     │
   │  Set-Cookie: vdn_session (httpOnly, AES-256-GCM sealed)  ──┘
   │
   └──/api/gateway/*──▶ proxy route ──mints Appwrite JWT server-side──▶ VDN gateway
```

- **`src/lib/server/session-token.ts`** — seals/opens the session with Web Crypto
  (AES-256-GCM + HKDF-SHA256), so the same code runs in the Edge proxy and the
  Node route handlers with no dependency. The token carries the Appwrite session
  *secret*, which is why the cookie is httpOnly **and** encrypted: a leaked cookie
  value alone is not a usable Appwrite credential.
- **`src/lib/server/appwrite.ts`** — the DAL: credential exchange, profile reads
  on a session-scoped client, session revocation, and `Users.createJWT` for the
  gateway token (cached 10 min, 15-min tokens, invalidated on sign-out). Route
  handlers receive DTOs, never raw Appwrite models.
- **`src/proxy.ts`** — Next 16's Proxy (the renamed Middleware): an optimistic
  cookie-only gate on `/dashboard`, `/jobs`, `/settings` that redirects to
  `/login?next=…`. Real authorization stays in the route handlers.
- **`/api/gateway/*`** — the only path to the gateway. It attaches
  `Authorization: Bearer <jwt>` server-side, forwards only an allow-list of
  headers, buffers request bodies (uploads) and streams responses (mp4 artifacts).

`?next=` is narrowed to a known protected route (`toProtectedRoute` in
`src/lib/nav.ts`), so it can never become an open redirect.


## What it does

- **Auth (server-side)**: email/password register + login, exchanged by the
  Next.js server with an Appwrite API key. The Appwrite session lives in an
  httpOnly, AES-256-GCM-sealed cookie; the gateway JWT is minted server-side and
  never reaches the browser. Plan tier still comes from the user's Appwrite
  labels — the gateway enforces the same tiers/quotas server-side.
- **Studio (`/dashboard`)**: all five modes (t2v / i2v / l2v / fl2v / ref2v) as
  conditioning cards, a prompt composer, drag-and-drop image attachments, and a
  sticky spec rail that previews the request and estimates denoising time.
- **Library (`/jobs`)**: grid or list view, status/task filters, prompt search,
  hover-preview thumbnails, live NFE progress and elapsed timers while renders
  run. Polls at 5 s only while something is live, otherwise a 25 s heartbeat.
- **Render detail (`/jobs/[id]`)**: artifact player, live progress, per-NFE
  timing bars, wall-clock metrics, the exact request, cancel and copy actions.
- **Settings**: account, plan/tier, and a connection panel that can probe the
  gateway's `/healthz` on demand.

Timings and estimates always come from real data: the worker's per-NFE samples
on each job. Until a workspace has measured renders, the studio shows the
published VDN-H3 reference (6.9 s denoise / 8 steps on 8×B200) and labels it as
such — see `src/lib/estimate.ts`.

## Design system (UI)

Dark, ink-and-champagne, built from the supplied VDN logo:

- **Tokens** live in `src/app/globals.css` (`@theme inline` + `.dark`). Surfaces
  are near-black (`--surface`), the accent is the logo's gold (`--gold`), and
  status colours (`--live`, `--success`, `--warning`, `--info`) carry job state.
  Component classes: `.panel`, `.well`, `.glass`, `.grid-lines`, `.gold-text`,
  `.gold-surface`, `.status-dot`, `.track`, `.num`, plus motion helpers
  (`.animate-rise`, `.animate-drift`, `.animate-sweep`, `.animate-drawer`).
- **Brand**: `src/components/brand.tsx` traces the real logo paths from
  `assets/Logo/source/vdn-logo.html`, so the mark stays pixel-accurate and
  inherits `currentColor` with the champagne play triangle.
- **Fonts**: self-hosted variable Latin subsets (Inter, Jost, JetBrains Mono) in
  `src/app/fonts/`, wired through `src/lib/fonts.ts` with `next/font/local` — no
  Google Fonts request at build or runtime. Jost is the wordmark typeface, so
  `font-display` matches the logo lockup.
- **Accessibility**: focus rings on every control, `aria-pressed`/`aria-current`
  on toggles and nav, labelled icon-only buttons, and a
  `prefers-reduced-motion` block that disables animation.

## Layout

```
src/proxy.ts           Next 16 Proxy (Middleware): cookie-only route gate
src/app/api/auth/*     login · register · logout · session (server-side exchange)
src/app/api/gateway/*  the only browser→gateway path; attaches the JWT
src/app/api/health     relays the gateway's /healthz for the status pill
src/lib/server/config.ts        server env + auth readiness reporting
src/lib/server/session.ts       httpOnly cookie read/write/clear
src/lib/server/session-token.ts AES-256-GCM sealing (Edge + Node, no deps)
src/lib/server/appwrite.ts      DAL: login, profile, revoke, JWT cache, DTOs
src/lib/auth-client.ts          browser wrappers over /api/auth/*
src/lib/api.ts         gateway client — same-origin, no credentials in the browser
src/lib/types.ts       JobView / Task / frame math, mirroring server/schemas.py
src/lib/format.ts      pure formatters: relative time, clock, NFE progress, tints
src/lib/estimate.ts    denoise-time estimate from real per-NFE history
src/lib/nav.ts         shell navigation + the protected-route list
src/lib/fonts.ts       self-hosted font wiring
src/components/session-provider.tsx   session context (server-sourced identity)
src/components/app-shell.tsx          sidebar + topbar shell, gateway status, guard
src/components/auth-layout.tsx        split brand/credential auth screen
src/components/login-form.tsx         sign-in form (client)
src/components/register-form.tsx      sign-up form (client)
src/components/server-config-notice.tsx  shows missing server auth env vars
src/components/brand.tsx              logo mark + lockup
src/components/splash.tsx             branded loading state
src/components/create-video-form.tsx  the studio form + spec rail
src/components/job-bits.tsx           status pill, NFE progress, player, thumbnail
src/components/job-elapsed.tsx        ticking elapsed time for live renders
src/components/recent-renders.tsx     latest renders strip on the dashboard
src/app/(app)/…        guarded pages: dashboard, jobs, jobs/[id], settings
```


## Verification

```bash
npm run build   # production build; must pass typecheck
```
