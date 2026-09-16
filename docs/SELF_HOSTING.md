# Self-hosting on a Raspberry Pi

(Hosting from a Windows machine instead? See [SELF_HOSTING_WINDOWS.md](SELF_HOSTING_WINDOWS.md).)

Moving the web app + pipeline off Render/GitHub Actions onto a Pi at home,
**keeping Neon** for Postgres (no data migration, backups/branching stay).
Reachable from outside the house via a Cloudflare Tunnel (no port-forwarding,
no dynamic DNS, free TLS).

Nothing about the app code changes — this is purely where the compute runs.
CFBD / Odds / Kalshi / ESPN / Open-Meteo calls are all outbound and don't
care where they originate.

## What moves where

| Piece | Today | On the Pi |
|---|---|---|
| Postgres | Neon | Neon (unchanged) |
| Web app | Render (`next start`) | Pi (`next start`, via systemd) |
| Scheduler | cron-job.org → GitHub Actions `workflow_dispatch` → `tick.ts` | Pi's own `systemd` timer → `tick.ts` directly |
| Public URL | Render's `*.onrender.com` (or a custom domain) | Cloudflare Tunnel → your own hostname |
| Secrets | GitHub Actions secrets + Render env (two places) | one `.env` on the Pi |

## 1. Prereqs on the Pi

- **64-bit** Raspberry Pi OS (Bookworm or newer) — a 32-bit OS won't run
  modern Node cleanly. `uname -m` should say `aarch64`.
- **Node 22** (matches what the GitHub Actions pipeline currently pins —
  `.github/workflows/_run.yml`). Install via [nvm](https://github.com/nvm-sh/nvm)
  rather than the OS package manager, so it's easy to bump later:
  ```
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  nvm install 22
  ```
- `git`.
- A **Pi 4 or 5 with 4GB+ RAM** is the safe bar. `next build` is memory-hungry
  (Next.js 16); a 2GB Pi will likely need swap bumped before it'll build
  without OOM-killing itself:
  ```
  sudo dphys-swapfile swapoff
  sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
  sudo dphys-swapfile setup && sudo dphys-swapfile swapon
  ```
  Build **on** the Pi itself, not cross-compiled elsewhere and copied over —
  `prisma generate` needs to fetch the ARM64 query-engine binary for this
  exact platform, which only happens correctly if it runs there.
- **SD card wear**: Postgres itself stays on Neon, so the Pi isn't doing
  heavy database I/O — the SD card risk here is much lower than a "Postgres
  on a Pi" setup would be. Still, a good-quality card (or booting from a USB
  SSD if the Pi model supports it) is cheap insurance.

## 2. Get the app running

```
git clone <repo-url> ~/the-yahngorithm
cd ~/the-yahngorithm
npm ci
cp .env.example .env
```

Fill in `.env` — everything the pipeline needs plus the web-app-only vars
(`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CF_BEACON_TOKEN` if you want
analytics on the new hostname). Use the **direct** (non-pooled) `DATABASE_URL`
from Neon, same as local dev today.

```
npm run build     # prisma generate && next build
```

## 3. Run it persistently — systemd

Two unit files are in `deploy/systemd/` — copy them over (adjust
`WorkingDirectory` and the `npm`/`node` paths to match `which npm` /
`which node` under whichever Node install you used, since nvm installs
outside `/usr/bin`):

```
sudo cp deploy/systemd/yahngorithm-web.service /etc/systemd/system/
sudo cp deploy/systemd/yahngorithm-tick.service /etc/systemd/system/
sudo cp deploy/systemd/yahngorithm-tick.timer /etc/systemd/system/
sudo systemctl daemon-reload

sudo systemctl enable --now yahngorithm-web.service
sudo systemctl enable --now yahngorithm-tick.timer
```

Check it's alive:
```
systemctl status yahngorithm-web.service
journalctl -u yahngorithm-web.service -f       # tail the app log
journalctl -u yahngorithm-tick.service -f       # tail pipeline runs
systemctl list-timers yahngorithm-tick.timer    # confirm the 30-min schedule
curl -s localhost:3000 -o /dev/null -w '%{http_code}\n'
```

`yahngorithm-tick.timer` replaces cron-job.org + the GitHub Actions
`tick.yml` workflow entirely — `tick.ts`'s own scheduling logic (which
groups are due, the Tuesday/Wednesday quiet window, Saturday's tighter
cadence) is unchanged, it's just invoked locally now instead of over HTTP.

## 4. Reach it from outside — Cloudflare Tunnel

```
curl -L --output cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
sudo mv cloudflared /usr/local/bin/ && sudo chmod +x /usr/local/bin/cloudflared

cloudflared tunnel login                     # opens a browser auth flow
cloudflared tunnel create yahngorithm
cloudflared tunnel route dns yahngorithm <your-subdomain>.<your-domain>
```

Point it at the app (`~/.cloudflared/config.yml`):
```yaml
tunnel: yahngorithm
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: <your-subdomain>.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
```

Install it as its own persistent service (cloudflared manages its own
systemd unit — no custom one needed here):
```
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

`<your-domain>` needs to already be on Cloudflare's DNS — if the domain
Cloudflare Web Analytics is currently pointed at (the `CF_BEACON_TOKEN` site)
is the same one, this is just adding a tunnel route on top of a zone that
already exists.

## 5. Cut over

Don't run both pipelines against the same Neon database at once for long —
they'd double the CFBD/Odds API call volume (pick-generation itself is
idempotent, so you wouldn't get duplicate picks, just wasted budget). A
short overlap to compare output is fine; then:

1. Confirm the Pi's board/game pages/`/admin` match what Render is serving.
2. Confirm a few `yahngorithm-tick.service` runs have completed cleanly
   (`journalctl`), same as checking an Actions run today.
3. Disable the old scheduler: turn off the cron-job.org job (or just stop
   pointing it at the repo), and disable/delete `.github/workflows/tick.yml`
   (or leave it — with cron-job.org stopped, it just never fires on its own).
4. Suspend or delete the Render service.
5. Point whatever DNS `the-yahngorithm.*` currently resolves to at the
   Cloudflare Tunnel hostname instead (or just start using the new hostname).

## Honest tradeoffs vs. Render/GitHub Actions

- **Uptime**: a home Pi + home internet has nowhere near Render/GitHub's SLA.
  Power blip, router reboot, ISP outage, Pi hangs — the site's down and ticks
  are silently missed (`Persistent=true` on the timer catches up a missed
  tick once the Pi's back, but not the gap while it was off).
- **No cloud redundancy** — if the SD card dies, the *app* is gone (Neon
  still has the data; you'd just need to re-clone + rebuild on new hardware).
- **You own the ops** — OS updates, Node version bumps, disk space, cloudflared
  staying authenticated. None of this was your problem on Render.
- **Upside**: no Render hours to share with Cavepicks, no GitHub Actions PAT
  to rotate yearly, one `.env` instead of secrets split across two dashboards,
  and the scheduler goes from a 3-hop chain (cron-job.org → GitHub API →
  Actions runner) to "a timer on the same box."

Reasonable for a personal tool nobody else depends on being up. Less
reasonable if uptime actually matters to you.
