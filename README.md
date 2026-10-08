# Pulse - tool health

Live at **https://status.yourcardjourney.store** - one tile per hosted YourCardJourney
tool, green / amber / red, with a 24 h strip and the individual checks behind it.

- `tools.json` - the registry: every tool and its checks (site up, data freshness,
  build/watcher runs, Worker answering). Add a tool here; nothing else changes.
- `check.py _site` - runs the checks, carries 24 h history over from the live
  `status.json`, writes the page into `_site/`.
- `.github/workflows/check.yml` - hourly (cron-job.org "Pulse tick" dispatch; GitHub cron as fallback), publishes to GitHub Pages.

Secrets: `PULSE_GH_TOKEN` (reads Actions runs across NishanthBejgam, YourCardJourney,
WhichBike - without it the build checks show "unknown"); optional `PULSE_TG_TOKEN` +
`PULSE_TG_CHAT` for a Telegram message when a tool changes colour.

Never point a check at a session Worker's `/state`: that route can start a paid sweep.
