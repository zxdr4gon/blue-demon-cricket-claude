/* ==========================================================================
   Blue Demon Cricket — app.js
   ========================================================================== */

/* ---------- 1. CONFIG ---------- */
/* Replace these placeholder URLs with your published Google Sheets CSV links.
   File > Share > Publish to web > select sheet/tab > CSV.                    */
const SHEET_CONFIG = {
  "2026-27": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=960895682&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1022493287&single=true&output=csv",
    matches: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1521760675&single=true&output=csv"
  },
  "2025-26": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1041989768&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1051296080&single=true&output=csv",
    matches: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=226347194&single=true&output=csv"
  }
};

const COLUMNS = {
  batting: ["Player", "Matches", "Innings", "Runs", "Balls", "S/R", "Ave", "NO", "4s", "6s", "10s", "HS", "Catches"],
  bowling: ["Player", "Matches", "Innings", "Wickets", "Balls", "Overs", "Runs", "Economy", "Ave", "S/R"],
  matches: ["Date", "Opponent", "Result", "Score", "Overs", "Opp. Score", "Opp. Overs", "Notes"]
};

const PRIMARY_KEY = {
  batting: "Player",
  bowling: "Player",
  matches: "Date"
};

const NUMERIC_COLS = new Set([
  "Matches", "Innings", "Runs", "Balls", "S/R", "Ave", "NO", "4s", "6s", "10s",
  "HS", "Catches", "Wickets", "Overs", "Economy"
]);

/* ---------- 2. STATE ---------- */
const state = {
  season: Object.keys(SHEET_CONFIG)[0],
  data: {
    batting: [],
    bowling: [],
    matches: []
  },
  sort: {
    batting: { col: "Runs", dir: "desc" },
    bowling: { col: "Wickets", dir: "desc" },
    matches: { col: "Date", dir: "desc" }
  },
  search: {
    batting: "",
    bowling: "",
    matches: ""
  },
  charts: {
    runs: null,
    wickets: null,
    results: null
  }
};

/* ---------- 3. CSV FETCH + NORMALIZE ---------- */

async function fetchCsv(url) {
  // Fetch the raw text ourselves (rather than letting PapaParse's built-in
  // downloader do it) so we get clear, real error messages — including CORS
  // failures — instead of PapaParse's generic download error.
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (networkErr) {
    throw new Error(
      `Network/CORS error fetching CSV. Verify the sheet is published via File > Share > Publish to web (not just "Share"), and that the link is reachable. (${networkErr.message})`
    );
  }

  if (!response.ok) {
    throw new Error(`Sheet returned HTTP ${response.status} ${response.statusText}`);
  }

  const csvText = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      skipEmptyLines: "greedy",
      complete: (results) => resolve(results.data || []),
      error: (err) => reject(err)
    });
  });
}

/**
 * Raw rows come back as arrays of arrays (no header:true, since we need to
 * manually detect & strip the blank leading "padding" column before mapping
 * headers to values).
 */
function normalizeRows(rawRows, type) {
  if (!rawRows || rawRows.length === 0) return [];

  let rows = rawRows.slice();

  // Quirk #2: blank leading padding column(s). Some sheets have one blank
  // "Column A", others have more than one — strip as many leading all-blank
  // columns as are present, based on the header row.
  let leadingBlankCount = 0;
  const probeRow = rows[0] || [];
  while (leadingBlankCount < probeRow.length && (probeRow[leadingBlankCount] || "").toString().trim() === "") {
    leadingBlankCount++;
  }
  if (leadingBlankCount > 0) {
    rows = rows.map((r) => r.slice(leadingBlankCount));
  }

  // First remaining row is the header row.
  const headerRow = rows[0].map((h) => (h || "").toString().trim());
  const dataRows = rows.slice(1);

  const photoIdx = headerRow.findIndex((h) => h.toLowerCase() === "photo");
  const cols = COLUMNS[type];
  const primaryKey = PRIMARY_KEY[type];
  const primaryIdx = headerRow.findIndex(
    (h) => h.toLowerCase() === primaryKey.toLowerCase()
  );

  const out = [];

  dataRows.forEach((row) => {
    if (!row || row.length === 0) return;

    // Quirk #3: spacer rows — skip if primary column is blank.
    const primaryVal = primaryIdx >= 0 ? (row[primaryIdx] || "").toString().trim() : "";
    if (primaryVal === "") return;

    const record = {};
    cols.forEach((colName) => {
      const idx = headerRow.findIndex(
        (h) => h.toLowerCase() === colName.toLowerCase()
      );
      let val = idx >= 0 ? row[idx] : "";
      val = (val === undefined || val === null) ? "" : val.toString().trim();

      if (NUMERIC_COLS.has(colName)) {
        const num = parseFloat(val.replace(/[^0-9.\-]/g, ""));
        record[colName] = isNaN(num) ? 0 : num;
      } else {
        record[colName] = val;
      }
    });

    // Hidden Photo property — captured but excluded from `cols`, so it will
    // never render as a visible table column.
    record._photo = photoIdx >= 0 ? (row[photoIdx] || "").toString().trim() : "";

    out.push(record);
  });

  return out;
}

