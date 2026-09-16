# Deploying to Vercel

Moving the web app from Render to Vercel. **Neon stays** as the database — no
migration, no code changes. The pipeline (`tick.ts` etc.) stays exactly where
it is, on GitHub Actions — it's already fully decoupled from wherever the web
app lives (confirmed: nothing in `.github/workflows/` references Render).

This is mostly dashboard clicks, not terminal commands — steps below assume
[vercel.com](https://vercel.com).

## 1. Import the repo

1. Sign in to Vercel with your GitHub account (or link it if signing in
   another way) — this is what lets Vercel auto-deploy on every push to
   `main`, same as Render does today.
2. **Add New → Project**, select this repo. Vercel auto-detects Next.js —
   framework preset, build command, output directory all get filled in
   correctly by default. The one override needed: `vercel.json` (already in
   the repo) makes the build command run `prisma migrate deploy` first, so
   schema changes ship automatically the same way they did on Render.

## 2. Environment variables

Add these under **Project Settings → Environment Variables**, scoped to
**Production** (this project has no branch/PR workflow, so Preview/
Development scoping isn't worth the extra complexity right now):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Same Neon **direct** connection string as `.env` locally |
| `CFBD_API_KEY` | Needed for the `/admin` "Run" buttons in prod |
| `ODDS_API_KEY` | Same |
| `ADMIN_PASSWORD` | Real value, or leave unset to keep the "2142" default — your call, but worth revisiting now that the site's reachable at a real, findable domain rather than an obscure `*.onrender.com` URL |
| `ADMIN_SESSION_SECRET` | `openssl rand -hex 32` — set this **regardless** of the password choice: without it, the admin session cookie is a fixed, computable hash of just the (possibly-default) password, so anyone who knows/guesses the password can forge a valid cookie directly without even going through the rate-limited login form. This one variable is what actually closes that gap. |
| `NEON_API_KEY` | Optional — powers the `/admin` Neon usage panel |
| `CF_BEACON_TOKEN` | Optional — Cloudflare Web Analytics, only if you want it on the new domain |

Skip `NODE_VERSION` — set it instead under **Settings → General → Node.js
Version**, pick 22.x to match what GitHub Actions already uses.

## 3. Deploy + verify

Trigger the first deploy (push to `main`, or click Deploy in the dashboard).
Once it's live on the `*.vercel.app` URL Vercel gives you:
- Check `/`, a game page, `/picks`, `/grades`, `/admin` all render correctly
  and match what Render is currently serving.
- Confirm a Prisma migration ran cleanly in the build log (or that it no-op'd
  if there was nothing pending).
- Pin a game / log into `/admin` to confirm cookies and server actions work
  (they're both just standard Next.js features, but worth actually clicking
  through once rather than assuming).

## 4. Custom domain

**Project Settings → Domains** → add the domain you buy. Vercel gives you
the exact DNS records to add at your registrar (usually an `A` record or
`CNAME` depending on whether it's the apex domain or a subdomain) — TLS is
automatic once DNS propagates, no separate certificate step.

## 5. Cut over

1. Once the custom domain is live and verified, that's the point of no
   return for visitors — anyone with the link starts hitting Vercel.
2. Suspend or delete the Render service (**Render dashboard → the service →
   Settings → Delete**, or just leave it stopped for a bit as a fallback
   before deleting).
3. No pipeline changes needed — GitHub Actions keeps running `tick.ts`
   exactly as before, writing to the same Neon database either app reads
   from.

## What's different day-to-day vs. Render

- **No more cold-start wait** — Render's free tier slept after 15 min idle
  with a ~50s wake-up; Vercel's serverless functions have a far shorter cold
  start (typically 1-2s), and won't be competing with Cavepicks for a shared
  750-hour/month cap anymore either.
- **`/admin`'s "Run" buttons** still work the same way — they call the
  pipeline scripts directly from the running app process, same as on Render,
  just needs `CFBD_API_KEY`/`ODDS_API_KEY` present in the Vercel env (added
  above).
- **Preview deploys**: pushing a branch (not `main`) will now also trigger a
  Vercel preview build. Since `DATABASE_URL` is scoped to Production only
  above, a preview build's `prisma migrate deploy` step will fail without
  it — fine for a solo main-only workflow; revisit if that changes.
