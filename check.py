"""Pulse - health check for every hosted YourCardJourney tool.

    python check.py _site            # run every check, write _site/status.json + page

Each tool in tools.json has a list of checks; a check comes back ok / warn / down
(or unknown when it could not be judged, e.g. no GitHub token). A tool takes the
worst of its checks. History rides along in the published status.json: the run
reads the live file first, appends this run, keeps 24 h - so no commits, no state
store, and a failed deploy only costs one point on the strip.

Env:
  PULSE_GH_TOKEN   token that can read Actions runs in all three owners
                   (NishanthBejgam, YourCardJourney, WhichBike). Without it the
                   workflow checks report "unknown" instead of guessing.
  PULSE_LIVE_URL   where the previous status.json lives (history seed)
  PULSE_TG_TOKEN / PULSE_TG_CHAT
                   optional: Telegram message when any tool changes colour.
"""
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 YCJ-Pulse/1"
LIVE_URL = os.environ.get("PULSE_LIVE_URL", "https://status.yourcardjourney.store/status.json")
GH_TOKEN = (os.environ.get("PULSE_GH_TOKEN") or "").strip()
IST = timezone(timedelta(hours=5, minutes=30))
HISTORY_HOURS = 24
SLOW_SECONDS = 8
RANK = {"ok": 0, "unknown": 1, "warn": 2, "down": 3}

_cache = {}


def fetch(url, headers=None, timeout=25):
    """(status, body bytes, seconds). Network failure = status 0. Cached per run,
    so three checks on one JSON file cost one request."""
    key = (url, tuple(sorted((headers or {}).items())))
    if key in _cache:
        return _cache[key]
    h = {"User-Agent": UA, "Accept": "*/*", "Cache-Control": "no-cache"}
    h.update(headers or {})
    t0 = time.time()
    out = None
    for attempt in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                out = (r.status, r.read(), time.time() - t0)
            break
        except urllib.error.HTTPError as e:
            out = (e.code, e.read() if e.fp else b"", time.time() - t0)
            if e.code < 500:
                break
        except Exception:
            out = (0, b"", time.time() - t0)
        time.sleep(3)
    _cache[key] = out
    return out


def fetch_json(url):
    status, body, _ = fetch(url)
    if status != 200:
        raise ValueError(f"HTTP {status}" if status else "unreachable")
    try:
        return json.loads(body.decode("utf-8-sig"))
    except Exception:
        raise ValueError("not valid JSON")


def parse_time(v):
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, timezone.utc)
    s = str(v).strip().replace("Z", "+00:00")
    s = re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", s)  # +0000 -> +00:00
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def ago(minutes):
    m = int(round(minutes))
    if m < 1:
        return "just now"
    if m < 60:
        return f"{m} min ago"
    h = m / 60
    if h < 48:
        return f"{h:.1f} h ago".replace(".0 h", " h")
    return f"{h / 24:.1f} days ago".replace(".0 days", " days")


def span(minutes):
    return ago(minutes).replace(" ago", "")


def dig(d, path):
    for part in path.split("."):
        d = d[part] if isinstance(d, dict) else None
    return d


def res(status, detail):
    return {"status": status, "detail": detail}


# ---------------------------------------------------------------- checks

def check_http(c, now):
    status, body, secs = fetch(c["url"])
    if not status:
        return res("down", "Not reachable")
    if status >= 400:
        return res("down", f"Answering HTTP {status}")
    if secs > SLOW_SECONDS:
        return res("warn", f"Up but slow ({secs:.1f} s)")
    return res("ok", f"Up · {int(secs * 1000)} ms")


def check_worker(c, now):
    # A live Worker answers '/' with its own 404. Cloudflare's own failures
    # (script threw, over limit, deleted) come back 5xx or as the 1xxx page.
    status, body, secs = fetch(c["url"])
    text = body[:4000].decode("utf-8", "ignore")
    if not status:
        return res("down", "Not reachable")
    if status >= 500 or "error code: 1" in text or "cf-error" in text:
        return res("down", f"Worker erroring (HTTP {status})")
    return res("ok", f"Answering · {int(secs * 1000)} ms")


def check_age(c, now):
    try:
        d = fetch_json(c["url"])
        when = parse_time(dig(d, c["field"]))
    except Exception as e:
        return res("down", f"Data file {e}" if isinstance(e, ValueError) else "Data file unreadable")
    mins = (now - when).total_seconds() / 60
    if mins <= c["ok"]:
        return res("ok", f"Updated {ago(mins)}")
    if mins <= c["warn"]:
        return res("warn", f"Updated {ago(mins)} - expected within {span(c['ok'])}")
    return res("down", f"Stale - last update {ago(mins)}")