async function loadSeasonData(season) {
  const cfg = SHEET_CONFIG[season];
  const [battingRaw, bowlingRaw, matchesRaw] = await Promise.all([
    fetchCsv(cfg.batting),
    fetchCsv(cfg.bowling),
    fetchCsv(cfg.matches)
  ]);

  state.data.batting = normalizeRows(battingRaw, "batting");
  state.data.bowling = normalizeRows(bowlingRaw, "bowling");
  state.data.matches = normalizeRows(matchesRaw, "matches");
}

/* ---------- 4. ELITE BADGE LOGIC ---------- */

function isEliteBatter(row) {
  return row["HS"] >= 50 || row["S/R"] >= 140;
}

function isEliteBowler(row) {
  return row["Wickets"] >= 3;
}

function eliteBadge(row, type) {
  const elite = type === "batting" ? isEliteBatter(row) : isEliteBowler(row);
  return elite ? '<span class="bdc-badge-fire" title="Elite performance">🔥</span>' : "";
}

/* ---------- 5. AVATARS ---------- */

function renderAvatar(row, size) {
  const initials = (row["Player"] || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const cls = size === "large" ? "bdc-avatar-large" : "bdc-avatar";
  const fallbackCls = size === "large" ? "bdc-avatar-fallback-large" : "bdc-avatar-fallback";

  if (row._photo) {
    // Use onerror to swap to initials fallback if the image link is broken.
    return `
      <span class="bdc-avatar-slot">
        <img src="${escapeAttr(row._photo)}" alt="${escapeAttr(row["Player"])}" class="${cls}"
          onerror="this.replaceWith(Object.assign(document.createElement('span'), {className:'${fallbackCls}', textContent:'${escapeAttr(initials)}'}))">
      </span>`;
  }
  return `<span class="${fallbackCls}">${initials}</span>`;
}

function escapeAttr(str) {
  return (str || "").toString().replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str === undefined || str === null ? "" : str;
  return div.innerHTML;
}

/* ---------- 6. TABLE RENDERING ---------- */

function applySearchAndSort(type) {
  const cols = COLUMNS[type];
  const query = state.search[type].toLowerCase();
  let rows = state.data[type].filter((row) =>
    cols.some((c) => (row[c] + "").toLowerCase().includes(query))
  );

  const { col, dir } = state.sort[type];
  rows = rows.slice().sort((a, b) => {
    let av = a[col], bv = b[col];
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });

  return rows;
}

function renderTableHead(type) {
  const cols = COLUMNS[type];
  const headEl = document.getElementById(`${type}Head`);
  const { col: sortCol, dir } = state.sort[type];

  headEl.innerHTML = cols
    .map((c) => {
      let cls = "";
      if (c === sortCol) cls = dir === "asc" ? "sorted-asc" : "sorted-desc";
      return `<th data-col="${escapeAttr(c)}" class="${cls}">${escapeHtml(c)}</th>`;
    })
    .join("");

  headEl.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const colName = th.getAttribute("data-col");
      const current = state.sort[type];
      if (current.col === colName) {
        current.dir = current.dir === "asc" ? "desc" : "asc";
      } else {
        current.col = colName;
        current.dir = "desc";
      }
      renderTable(type);
    });
  });
}

function renderTable(type) {
  renderTableHead(type);
  const rows = applySearchAndSort(type);
  const bodyEl = document.getElementById(`${type}Body`);
  const cols = COLUMNS[type];

  if (rows.length === 0) {
    bodyEl.innerHTML = `<tr class="bdc-empty-row"><td colspan="${cols.length}">No results found.</td></tr>`;
    return;
  }

  bodyEl.innerHTML = rows
    .map((row) => {
      const cells = cols
        .map((c, i) => {
          if (i === 0 && (type === "batting" || type === "bowling")) {
            return `<td>
              <span class="bdc-player-row">
                ${renderAvatar(row, "small")}
                <span>${escapeHtml(row[c])}</span>
                ${eliteBadge(row, type)}
              </span>
            </td>`;
          }
          if (c === "Result") {
            const resClass = resultColorClass(row[c]);
            return `<td><span class="tag ${resClass}">${escapeHtml(row[c])}</span></td>`;
          }
          return `<td>${escapeHtml(row[c])}</td>`;
        })
        .join("");
      const rowKey = escapeAttr(row[PRIMARY_KEY[type]]);
      return `<tr data-key="${rowKey}">${cells}</tr>`;
    })
    .join("");

  if (type === "batting" || type === "bowling") {
    bodyEl.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => openPlayerModal(tr.getAttribute("data-key")));
    });
  }
}

