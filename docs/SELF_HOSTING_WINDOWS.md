# Self-hosting on a Windows desktop

Same move as [SELF_HOSTING.md](SELF_HOSTING.md) (Raspberry Pi) — web app +
pipeline off Render/GitHub Actions, **Neon stays** for Postgres (no data
migration, backups/branching intact), reachable from outside via a
Cloudflare Tunnel. The difference is entirely in *how the pieces stay
running*: no systemd on Windows, so this uses NSSM (a Windows service
wrapper) for the always-on web app and Task Scheduler for the periodic
pipeline tick.

A "powerful desktop" removes the Raspberry Pi doc's actual constraint
(build-time RAM — measured at ~1.4GB peak for `next build` on this repo).
Windows brings a different one: **desktops sleep by default**, and a sleeping
machine stops answering the tunnel and stops running scheduled tasks. That's
the one setting that actually matters here — see step 1.

## What moves where

| Piece | Today | On the desktop |
|---|---|---|
| Postgres | Neon | Neon (unchanged) |
| Web app | Render (`next start`) | Desktop (`next start`, via **NSSM** service) |
| Scheduler | cron-job.org → GitHub Actions → `tick.ts` | Windows **Task Scheduler** → `tick.ts` directly, every 30 min |
| Public URL | Render's `*.onrender.com` | Cloudflare Tunnel → your own hostname |
| Secrets | GitHub Actions secrets + Render env | one `.env` on the desktop |

## 1. Stop it from sleeping

Do this first — it's the thing that actually breaks self-hosting on a
desktop, and it's easy to miss because the default is silent.

- **Settings → System → Power & battery → Screen and sleep** → set both
  "sleep" options to **Never** (at least while plugged in).
