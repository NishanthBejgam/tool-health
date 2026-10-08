/* Pulse front end. Reads status.json (written by check.py every ~15 min),
   re-reads it every minute, and never needs a server. */
(function () {
  const WORD = { ok: "Healthy", warn: "Warning", down: "Down", unknown: "Unknown" };
  const RANK = { down: 0, warn: 1, unknown: 2, ok: 3 };
  const SLOT_MIN = 15, SLOTS = 96;          // 24 h strip of 15-minute slots
  const open = new Set();
  let data = null;

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function ago(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = m / 60;
    return h < 48 ? (Math.round(h * 10) / 10) + " h ago" : Math.round(h / 24) + " days ago";
  }
  function dur(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return m + " min";
    const h = Math.floor(m / 60);
    return h < 48 ? h + " h " + (m % 60 ? (m % 60) + " min" : "") : Math.round(h / 24) + " days";
  }

  function bars(hist, now) {
    const slots = new Array(SLOTS).fill(null);
    const end = now / 1000;
    for (const [t, s] of hist || []) {
      const idx = SLOTS - 1 - Math.floor((end - t) / (SLOT_MIN * 60));
      if (idx < 0 || idx >= SLOTS) continue;
      if (slots[idx] === null || RANK[s] < RANK[slots[idx]]) slots[idx] = s;
    }
    const seen = slots.filter(Boolean);
    const up = seen.length ? Math.round(100 * seen.filter((s) => s === "ok").length / seen.length) : null;
    const html = slots.map((s, i) => {
      const at = new Date((end - (SLOTS - 1 - i) * SLOT_MIN * 60) * 1000);
      const t = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<i class="${s || ""}" title="${t} · ${s ? WORD[s] : "no check"}"></i>`;
    }).join("");
    return { html, up };
  }

  function tile(t, i, now) {
    const b = bars(t.history, now);
    const checks = t.checks.map((c) =>
      `<li><i class="${c.status}"></i><div><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></div></li>`).join("");
    const since = t.since ? `${WORD[t.status]} for ${dur(now / 1000 - t.since)}` : "";
    return `
      <article class="tile ${t.status}${open.has(t.id) ? " open" : ""}" style="--i:${i}" data-id="${esc(t.id)}">
        <button class="tile-head" type="button" aria-expanded="${open.has(t.id)}">
          <span class="mark"><img src="marks/${esc(t.mark)}" alt="" loading="lazy"></span>
          <span class="name"><b>${esc(t.name)}</b><small>${esc(t.what)}</small></span>
          <span class="head-right"><span class="pill">${WORD[t.status]}</span>
            <svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>
        </button>
        <div class="summary">${esc(t.summary)}</div>
        <div class="strip">
          <div class="bars" aria-label="Last 24 hours">${b.html}</div>
          <div class="strip-foot"><span>24 h ago</span><span>${b.up === null ? "" : `<b>${b.up}%</b> healthy · `}${esc(since)}</span><span>now</span></div>
        </div>
        <div class="checks"><div>
          <ul>${checks}</ul>
          <a class="open-link" href="${esc(t.url)}" target="_blank" rel="noopener">Open ${esc(t.name)} ↗</a>
        </div></div>
      </article>`;
  }

  // A heartbeat whose rhythm says the verdict: steady when healthy, a
  // skipped beat on a warning, flat-lining with spikes when something is down.
  function ecg(overall) {
    const W = 1200, mid = 60, beat = 150;
    let d = `M0 ${mid}`;
    for (let x = 0, n = 0; x < W; x += beat, n++) {
      const flat = overall === "down" && n % 3 !== 1;
      const skip = overall === "warn" && n % 4 === 2;
      if (flat || skip) { d += ` L${x + beat} ${mid}`; continue; }
      const amp = overall === "down" ? 46 : 40;
      d += ` L${x + 50} ${mid} L${x + 58} ${mid - 8} L${x + 64} ${mid} L${x + 70} ${mid + 10}` +
           ` L${x + 78} ${mid - amp} L${x + 86} ${mid + amp * .55} L${x + 92} ${mid} L${x + 108} ${mid - 10} L${x + 120} ${mid} L${x + beat} ${mid}`;
    }
    $("#ecg").setAttribute("d", d);
  }

  function render() {
    if (!data) return;
    const now = Date.now();
    const gen = new Date(data.generatedAt).getTime();
    const lateMin = (now - gen) / 60000;
    const tools = [...data.tools].sort((a, b) => RANK[a.status] - RANK[b.status]);
    const c = { ok: 0, warn: 0, down: 0, unknown: 0 };
    tools.forEach((t) => c[t.status]++);

    // The checker can die too - if it hasn't run, nothing above is current.
    let overall = c.down ? "down" : c.warn ? "warn" : c.unknown ? "unknown" : "ok";
    const banner = $("#banner");
    if (lateMin > 45) {
      const bad = lateMin > 120;
      banner.hidden = false;
      banner.className = "banner" + (bad ? " down" : "");
      banner.textContent = `The checker last ran ${ago(now - gen)} - GitHub's scheduler is late${bad ? " or the check job is failing" : ""}. Colours below are from that run.`;
      if (bad && overall === "ok") overall = "warn";
    } else banner.hidden = true;

    document.body.dataset.overall = overall;
    const n = tools.length, bad = c.down + c.warn;
    $("#headline").textContent =
      c.down ? `${c.down} tool${c.down > 1 ? "s" : ""} down` + (c.warn ? `, ${c.warn} warning` : "")
      : c.warn ? `${c.warn} tool${c.warn > 1 ? "s" : ""} need${c.warn > 1 ? "" : "s"} a look`
      : `All ${n} tools healthy`;
    $("#subline").textContent = bad
      ? tools.filter((t) => t.status === "down" || t.status === "warn").map((t) => t.name).join(" · ")
      : "Sites up, data fresh, builds and watchers passing.";
    $("#tally").innerHTML = ["ok", "warn", "down", "unknown"].filter((s) => s !== "unknown" || c.unknown)
      .map((s) => `<span class="${s}${c[s] ? "" : " zero"}"><i></i><b>${c[s]}</b> ${WORD[s]}</span>`).join("");
    const chk = $("#checked");
    chk.classList.toggle("stale", lateMin > 45);
    const next = Math.max(0, Math.round((data.everyMinutes || 15) - lateMin));
    chk.querySelector("span").textContent = `Checked ${ago(now - gen)}` + (lateMin <= 45 ? ` · next ~${next || 1} min` : "");
    $("#grid").innerHTML = tools.map((t, i) => tile(t, i, now)).join("");
    ecg(overall);
    requestAnimationFrame(() => setTimeout(() => document.body.classList.add("settled"), 1200));
    document.title = (bad ? `(${bad}) ` : "") + "Pulse";
  }

  async function load() {
    try {
      const r = await fetch("status.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) data = await r.json();
    } catch (e) { /* keep showing the last good read */ }
    render();
  }

  $("#grid").addEventListener("click", (e) => {
    const head = e.target.closest(".tile-head");
    if (!head) return;
    const el = head.parentElement, id = el.dataset.id;
    open.has(id) ? open.delete(id) : open.add(id);
    el.classList.toggle("open");
    head.setAttribute("aria-expanded", open.has(id));
  });
  $("#themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("pulse.theme", root.dataset.theme); } catch (e) {}
  });

  load();
  setInterval(load, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
})();