def check_json(c, now):
    try:
        v = dig(fetch_json(c["url"]), c["field"])
    except Exception as e:
        return res("down", f"Data file {e}" if isinstance(e, ValueError) else "Data file unreadable")
    bad = c.get("severity", "down")
    if "oneOf" in c:
        if v in c["oneOf"]:
            return res("ok", f"Reads '{v}'")
        return res(bad, f"Unexpected value '{v}'")
    if "contains" in c:
        if isinstance(v, list) and c["contains"] in v:
            return res("ok", " + ".join(str(x).title() for x in v))
        return res(bad, f"Missing {str(c['contains']).title()} - only {', '.join(map(str, v or [])) or 'nothing'}")
    return res("ok", "Present") if v is not None else res(bad, "Missing")


def check_count(c, now):
    try:
        v = dig(fetch_json(c["url"]), c["field"])
    except Exception as e:
        return res("down", f"Data file {e}" if isinstance(e, ValueError) else "Data file unreadable")
    n = len(v) if isinstance(v, (list, dict)) else 0
    if n >= c["min"]:
        return res("ok", f"{n} listed")
    return res(c.get("severity", "down") if n else "down", f"Only {n} listed (normally {c['min']}+)")


def check_merchants(c, now):
    try:
        ms = fetch_json(c["url"])["merchants"]
    except Exception:
        return res("down", "Rates file unreadable")
    cut = c["staleHours"] * 60
    out = []
    for m in ms:
        r = m.get("rate") or {}
        try:
            mins = (now - parse_time(r["fetched"])).total_seconds() / 60
        except Exception:
            mins = None
        if mins is None or mins > cut:
            out.append(m.get("short") or m.get("name") or m.get("id"))
    live = len(ms) - len(out)
    if len(out) >= c["downAt"]:
        return res("down", f"{live}/{len(ms)} reading · down: {', '.join(out)}")
    if len(out) >= c["warnAt"]:
        return res("warn", f"{live}/{len(ms)} reading · no read in {c['staleHours']} h: {', '.join(out)}")
    return res("ok", f"All {len(ms)} reading")


def check_workflow(c, now):
    if not GH_TOKEN:
        return res("unknown", "No GitHub token - can't read runs")
    url = f"https://api.github.com/repos/{c['repo']}/actions/workflows/{c['file']}/runs?per_page=15"
    status, body, _ = fetch(url, {"Authorization": f"Bearer {GH_TOKEN}",
                                  "Accept": "application/vnd.github+json",
                                  "X-GitHub-Api-Version": "2022-11-28"})
    if status != 200:
        return res("unknown", f"GitHub API {status or 'unreachable'}")
    runs = json.loads(body).get("workflow_runs", [])

    # A cancel that never got going is the concurrency group dropping a twin
    # (BlinkDeal/AmazonGold do this all day) - not a failure. A cancel after
    # minutes of running is a timeout, and counts.
    def verdict(r):
        if r["status"] != "completed":
            return None
        if r["conclusion"] in ("success", "skipped", "neutral"):
            return "pass"
        if r["conclusion"] == "cancelled":
            try:
                ran = (parse_time(r["updated_at"]) - parse_time(r["run_started_at"])).total_seconds()
            except Exception:
                ran = 0
            return "fail" if ran > 300 else None
        return "fail"

    judged = [(r, v) for r in runs for v in [verdict(r)] if v]
    if not judged:
        return res("ok" if not c.get("ok") else "warn", "No finished runs yet")
    fails = 0
    for _, v in judged:
        if v != "fail":
            break
        fails += 1
    last_ok = next((r for r, v in judged if v == "pass"), None)
    last = judged[0][0]
    last_mins = (now - parse_time(last["updated_at"])).total_seconds() / 60

    if fails >= 2:
        return res("down", f"Last {fails} runs failed (latest {ago(last_mins)})")
    if fails == 1:
        return res("warn", f"Latest run failed {ago(last_mins)}")
    if c.get("ok") and last_ok:
        mins = (now - parse_time(last_ok["updated_at"])).total_seconds() / 60
        if mins > c["warn"]:
            return res("down", f"Hasn't run since {ago(mins)}")
        if mins > c["ok"]:
            return res("warn", f"Last ran {ago(mins)} - expected every {span(c['ok'])}")
        return res("ok", f"Passing · ran {ago(mins)}")
    return res("ok", f"Passing · last run {ago(last_mins)}")