function resultColorClass(result) {
  const r = (result || "").toLowerCase();
  if (r.startsWith("w")) return "is-success";
  if (r.startsWith("l")) return "is-danger";
  if (r.startsWith("d") || r.startsWith("t")) return "is-warning";
  return "is-light";
}

/* ---------- 7. PLAYER MODAL ---------- */

function findPlayerRecord(playerName) {
  const bat = state.data.batting.find((r) => r["Player"] === playerName);
  const bowl = state.data.bowling.find((r) => r["Player"] === playerName);
  return { bat, bowl };
}

function openPlayerModal(playerName) {
  const { bat, bowl } = findPlayerRecord(playerName);
  const photo = (bat && bat._photo) || (bowl && bowl._photo) || "";
  const nameEl = document.getElementById("modalPlayerName");
  const bodyEl = document.getElementById("modalBody");

  nameEl.textContent = playerName;

  const avatarSource = bat || bowl || { Player: playerName, _photo: photo };
  const avatarHtml = renderAvatar(avatarSource, "large");

  let pills = [];
  if (bat) {
    pills = pills.concat([
      ["Matches", bat["Matches"]],
      ["Innings", bat["Innings"]],
      ["Runs", bat["Runs"]],
      ["Balls", bat["Balls"]],
      ["Strike Rate", bat["S/R"]],
      ["Average", bat["Ave"]],
      ["Not Outs", bat["NO"]],
      ["4s", bat["4s"]],
      ["6s", bat["6s"]],
      ["10s", bat["10s"]],
      ["High Score", bat["HS"]],
      ["Catches", bat["Catches"]]
    ]);
  }
  if (bowl) {
    pills = pills.concat([
      ["Wickets", bowl["Wickets"]],
      ["Overs", bowl["Overs"]],
      ["Runs Conceded", bowl["Runs"]],
      ["Economy", bowl["Economy"]],
      ["Bowling Ave", bowl["Ave"]],
      ["Bowling S/R", bowl["S/R"]]
    ]);
  }

  const badges = [
    bat && isEliteBatter(bat) ? '<span class="tag is-warning">🔥 Elite Batter</span>' : "",
    bowl && isEliteBowler(bowl) ? '<span class="tag is-warning">🔥 Elite Bowler</span>' : ""
  ].filter(Boolean).join(" ");

  bodyEl.innerHTML = `
    <div class="bdc-modal-player-head">
      ${avatarHtml}
      <div>
        <p class="title is-5" style="margin-bottom:0.3rem;">${escapeHtml(playerName)}</p>
        <p>${badges || '<span class="tag is-light">No milestones yet</span>'}</p>
      </div>
    </div>
    <div class="bdc-modal-stats-grid">
      ${pills
        .map(
          ([label, value]) => `
        <div class="bdc-stat-pill">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value">${escapeHtml(value)}</span>
        </div>`
        )
        .join("")}
    </div>
  `;

  document.getElementById("playerModal").classList.add("is-active");
}

function closePlayerModal() {
  document.getElementById("playerModal").classList.remove("is-active");
}

/* ---------- 8. CHARTS ---------- */

function chartColors() {
  const dark = document.body.classList.contains("theme-dark");
  return {
    text: dark ? "#eef4ff" : "#0b1d34",
    grid: dark ? "rgba(255,255,255,0.08)" : "rgba(11,29,52,0.08)",
    bar1: "#2e69cf",
    bar2: "#ffb703",
    win: "#21c064",
    loss: "#e5484d",
    draw: "#f2b705"
  };
}

function destroyCharts() {
  Object.keys(state.charts).forEach((key) => {
    if (state.charts[key]) {
      state.charts[key].destroy();
      state.charts[key] = null;
    }
  });
}