- **Settings → System → Power & battery → Additional power settings →
  Change plan settings → Change advanced power settings** → confirm
  "Sleep after" is Never under the active plan too (the quick-settings page
  doesn't always cover every sleep trigger).
- If this machine has a laptop-style lid or "modern standby," double-check
  Windows isn't quietly using Modern Standby instead of a real sleep-off
  state — `powercfg /a` from an elevated terminal lists which sleep states
  are actually available and active.

## 2. Prereqs

- **Node 22** — the official installer from [nodejs.org](https://nodejs.org)
  is simplest for a single machine; [nvm-windows](https://github.com/coreybutler/nvm-windows)
  if you want to switch versions later (note: this is a *different* tool
  from the Linux `nvm`, same idea).
- **Git for Windows**.
- Build **on** this machine, same reasoning as the Pi doc: `prisma generate`
  needs to fetch the Windows-native query engine binary, which only happens
  correctly running here.

## 3. Get the app running

From PowerShell:
```powershell
git clone <repo-url> C:\yahngorithm
cd C:\yahngorithm
npm ci
copy .env.example .env
notepad .env       # fill in DATABASE_URL, CFBD_API_KEY, ODDS_API_KEY,
                    # ADMIN_PASSWORD, ADMIN_SESSION_SECRET, CF_BEACON_TOKEN
npm run build       # prisma generate && next build
```

## 4. Run the web app persistently — NSSM

Task Scheduler *can* keep a long-running process alive, but a real Windows
service (auto-start at boot before any login, clean restart-on-crash,
built-in log files) is the better fit for something that needs to just stay
up. [NSSM](https://nssm.cc/download) is the standard, widely-used tool for
wrapping an arbitrary command as a Windows service.

```powershell
# unzip nssm, then from an elevated prompt:
nssm install yahngorithm-web

# In the GUI that opens:
#   Path:              C:\Program Files\nodejs\npm.cmd
#   Startup directory:  C:\yahngorithm
#   Arguments:          run start
# I/O tab -> set stdout/stderr log file paths if you want persistent logs.

nssm start yahngorithm-web
```

(`nssm install <name> <path> <args...>` also works non-interactively if you'd
rather script it than click through the GUI.)

Check it:
```powershell
Get-Service yahngorithm-web
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000
```

It'll now start automatically on boot, before any user logs in — set its
recovery behavior (Services.msc → yahngorithm-web → Recovery tab) to restart
on failure, same as `Restart=on-failure` did in the Pi's systemd unit.

## 5. Run the pipeline on a timer — Task Scheduler

This one's actually a natural fit for Task Scheduler — `tick.ts` is a
one-shot script that runs and exits, exactly the model Task Scheduler is
built for (unlike the always-on web server above).

A PowerShell script that registers it is in `deploy/windows/register-tick-task.ps1`:

```powershell
cd C:\yahngorithm
.\deploy\windows\register-tick-task.ps1     # run from an elevated prompt
```

This creates a task that runs `npm run tick` every 30 minutes, starting
immediately, catching up if the schedule was missed (`-StartWhenAvailable`).
Check it:
```powershell
Get-ScheduledTask -TaskName yahngorithm-tick | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName yahngorithm-tick    # trigger one manually to test
```
Task history / output: Task Scheduler GUI → the task → History tab, or Event
Viewer → Applications and Services Logs → Microsoft → Windows →
TaskScheduler. For output more like `journalctl -u yahngorithm-tick`, wrap
`npm run tick` in a small `.bat` that redirects to a log file and point the
scheduled task's action at that instead.

## 6. Reach it from outside — Cloudflare Tunnel

Same tool, Windows build:
```powershell
# download cloudflared-windows-amd64.exe from
# https://github.com/cloudflare/cloudflared/releases/latest
ren cloudflared-windows-amd64.exe cloudflared.exe

.\cloudflared.exe tunnel login             # opens a browser auth flow
.\cloudflared.exe tunnel create yahngorithm
.\cloudflared.exe tunnel route dns yahngorithm <your-subdomain>.<your-domain>
```

Config (`%USERPROFILE%\.cloudflared\config.yml`):
```yaml
tunnel: yahngorithm
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: <your-subdomain>.<your-domain>
    service: http://localhost:3000
  - service: http_status:404
```

Install as a Windows service (cloudflared handles this itself, same as on
Linux — no NSSM needed for this one):
```powershell
.\cloudflared.exe service install
```

`<your-domain>` needs to already be on Cloudflare's DNS — likely the same
zone the `CF_BEACON_TOKEN` site is already on.

## 7. Cut over

Same checklist as the Pi doc:
1. Confirm the desktop's board/game pages/`/admin` match what Render is
   serving, and a few `yahngorithm-tick` task runs have completed cleanly.
2. Don't run both schedulers against the same Neon database for long — they'd
   double the CFBD/Odds API call volume (picks themselves are idempotent, so
   no duplicates, just wasted budget). A short side-by-side check is fine.
3. Turn off the cron-job.org job, disable/delete `.github/workflows/tick.yml`.
4. Suspend or delete the Render service.
5. Point DNS at the Cloudflare Tunnel hostname.

## Honest tradeoffs vs. Render/GitHub Actions

- **Uptime**: better than a Pi in one specific way (a desktop you already
  keep around is presumably more reliably powered than improvised Pi
  wiring), but still nowhere near Render/GitHub's SLA — Windows Update
  forcing a reboot, someone unplugging it, the ISP dropping, all take the
  site down and silently skip ticks.
- **This machine now has a job.** If you reinstall Windows, upgrade
  hardware, or just want to use it for something that wants exclusive GPU/
  CPU access, the site and pipeline go with it unless you plan around that.
- **You own the ops** — Windows Update timing, Node version bumps, NSSM/
  Task Scheduler staying configured correctly, cloudflared staying
  authenticated. None of this was your problem on Render.
- **Upside**: same as the Pi — no shared Render hours, no GitHub Actions PAT
  to rotate, one `.env` instead of secrets in two dashboards, and "a powerful
  desktop you already own and rarely use" is genuinely more headroom than
  either Render's free-tier-adjacent plan or a Pi.

Reasonable for a personal tool. Less reasonable if you want this machine
free to actually repurpose on short notice, or if uptime matters to you.
