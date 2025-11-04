/* grchallenges_viewer.js — season switcher + duplicate highlighting + filters (v2.0.1)
   Loads canonical artifact: /data/{year}/{season}.json
*/

const YEAR_MIN = 2023;
const YEAR_MAX = new Date().getFullYear();
const SEASONS = ["winter", "spring", "summer", "fall"];
const LS_KEY = "grch_viewer_state_v2";

// ---- Elements ----
const els = {
  year: document.getElementById("yearSel"),
  season: document.getElementById("seasonSel"),
  load: document.getElementById("loadBtn"),
  meta: document.getElementById("meta"),
  tbody: document.getElementById("tbody"),
  stats: document.getElementById("stats"),
  search: document.getElementById("searchBox"),
  theme: document.getElementById("themeBtn"),
  dupesOnly: document.getElementById("dupesOnlyChk"),
  sortSel: document.getElementById("sortSel"),
  achFilterWrap: document.getElementById("achFilterWrap"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
};

// ---- State ----
let ARTIFACT = null;
let ROWS = [];
let FILTERS = { search:"", dupesOnly:false, sort:"title-asc", achievements:new Set() };

// ---- Init ----
bootstrapYears();
bootstrapSeasons();
restoreState();
wireEvents();
initialLoad();

// ---- Functions ----
function bootstrapYears(){
  for(let y = YEAR_MAX; y >= YEAR_MIN; y--){
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    els.year.appendChild(opt);
  }
}

function bootstrapSeasons(){
  els.season.value = "summer"; // default; URL/LS may override below
}

function restoreState(){
  const u = new URL(window.location.href);
  const hashRaw = (u.hash || "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hashRaw);
  const y = parseInt(hashParams.get("y") || "", 10);
  const s = String(hashParams.get("s") || "").toLowerCase();
  const persisted = safeParse(localStorage.getItem(LS_KEY)) || {};

  const year = Number.isFinite(y) ? y : (persisted.year || YEAR_MAX);
  const season = SEASONS.indexOf(s) >= 0 ? s : (persisted.season || "summer");

  els.year.value = String(Math.min(Math.max(year, YEAR_MIN), YEAR_MAX));
  els.season.value = SEASONS.indexOf(season) >= 0 ? season : "summer";

  FILTERS.search = persisted.search || "";
  FILTERS.dupesOnly = !!persisted.dupesOnly;
  FILTERS.sort = persisted.sort || "title-asc";
  FILTERS.achievements = new Set(persisted.achievements || []);

  els.search.value = FILTERS.search;
  els.dupesOnly.checked = FILTERS.dupesOnly;
  els.sortSel.value = FILTERS.sort;
}

function persistState(){
  const payload = {
    year: parseInt(els.year.value, 10),
    season: els.season.value,
    search: FILTERS.search,
    dupesOnly: FILTERS.dupesOnly,
    sort: FILTERS.sort,
    achievements: Array.from(FILTERS.achievements),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  const sp = new URLSearchParams({ y: String(payload.year), s: payload.season });
  location.hash = sp.toString();
}

function wireEvents(){
  els.theme.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
  });

  ["change","input"].forEach(evt => {
    els.year.addEventListener(evt, () => { persistState(); loadSeason(); });
    els.season.addEventListener(evt, () => { persistState(); loadSeason(); });
  });
  els.load.addEventListener("click", () => { persistState(); loadSeason(); });

  const debounced = debounce(() => {
    FILTERS.search = els.search.value.trim();
    persistState();
    render();
  }, 150);
  els.search.addEventListener("input", debounced);

  els.dupesOnly.addEventListener("change", () => {
    FILTERS.dupesOnly = !!els.dupesOnly.checked;
    persistState();
    render();
  });

  els.sortSel.addEventListener("change", () => {
    FILTERS.sort = els.sortSel.value;
    persistState();
    render();
  });

  els.clearFiltersBtn.addEventListener("click", () => {
    FILTERS.search = "";
    FILTERS.dupesOnly = false;
    FILTERS.sort = "title-asc";
    FILTERS.achievements.clear();
    els.search.value = "";
    els.dupesOnly.checked = false;
    els.sortSel.value = "title-asc";
    syncAchChips();
    persistState();
    render();
  });
}

function initialLoad(){ loadSeason(); }

async function loadSeason(){
  const year = parseInt(els.year.value, 10);
  const season = els.season.value;
  const url = `/data/${year}/${season}.json`;
  els.meta.textContent = `Loading ${url}…`;
  try{
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(res.status + " " + res.statusText);
    ARTIFACT = await res.json();
    hydrateFromArtifact(ARTIFACT);
    els.meta.innerHTML = metaText(ARTIFACT, url);
    persistState();
    render();
  }catch(err){
    ARTIFACT = null;
    ROWS = [];
    els.tbody.innerHTML = "";
    els.stats.textContent = "—";
    els.meta.textContent = `Failed to load ${url}: ${err && err.message ? err.message : String(err)}`;
    console.error("Season load failed:", err);
  }
}

function metaText(a, url){
  const lists = (a && a.achievements ? a.achievements.length : 0);
  const season = a && a.season && a.season.name ? a.season.name : "—";
  const year = a && a.season && a.season.year ? a.season.year : "";
  const gen = a && a.generated_at ? a.generated_at : "—";
  return '<span class="muted">Season:</span> <b>' + escapeHtml(season) + ' ' + escapeHtml(String(year)) + '</b>'
       + ' · <span class="muted">Generated:</span> ' + escapeHtml(gen)
       + ' · <span class="muted">Lists:</span> ' + lists
       + ' · <span class="muted">Source:</span> <code>' + escapeHtml(url) + '</code>';
}

function hydrateFromArtifact(a){
  const dupTA = Object.create(null);
  const dupArr = a && a.dedupe && a.dedupe.duplicates_by_title_author ? a.dedupe.duplicates_by_title_author : [];
  dupArr.forEach(d => {
    const key = keyTA(d.title, d.author);
    dupTA[key] = d.achievements || [];
  });

  const idx = new Map();
  (a && a.achievements ? a.achievements : []).forEach(ach => {
    (ach.books || []).forEach(b => {
      if(!b || !b.title) return;
      const key = keyTA(b.title, b.author);
      if(!idx.has(key)){
        idx.set(key, {
          title: b.title || "",
          author: b.author || "",
          link: b.link || "",
          achievements: new Set(),
        });
      }
      idx.get(key).achievements.add(ach.name);
    });
  });

  ROWS = Array.from(idx.values()).map(r => ({
    title: r.title,
    author: r.author || "",
    link: r.link || "",
    achievements: Array.from(r.achievements).sort(),
    isDup: (dupTA[keyTA(r.title, r.author)] || []).length > 1
  }));

  const allAchNames = new Set();
  (a && a.achievements ? a.achievements : []).forEach(ach => allAchNames.add(ach.name));
  buildAchChips(Array.from(allAchNames).sort());
}

function buildAchChips(names){
  els.achFilterWrap.innerHTML = "";
  names.forEach(nm => {
    const id = "ach_" + slug(nm);
    const label = document.createElement("label");
    label.className = "pill";
    label.htmlFor = id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = id;
    cb.checked = FILTERS.achievements.has(nm);
    cb.addEventListener("change", () => {
      if(cb.checked) FILTERS.achievements.add(nm);
      else FILTERS.achievements.delete(nm);
      persistState();
      render();
    });

    const span = document.createElement("span");
    span.textContent = nm;

    label.appendChild(cb);
    label.appendChild(span);
    els.achFilterWrap.appendChild(label);
  });
}

function syncAchChips(){
  var cbs = els.achFilterWrap.querySelectorAll("input[type=checkbox]");
  for(var i=0;i<cbs.length;i++) cbs[i].checked = false;
}

function render(){
  const filtered = applyFilters(ROWS, FILTERS);
  const sorted = sortRows(filtered, FILTERS.sort);
  renderRows(sorted);
}

function applyFilters(rows, f){
  let out = rows.slice(0);

  const s = (f.search || "").toLowerCase();
  if(s){
    out = out.filter(r =>
      r.title.toLowerCase().includes(s) ||
      r.author.toLowerCase().includes(s) ||
      r.achievements.some(a => a.toLowerCase().includes(s))
    );
  }

  if(f.dupesOnly){
    out = out.filter(r => r.isDup);
  }

  if(f.achievements.size > 0){
    out = out.filter(r => r.achievements.some(a => f.achievements.has(a)));
  }

  return out;
}

function sortRows(rows, sortKey){
  const parts = (sortKey || "title-asc").split("-");
  const field = parts[0];
  const dir = parts[1] || "asc";
  const m = dir === "desc" ? -1 : 1;
  const copy = rows.slice(0);
  copy.sort((a,b) => {
    if(field === "achcnt"){
      const d = (a.achievements.length - b.achievements.length);
      return d === 0 ? a.title.localeCompare(b.title) * m : d * m;
    }
    return (a[field] || "").localeCompare(b[field] || "") * m;
  });
  return copy;
}

function renderRows(rows){
  els.tbody.innerHTML = "";
  let i = 0;
  rows.forEach(r => {
    const tr = document.createElement("tr");
    if(r.isDup) tr.classList.add("dupe");
    tr.innerHTML =
      "<td>"+(++i)+"</td>"+
      "<td>"+escapeHtml(r.title)+"</td>"+
      "<td>"+escapeHtml(r.author)+"</td>"+
      '<td class="ach">'+r.achievements.map(a => '<span class="pill">'+escapeHtml(a)+'</span>').join(" ")+"</td>"+
      "<td>"+(r.link ? '<a class="link" href="'+r.link+'" target="_blank" rel="noopener">Open</a>' : '<span class="muted">—</span>')+"</td>";
    els.tbody.appendChild(tr);
  });
  const dupCount = rows.filter(r => r.isDup).length;
  els.stats.textContent = rows.length + " books · " + dupCount + " duplicates highlighted";
}

// ---- utils ----
function keyTA(title, author){
  return String((title||"").trim().toLowerCase()) + "|" + String((author||"").trim().toLowerCase());
}
function slug(s){
  return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}
function escapeHtml(s){
  var str = (s == null) ? "" : String(s);
  return str.replace(/[&<>"']/g, function(ch){
    switch(ch){
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}
function safeParse(s){ try{ return JSON.parse(s); }catch(e){ return null; } }
function debounce(fn, ms){ let t; return function(){ clearTimeout(t); const a=arguments, ctx=this; t=setTimeout(function(){ fn.apply(ctx,a); }, ms); }; }