function renderCharts() {
  destroyCharts();
  const colors = chartColors();

  Chart.defaults.color = colors.text;
  Chart.defaults.borderColor = colors.grid;

  // Top 5 run scorers
  const topRunners = state.data.batting
    .slice()
    .sort((a, b) => b["Runs"] - a["Runs"])
    .slice(0, 5);

  state.charts.runs = new Chart(document.getElementById("runsChart"), {
    type: "bar",
    data: {
      labels: topRunners.map((r) => r["Player"]),
      datasets: [
        {
          label: "Runs",
          data: topRunners.map((r) => r["Runs"]),
          backgroundColor: colors.bar1,
          borderRadius: 6
        }
      ]
    },
    options: chartOptions(colors)
  });

  // Top 5 wicket takers
  const topBowlers = state.data.bowling
    .slice()
    .sort((a, b) => b["Wickets"] - a["Wickets"])
    .slice(0, 5);

  state.charts.wickets = new Chart(document.getElementById("wicketsChart"), {
    type: "bar",
    data: {
      labels: topBowlers.map((r) => r["Player"]),
      datasets: [
        {
          label: "Wickets",
          data: topBowlers.map((r) => r["Wickets"]),
          backgroundColor: colors.bar2,
          borderRadius: 6
        }
      ]
    },
    options: chartOptions(colors)
  });

  // Match results doughnut
  const tally = { Wins: 0, Losses: 0, Draws: 0 };
  state.data.matches.forEach((m) => {
    const r = (m["Result"] || "").toLowerCase();
    if (r.startsWith("w")) tally.Wins++;
    else if (r.startsWith("l")) tally.Losses++;
    else tally.Draws++;
  });

  state.charts.results = new Chart(document.getElementById("resultsChart"), {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses", "Draws"],
      datasets: [
        {
          data: [tally.Wins, tally.Losses, tally.Draws],
          backgroundColor: [colors.win, colors.loss, colors.draw],
          borderWidth: 0
        }
      ]
    },
    options: {
      plugins: {
        legend: { labels: { color: colors.text } }
      }
    }
  });
}

function chartOptions(colors) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }
    },
    scales: {
      x: {
        ticks: { color: colors.text },
        grid: { color: colors.grid }
      },
      y: {
        beginAtZero: true,
        ticks: { color: colors.text },
        grid: { color: colors.grid }
      }
    }
  };
}

/* ---------- 9. VS MODE ---------- */

function populateVsDropdowns() {
  const players = Array.from(
    new Set([
      ...state.data.batting.map((r) => r["Player"]),
      ...state.data.bowling.map((r) => r["Player"])
    ])
  ).sort();

  ["vsPlayerA", "vsPlayerB"].forEach((id) => {
    const sel = document.getElementById(id);
    const current = sel.value;
    sel.innerHTML =
      `<option value="">Select Player ${id === "vsPlayerA" ? "A" : "B"}</option>` +
      players.map((p) => `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`).join("");
    if (players.includes(current)) sel.value = current;
  });
}

const VS_METRICS = [
  { key: "Runs", label: "Runs", source: "bat", higherBetter: true },
  { key: "S/R", label: "Batting S/R", source: "bat", higherBetter: true },
  { key: "Ave", label: "Batting Ave", source: "bat", higherBetter: true },
  { key: "HS", label: "High Score", source: "bat", higherBetter: true },
  { key: "Wickets", label: "Wickets", source: "bowl", higherBetter: true },
  { key: "Economy", label: "Economy", source: "bowl", higherBetter: false },
  { key: "Ave", label: "Bowling Ave", source: "bowl", higherBetter: false }
];

function renderVsComparison() {
  const nameA = document.getElementById("vsPlayerA").value;
  const nameB = document.getElementById("vsPlayerB").value;
  const resultEl = document.getElementById("vsResult");

  if (!nameA || !nameB) {
    resultEl.innerHTML = `<div class="bdc-vs-empty">Select two players to compare their season stats.</div>`;
    return;
  }

  const recA = findPlayerRecord(nameA);
  const recB = findPlayerRecord(nameB);

  const metricRows = VS_METRICS.map((m) => {
    const recFieldA = m.source === "bat" ? recA.bat : recA.bowl;
    const recFieldB = m.source === "bat" ? recB.bat : recB.bowl;
    const valA = recFieldA ? recFieldA[m.key] : null;
    const valB = recFieldB ? recFieldB[m.key] : null;
    return { ...m, valA, valB };
  }).filter((m) => m.valA !== null || m.valB !== null);

  function metricWinner(m) {
    if (m.valA === null && m.valB === null) return null;
    if (m.valA === null) return "B";
    if (m.valB === null) return "A";
    if (m.valA === m.valB) return null;
    if (m.higherBetter) return m.valA > m.valB ? "A" : "B";
    return m.valA < m.valB ? "A" : "B";
  }

  function buildCard(name, rec, side) {
    const avatarSrc = rec.bat || rec.bowl || { Player: name };
    const metricsHtml = metricRows
      .map((m) => {
        const winner = metricWinner(m);
        const val = side === "A" ? m.valA : m.valB;
        const isWinner = winner === side;
        return `
          <div class="bdc-vs-metric ${isWinner ? "winner" : ""}">
            <span class="metric-label">${escapeHtml(m.label)}</span>
            <span class="metric-value">${val === null || val === undefined ? "—" : escapeHtml(val)}</span>
          </div>`;
      })
      .join("");

    return `
      <div class="bdc-vs-card">
        <div class="bdc-vs-card-head">
          ${renderAvatar(avatarSrc, "small")}
          <span class="name">${escapeHtml(name)}</span>
        </div>
        ${metricsHtml}
      </div>`;
  }

  resultEl.innerHTML = buildCard(nameA, recA, "A") + buildCard(nameB, recB, "B");
}

