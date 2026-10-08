/* Pulse front end. Reads status.json (written by check.py every ~15 min),
   re-reads it every minute, and never needs a server.
   LOOK holds each tool's face: the same gradient, glow and line icon it wears
   on yourcardjourney.store (copied from there where the store has it). */
(function () {
  const WORD = { ok: "Healthy", warn: "Warning", down: "Down", unknown: "Unknown" };
  const RANK = { down: 0, warn: 1, unknown: 2, ok: 3 };
  const SLOT_RANK = { down: 0, warn: 1, ok: 2, unknown: 3 };
  const SLOT_MIN = 15, SLOTS = 96;          // 24 h strip, one bar per check
  const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';

  const LOOK = {
    karatboard: {
      tag: "Gold rates. One screen.",
      grad: "linear-gradient(140deg,#f6d06a 0%,#c9971f 48%,#8a5f14 100%)", glow: "rgba(201,151,31,.45)",
      svg: `<svg ${S} stroke-width="1.7">
        <path class="an-ingot" d="M9.6 4.6h6.2l1.5 4.2H8.1z" fill="currentColor" fill-opacity=".28"/>
        <path class="an-ingot" d="M4.4 11.1h6.2l1.5 4.2H2.9z" fill="currentColor" fill-opacity=".28"/>
        <path class="an-ingot" d="M13.4 11.1h6.2l1.5 4.2h-9.2z" fill="currentColor" fill-opacity=".28"/>
        <path class="an-ingot" d="M8.9 17.6h6.2l1.5 4.2H7.4z" fill="currentColor" fill-opacity=".28"/></svg>`,
    },
    karatalerts: {
      tag: "Gold gaps, rung on Telegram.",
      grad: "linear-gradient(140deg,#fcd34d 0%,#f59e0b 45%,#e11d48 100%)", glow: "rgba(245,120,40,.42)",
      svg: `<svg ${S} stroke-width="1.8"><g class="an-bell">
        <path d="M12 3.5c-3.3 0-5.6 2.5-5.6 5.8v3.8L4.7 16h14.6l-1.7-2.9V9.3c0-3.3-2.3-5.8-5.6-5.8z" fill="currentColor" fill-opacity=".22"/>
        <path d="M10 19a2.1 2.1 0 0 0 4 0"/></g>
        <path class="an-ray" d="M20 5.5l1.4-1.3M21 9h1.6M3 9H1.4M4 5.5L2.6 4.2" stroke-width="1.6"/></svg>`,
    },
    couponwatch: {
      tag: "Jewellery coupons, watched.",
      grad: "linear-gradient(140deg,#64748b 0%,#334155 50%,#0f172a 100%)", glow: "rgba(51,65,85,.42)",
      svg: `<svg ${S} stroke-width="1.7">
        <path d="M3 8.2A1.7 1.7 0 0 1 4.7 6.5h14.6A1.7 1.7 0 0 1 21 8.2v2.2a1.9 1.9 0 0 0 0 3.2v2.2a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 15.8v-2.2a1.9 1.9 0 0 0 0-3.2z" fill="currentColor" fill-opacity=".2"/>
        <g class="an-eye"><path d="M7 12c1.4-2 3-3 5-3s3.6 1 5 3c-1.4 2-3 3-5 3s-3.6-1-5-3z" fill="#ff9900" fill-opacity=".9" stroke="none"/>
        <circle cx="12" cy="12" r="1.6" fill="#0f172a" stroke="none"/></g></svg>`,
    },
    rewardswitch: {
      tag: "Amazon rewards, switched on.",
      grad: "linear-gradient(140deg,#f97316 0%,#dc4a0f 55%,#b93d0a 100%)", glow: "rgba(220,74,15,.42)",
      svg: `<svg ${S} stroke-width="1.8">
        <rect x="3" y="8" width="18" height="8" rx="4" fill="currentColor" fill-opacity=".2"/>
        <circle class="an-knob" cx="8.5" cy="12" r="2.6" fill="currentColor" stroke="none"/>
        <g class="an-ray" stroke-width="1.6"><path d="M15.5 5.5v-2"/><path d="M19 7l1.4-1.4"/><path d="M12 7l-1.4-1.4"/></g></svg>`,
    },
    blinkdeal: {
      tag: "Gold coin deals, in a blink.",
      grad: "linear-gradient(140deg,#f13ab1 0%,#ff3f6c 48%,#fd913c 100%)", glow: "rgba(255,63,108,.42)",
      svg: `<svg ${S} stroke-width="1.7">
        <circle class="an-rim" cx="12" cy="12" r="9.2" fill="currentColor" fill-opacity=".2"/>
        <circle class="an-rim" cx="12" cy="12" r="6.2" opacity=".45"/>
        <path class="an-bolt" d="M13.6 5.4 8.5 13.2h3.1l-.8 5.6 5.1-7.9h-3.1l.8-5.5z" fill="currentColor" stroke-width="1.1"/></svg>`,
    },
    amazongold: {
      tag: "Amazon gold, price-checked.",
      grad: "linear-gradient(140deg,#ffc266 0%,#ff9900 52%,#e47911 100%)", glow: "rgba(255,153,0,.42)",
      svg: `<svg ${S} stroke-width="1.6">
        <g class="an-roll"><circle cx="12" cy="9.2" r="6.4" fill="currentColor" fill-opacity=".28"/>
        <circle cx="12" cy="9.2" r="3.6" opacity=".7"/><path d="M12 2.8v1.9M12 13.7v1.9" opacity=".7"/></g>
        <path class="an-smile" pathLength="40" d="M4.8 18.4c3.9 2.6 10.5 2.6 14.4 0" stroke-width="2.1"/>
        <path class="an-tip" pathLength="40" d="M17.6 16.7l1.9 1.6-2.4 1" stroke-width="2.1"/></svg>`,
    },
    flipkartgold: {
      tag: "Flipkart gold, deal-ready.",
      grad: "linear-gradient(140deg,#6aa8ff 0%,#2874f0 52%,#1a5dcc 100%)", glow: "rgba(40,116,240,.42)",
      svg: `<svg ${S} stroke-width="1.7">
        <path d="M5 9.5h14l-1.2 10.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3z" fill="currentColor" fill-opacity=".2"/>
        <path d="M9 9.5V8a3 3 0 0 1 6 0v1.5"/>
        <g class="an-drop"><circle cx="12" cy="14.6" r="3" fill="#ffe500" stroke="none"/><path d="M12 13.2v2.8" stroke="#1a5dcc" stroke-width="1.3"/></g></svg>`,
    },
    whichbike: {
      tag: "Which bike, which card.",
      grad: "linear-gradient(140deg,#ff6a5f 0%,#e0160c 52%,#a50e06 100%)", glow: "rgba(224,22,12,.4)",
      svg: `<svg ${S} stroke-width="1.7">
        <g class="an-wheel"><circle cx="5.8" cy="15.5" r="3.6" fill="currentColor" fill-opacity=".2"/><path d="M5.8 11.9v7.2M2.2 15.5h7.2" opacity=".55"/></g>
        <g class="an-wheel"><circle cx="18.2" cy="15.5" r="3.6" fill="currentColor" fill-opacity=".2"/><path d="M18.2 11.9v7.2M14.6 15.5h7.2" opacity=".55"/></g>
        <path class="an-ride" d="M5.8 15.5l3.6-6h5.2l3.6 6M9.4 9.5L8.2 7h-2M14.6 9.5l1.5-3h2.3M12 15.5l2.6-6"/></svg>`,
    },
    deals: {
      tag: "Voucher deals, broadcast.",
      grad: "linear-gradient(140deg,#fb7185 0%,#e11d48 52%,#9f1239 100%)", glow: "rgba(225,29,72,.4)",
      svg: `<svg ${S} stroke-width="1.7"><g class="an-tagg">
        <path d="M13.2 3.5h6.3v6.3l-9.2 9.2a1.6 1.6 0 0 1-2.2 0L4 14.9a1.6 1.6 0 0 1 0-2.2z" fill="currentColor" fill-opacity=".22"/>
        <circle cx="16.4" cy="6.6" r="1.3" fill="currentColor"/>
        <path d="M8.6 14.4l4.2-4.2" stroke-width="1.6"/></g></svg>`,
    },
    recast: {
      tag: "One post. Every channel.",
      grad: "linear-gradient(140deg,#a78bfa 0%,#6b38c9 55%,#4c1d95 100%)", glow: "rgba(107,56,201,.42)",
      svg: `<svg ${S} stroke-width="1.8">
        <circle cx="5.5" cy="12" r="2.6" fill="currentColor" fill-opacity=".35"/>
        <g class="an-fan"><path pathLength="40" d="M8.3 11l10.2-6"/><path pathLength="40" d="M8.3 11.6l11.2-2.4"/>
        <path pathLength="40" d="M8.3 12.4l11.2 2.4"/><path pathLength="40" d="M8.3 13l10.2 6"/></g></svg>`,
    },
    "blinkdeal-live": {
      tag: "Every gold board. One wheel.",
      grad: "linear-gradient(140deg,#f5e3a3 0%,#d6b25e 50%,#9c7a2b 100%)", glow: "rgba(214,178,94,.45)",
      svg: `<svg ${S} stroke-width="1.7">
        <circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".2"/>
        <g class="an-dial"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" opacity=".55"/></g>
        <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`,
    },
    yourcardjourney: {
      tag: "The store. Every tool.",
      grad: "linear-gradient(140deg,#6366f1 0%,#a855f7 50%,#ec4899 100%)", glow: "rgba(168,85,247,.42)",
      svg: `<svg ${S} stroke-width="1.8">
        <circle cx="5.5" cy="18" r="2.2" fill="currentColor" fill-opacity=".35"/>
        <path class="an-route" pathLength="100" d="M7.6 17.4c4-1 1.6-6.4 5.6-7.6 2.4-.7 3.6.4 5-.8"/>
        <path d="M18.5 3.8c-1.9 0-3.3 1.4-3.3 3.2 0 2.2 3.3 5.2 3.3 5.2s3.3-3 3.3-5.2c0-1.8-1.4-3.2-3.3-3.2z" fill="currentColor" fill-opacity=".3"/>
        <circle cx="18.5" cy="7" r="1.1" fill="currentColor" stroke="none"/></svg>`,
    },
  };
  const FALLBACK = { tag: "", grad: "linear-gradient(140deg,#94a3b8,#475569)", glow: "rgba(71,85,105,.35)",
    svg: `<svg ${S} stroke-width="1.8"><circle cx="12" cy="12" r="7" fill="currentColor" fill-opacity=".2"/></svg>` };

  const open = new Set();
  let data = null, first = true;
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
    return h < 48 ? h + " h" : Math.round(h / 24) + " days";
  }

  function dots(hist, now) {
    const slots = new Array(SLOTS).fill(null), end = now / 1000;
    for (const [t, s] of hist || []) {
      const i = SLOTS - 1 - Math.floor((end - t) / (SLOT_MIN * 60));
      // worst result in the slot wins - but "couldn't judge" never hides a real result
      if (i >= 0 && i < SLOTS && (slots[i] === null || SLOT_RANK[s] < SLOT_RANK[slots[i]])) slots[i] = s;
    }
    const seen = slots.filter((s) => s && s !== "unknown");
    const up = seen.length ? Math.round(100 * seen.filter((s) => s === "ok").length / seen.length) : null;
    const html = slots.map((s, i) => {
      const at = new Date((end - (SLOTS - 1 - i) * SLOT_MIN * 60) * 1000)
        .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `<i class="${s || ""}" style="--n:${i}" title="${at} · ${s ? WORD[s] : "no check"}"></i>`;
    }).join("");
    return { html, up };
  }

  function card(t, i, now) {
    const L = LOOK[t.id] || FALLBACK;
    const d = dots(t.history, now);
    const note = t.status === "ok" ? `All checks passing · ${WORD.ok.toLowerCase()} for ${dur(now / 1000 - t.since)}` : t.summary;
    const checks = t.checks.map((c) =>
      `<li><i class="${c.status}"></i><div><b>${esc(c.label)}</b><span>${esc(c.detail)}</span></div></li>`).join("");
    return `
      <article class="card ${t.status}${open.has(t.id) ? " open" : ""}" tabindex="0" role="button"
        aria-expanded="${open.has(t.id)}" data-id="${esc(t.id)}"
        style="--i:${i};--grad:${L.grad};--glow:${L.glow}">
        <span class="state"><i></i>${WORD[t.status]}</span>
        <div class="tile">${L.svg}</div>
        <h3>${esc(t.name)}</h3>
        <p class="tag">${esc(L.tag || t.what)}</p>
        <p class="note">${esc(note)}</p>
        <div class="hist"><div class="bars" aria-label="Last 24 hours">${d.html}</div>
          <div class="hist-foot"><span>24 h ago</span><span>${d.up === null ? "" : d.up + "% healthy"}</span><span>now</span></div></div>
        <div class="more"><div>
          <ul class="checks">${checks}</ul>
          <a class="go" href="${esc(t.url)}" target="_blank" rel="noopener">Open ${esc(t.name)} ↗</a>
        </div></div>
      </article>`;
  }

  function render() {
    if (!data) return;
    const now = Date.now(), gen = new Date(data.generatedAt).getTime(), late = (now - gen) / 60000;
    const tools = [...data.tools].sort((a, b) => RANK[a.status] - RANK[b.status]);
    const c = { ok: 0, warn: 0, down: 0, unknown: 0 };
    tools.forEach((t) => c[t.status]++);
    let overall = c.down ? "down" : c.warn ? "warn" : c.unknown ? "unknown" : "ok";

    // The checker can die too - if it hasn't run, nothing below is current.
    const banner = $("#banner");
    if (late > 45) {
      const bad = late > 120;
      banner.hidden = false;
      banner.className = "banner" + (bad ? " down" : "");
      banner.textContent = `The checker last ran ${ago(now - gen)} - GitHub's scheduler is late${bad ? " or the check job is failing" : ""}. Colours are from that run.`;
      if (bad && overall === "ok") overall = "warn";
    } else banner.hidden = true;

    document.body.dataset.overall = overall;
    const n = tools.length, bad = c.down + c.warn;
    $("#headline").textContent = c.down
      ? `${c.down} down${c.warn ? `, ${c.warn} warning` : ""} - ${tools.filter((t) => t.status === "down" || t.status === "warn").map((t) => t.name).join(", ")}.`
      : c.warn ? `${c.warn} need${c.warn > 1 ? "" : "s"} a look - ${tools.filter((t) => t.status === "warn").map((t) => t.name).join(", ")}.`
      : `All ${n} tools healthy. Sites up, data fresh, builds passing.`;
    $("#tally").innerHTML = ["ok", "warn", "down", "unknown"].filter((s) => s !== "unknown" || c.unknown)
      .map((s) => `<span class="${c[s] ? "" : "zero"}"><i class="${s}"></i><b>${c[s]}</b> ${WORD[s]}</span>`).join("");
    const due = Math.round((data.everyMinutes || 15) - late);
    $("#checked span").textContent = `Checked ${ago(now - gen)}` +
      (due >= 1 ? ` · next in ~${due} min` : late <= 45 ? " · next check due now" : "");
    $("#grid").innerHTML = tools.map((t, i) => card(t, i, now)).join("");
    document.title = (bad ? `(${bad}) ` : "") + "Pulse";
    if (first) { first = false; setTimeout(() => document.body.classList.add("settled"), 1400); }
  }

  async function load() {
    try {
      const r = await fetch("status.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) data = await r.json();
    } catch (e) { /* keep showing the last good read */ }
    render();
  }

  function toggle(el) {
    const id = el.dataset.id;
    open.has(id) ? open.delete(id) : open.add(id);
    el.classList.toggle("open");
    el.setAttribute("aria-expanded", open.has(id));
  }
  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest(".go")) return;
    const el = e.target.closest(".card");
    if (el) toggle(el);
  });
  $("#grid").addEventListener("keydown", (e) => {
    const el = e.target.closest(".card");
    if (el && (e.key === "Enter" || e.key === " ") && e.target === el) { e.preventDefault(); toggle(el); }
  });
  $("#themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("pulse.theme2", root.dataset.theme); } catch (e) {}
  });

  load();
  setInterval(load, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
})();