CHECKS = {"http": check_http, "worker": check_worker, "age": check_age, "json": check_json,
          "count": check_count, "merchants": check_merchants, "workflow": check_workflow}


def run_check(c, now):
    try:
        r = CHECKS[c["type"]](c, now)
    except Exception as e:  # a bug in one check must not blank the board
        r = res("unknown", f"Check error: {type(e).__name__}")
    return {"label": c["label"], **r}


# ---------------------------------------------------------------- history + alerts

def previous():
    try:
        return fetch_json(LIVE_URL)
    except Exception:
        local = HERE / "_site" / "status.json"
        return json.loads(local.read_text("utf-8")) if local.exists() else {}


def summary_line(tool):
    bad = [c for c in tool["checks"] if c["status"] in ("warn", "down", "unknown")]
    if not bad:
        return "All checks passing"
    worst = max(bad, key=lambda c: RANK[c["status"]])
    return f"{worst['label']}: {worst['detail']}"


def telegram(changes, tools):
    tok, chat = os.environ.get("PULSE_TG_TOKEN", "").strip(), os.environ.get("PULSE_TG_CHAT", "").strip()
    if not (tok and chat and changes):
        return
    dot = {"ok": "🟢", "warn": "🟠", "down": "🔴", "unknown": "⚪"}
    lines = ["<b>Pulse · tool health changed</b>", ""]
    for t, was in changes:
        lines.append(f"{dot[t['status']]} <b>{t['name']}</b> ({was} → {t['status']})")
        lines.append(f"    {summary_line(t)}")
    bad = sum(1 for t in tools if t["status"] in ("warn", "down"))
    lines += ["", "All tools healthy ✅" if not bad else f"{bad} tool(s) need a look", "status.yourcardjourney.store"]
    for c in chat.split(","):
        data = json.dumps({"chat_id": c.strip(), "text": "\n".join(lines), "parse_mode": "HTML",
                           "disable_web_page_preview": True}).encode()
        try:
            urllib.request.urlopen(urllib.request.Request(
                f"https://api.telegram.org/bot{tok}/sendMessage", data=data,
                headers={"Content-Type": "application/json"}), timeout=20)
        except Exception as e:
            print("telegram failed:", type(e).__name__)


# ---------------------------------------------------------------- main

def main(out):
    out = Path(out)
    reg = json.loads((HERE / "tools.json").read_text("utf-8"))["tools"]
    now = datetime.now(timezone.utc)
    prev = previous()
    prev_tools = {t["id"]: t for t in prev.get("tools", [])}

    flat = [(i, c) for i, t in enumerate(reg) for c in t["checks"]]
    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(lambda ic: run_check(ic[1], now), flat))

    stamp = int(now.timestamp())
    cutoff = stamp - HISTORY_HOURS * 3600
    tools, changes = [], []
    for i, t in enumerate(reg):
        checks = [r for (j, _), r in zip(flat, results) if j == i]
        status = max((c["status"] for c in checks), key=lambda s: RANK[s])
        old = prev_tools.get(t["id"], {})
        hist = [h for h in old.get("history", []) if h[0] >= cutoff] + [[stamp, status]]
        since = old.get("since") if old.get("status") == status and old.get("since") else stamp
        tool = {"id": t["id"], "name": t["name"], "mark": t["mark"], "url": t["url"], "what": t["what"],
                "status": status, "since": since, "checks": checks, "history": hist}
        tool["summary"] = summary_line(tool)
        tools.append(tool)
        if old.get("status") and old["status"] != status and "unknown" not in (old["status"], status):
            changes.append((tool, old["status"]))

    counts = {s: sum(1 for t in tools if t["status"] == s) for s in RANK}
    doc = {"generatedAt": now.isoformat(timespec="seconds"), "everyMinutes": 15,
           "counts": counts, "tools": tools}

    if out.exists() and out.name == "_site":
        shutil.rmtree(out)
    shutil.copytree(HERE / "site", out, dirs_exist_ok=True)
    (out / "status.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1), "utf-8")
    v = str(stamp)
    page = (out / "index.html").read_text("utf-8").replace("{{V}}", v)
    (out / "index.html").write_text(page, "utf-8")

    telegram(changes, tools)
    for t in tools:
        print(f"{t['status']:>7}  {t['name']:<16} {t['summary']}")
    print("counts:", counts)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