/* ---------- 10. THEME TOGGLE ---------- */

function applyTheme(theme) {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.getElementById("themeIcon").textContent = theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("bdc-theme", theme);
  if (state.data.batting.length || state.data.bowling.length || state.data.matches.length) {
    renderCharts();
  }
}

function initTheme() {
  const saved = localStorage.getItem("bdc-theme") || "light";
  applyTheme(saved);
  document.getElementById("themeToggle").addEventListener("click", () => {
    const isDark = document.body.classList.contains("theme-dark");
    applyTheme(isDark ? "light" : "dark");
  });
}

/* ---------- 11. NAVIGATION / MISC UI ---------- */

function initNav() {
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.addEventListener("click", () => {
      const target = document.getElementById(link.getAttribute("data-nav"));
      if (target) target.scrollIntoView({ behavior: "smooth" });
      const navMenu = document.getElementById("navMenu");
      const burger = document.getElementById("navBurger");
      navMenu.classList.remove("is-active");
      burger.classList.remove("is-active");
    });
  });

  const burger = document.getElementById("navBurger");
  burger.addEventListener("click", () => {
    burger.classList.toggle("is-active");
    document.getElementById("navMenu").classList.toggle("is-active");
  });
}

function initSearch() {
  document.querySelectorAll("[data-search]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const type = e.target.getAttribute("data-search");
      state.search[type] = e.target.value;
      renderTable(type);
    });
  });
}

function initModal() {
  document.getElementById("modalClose").addEventListener("click", closePlayerModal);
  document.querySelector("#playerModal .modal-background").addEventListener("click", closePlayerModal);
}

function initSeasonSelect() {
  const sel = document.getElementById("seasonSelect");
  sel.innerHTML = Object.keys(SHEET_CONFIG)
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("");
  sel.value = state.season;
  sel.addEventListener("change", async (e) => {
    state.season = e.target.value;
    await refreshAllData();
  });
}

function initVsMode() {
  document.getElementById("vsPlayerA").addEventListener("change", renderVsComparison);
  document.getElementById("vsPlayerB").addEventListener("change", renderVsComparison);
}

/* ---------- 12. LOAD STATUS ---------- */

function setLoadStatus(mode, message) {
  const el = document.getElementById("loadStatus");
  if (mode === "loading") {
    el.classList.remove("is-hidden", "is-error");
    el.innerHTML = `<span class="bdc-spinner"></span> ${message}`;
  } else if (mode === "error") {
    el.classList.remove("is-hidden");
    el.classList.add("is-error");
    el.innerHTML = `⚠️ ${message}`;
  } else {
    el.classList.add("is-hidden");
  }
}

/* ---------- 13. MASTER REFRESH ---------- */

async function refreshAllData() {
  setLoadStatus("loading", `Loading ${state.season} season data…`);
  try {
    await loadSeasonData(state.season);
    renderTable("batting");
    renderTable("bowling");
    renderTable("matches");
    renderCharts();
    populateVsDropdowns();
    renderVsComparison();
    setLoadStatus("done");
  } catch (err) {
    console.error("BDC load error:", err);
    const detail = (err && (err.message || err.statusText)) || (typeof err === "string" ? err : "Unknown error");
    setLoadStatus(
      "error",
      `Couldn't load live sheet data (${detail}). Open the browser console for details — this is usually a CORS issue with the published CSV link, or a mismatched header name.`
    );
  }
}

/* ---------- 14. INIT ---------- */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initNav();
  initSearch();
  initModal();
  initSeasonSelect();
  initVsMode();
  refreshAllData();
});