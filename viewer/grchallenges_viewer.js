/* grchallenges_viewer.js — viewer with view modes, covers, filters, achievements (v2.4.2)
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
  achModeSel: document.getElementById("achModeSel"),
  viewModeSel: document.getElementById("viewModeSel"),
  coversChk: document.getElementById("coversChk"),
  appTitle: document.getElementById("appTitle"),
  seasonLabel: document.getElementById("seasonLabel"),
  createdByLink: document.getElementById("createdByLink"),
  createdByCoffeeWrapper: document.getElementById("createdByCoffeeWrapper"),
  coffeeLink: document.getElementById("coffeeLink"),
  aboutBlock: document.getElementById("aboutBlock"),
  aboutDescription: document.getElementById("aboutDescription"),
  aboutDisclaimer: document.getElementById("aboutDisclaimer"),
  aboutSeason: document.getElementById("aboutSeason"),
  aboutVersion: document.getElementById("aboutVersion"),
  aboutChallengeLink: document.getElementById("aboutChallengeLink"),
  aboutFeedbackLink: document.getElementById("aboutFeedbackLink"),
  aboutCoffeeLink: document.getElementById("aboutCoffeeLink"),
  adminBlock: document.getElementById("adminBlock"),
  achievementsBlock: document.getElementById("achievementsBlock"),
  bookTableWrap: document.getElementById("bookTableWrap"),
  bookGridWrap: document.getElementById("bookGridWrap"),
  bookGrid: document.getElementById("bookGrid"),
};

// ---- State ----
let ARTIFACT = null;
let ROWS = [];
let VIEWER_CONFIG = null;

let FILTERS = {
  search: "",
  dupesOnly: false,
  sort: "title-asc",
  achievements: new Set(),
  achMode: "any",   // "any" (OR) or "all" (AND)
  viewMode: "table",// "table" or "grid"
  showCovers: false // global cover toggle
};

// ---- Functions ----
function bootstrapYears(){
  for(let y = YEAR_MAX; y >= YEAR_MIN; y--){
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    if(els.year) els.year.appendChild(opt);
  }
}

function bootstrapSeasons(){
  if(els.season){
    els.season.value = "summer"; // initial; restoreState will override
  }
}

function restoreState(){
  const u = new URL(window.location.href);
  const hashRaw = (u.hash || "").replace(/^#/, "");
  const hashParams = new URLSearchParams(hashRaw);
  const y = parseInt(hashParams.get("y") || "", 10);
  const s = String(hashParams.get("s") || "").toLowerCase();
  const persisted = safeParse(localStorage.getItem(LS_KEY)) || {};
  const def = getViewerDefaultSeason();

  let year;
  if(Number.isFinite(y)){
    year = y;
  }else if(Number.isFinite(persisted.year)){
    year = persisted.year;
  }else if(def && Number.isFinite(def.year)){
    year = def.year;
  }else{
    year = YEAR_MAX;
  }

  let season;
  if(SEASONS.indexOf(s) >= 0){
    season = s;
  }else if(SEASONS.indexOf(persisted.season) >= 0){
    season = persisted.season;
  }else if(def && SEASONS.indexOf(def.season) >= 0){
    season = def.season;
  }else{
    season = "summer";
  }

  year = Math.min(Math.max(year, YEAR_MIN), YEAR_MAX);
  if(els.year) els.year.value = String(year);
  if(els.season) els.season.value = season;

  FILTERS.search = persisted.search || "";
  FILTERS.dupesOnly = !!persisted.dupesOnly;
  FILTERS.sort = persisted.sort || "title-asc";
  FILTERS.achievements = new Set(persisted.achievements || []);
  FILTERS.achMode = persisted.achMode === "all" ? "all" : "any";

  // View + covers (default: table + covers off)
  FILTERS.viewMode = persisted.viewMode === "grid" ? "grid" : "table";
  FILTERS.showCovers = !!persisted.showCovers;

  if(els.search) els.search.value = FILTERS.search;
  if(els.dupesOnly) els.dupesOnly.checked = FILTERS.dupesOnly;
  if(els.sortSel) els.sortSel.value = FILTERS.sort;
  if(els.achModeSel) els.achModeSel.value = FILTERS.achMode;
  if(els.viewModeSel) els.viewModeSel.value = FILTERS.viewMode;
  if(els.coversChk) els.coversChk.checked = FILTERS.showCovers;
}

function persistState(){
  if(!els.year || !els.season) return;
  const payload = {
    year: parseInt(els.year.value, 10),
    season: els.season.value,
    search: FILTERS.search,
    dupesOnly: FILTERS.dupesOnly,
    sort: FILTERS.sort,
    achievements: Array.from(FILTERS.achievements),
    achMode: FILTERS.achMode,
    viewMode: FILTERS.viewMode,
    showCovers: FILTERS.showCovers
  };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
  const sp = new URLSearchParams({ y: String(payload.year), s: payload.season });
  location.hash = sp.toString();
}

function wireEvents(){
  if(els.load){
    els.load.addEventListener("click", () => {
      persistState();
      loadSeason();
    });
  }
  if(els.year){
    els.year.addEventListener("change", () => {
      persistState();
      loadSeason();
    });
  }
  if(els.season){
    els.season.addEventListener("change", () => {
      persistState();
      loadSeason();
    });
  }

  if(els.search){
    els.search.addEventListener("input", debounce(() => {
      FILTERS.search = els.search.value || "";
      persistState();
      render();
    }, 200));
  }

  if(els.theme){
    els.theme.addEventListener("click", () => {
      const html = document.documentElement;
      const cur = html.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      html.setAttribute("data-theme", next);
    });
  }

  if(els.dupesOnly){
    els.dupesOnly.addEventListener("change", () => {
      FILTERS.dupesOnly = els.dupesOnly.checked;
      persistState();
      render();
    });
  }

  if(els.sortSel){
    els.sortSel.addEventListener("change", () => {
      FILTERS.sort = els.sortSel.value;
      persistState();
      render();
    });
  }

  if(els.achModeSel){
    els.achModeSel.addEventListener("change", () => {
      const val = els.achModeSel.value === "all" ? "all" : "any";
      FILTERS.achMode = val;
      persistState();
      render();
    });
  }

  if(els.viewModeSel){
    els.viewModeSel.addEventListener("change", () => {
      const val = els.viewModeSel.value === "grid" ? "grid" : "table";
      FILTERS.viewMode = val;
      persistState();
      render();
    });
  }

  if(els.coversChk){
    els.coversChk.addEventListener("change", () => {
      FILTERS.showCovers = els.coversChk.checked;
      persistState();
      render();
    });
  }

  if(els.clearFiltersBtn){
    els.clearFiltersBtn.addEventListener("click", () => {
      // Clear "filters" only; keep view mode and covers as-is
      FILTERS.search = "";
      FILTERS.dupesOnly = false;
      FILTERS.sort = "title-asc";
      FILTERS.achievements.clear();
      FILTERS.achMode = "any";

      if(els.search) els.search.value = "";
      if(els.dupesOnly) els.dupesOnly.checked = false;
      if(els.sortSel) els.sortSel.value = "title-asc";
      if(els.achModeSel) els.achModeSel.value = "any";

      syncAchChips();
      persistState();
      render();
    });
  }
}

function initialLoad(){ loadSeason(); }

async function loadSeason(){
  if(!els.year || !els.season) return;
  const year = parseInt(els.year.value, 10);
  const season = els.season.value;
  const url = `../data/${year}/${season}.json`;
  if(els.meta) els.meta.textContent = `Loading ${url}…`;
  try{
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) throw new Error(res.status + " " + res.statusText);
    ARTIFACT = await res.json();
    hydrateFromArtifact(ARTIFACT);
    if(els.meta) els.meta.innerHTML = metaText(ARTIFACT, url);
    applySeasonMetaFromConfig(year, season, ARTIFACT);
    persistState();
    render();
  }catch(err){
    ARTIFACT = null;
    ROWS = [];
    if(els.tbody) els.tbody.innerHTML = "";
    if(els.bookGrid) els.bookGrid.innerHTML = "";
    if(els.stats) els.stats.textContent = "—";
    if(els.meta) els.meta.textContent = `Failed to load ${url}: ${err && err.message ? err.message : String(err)}`;
    if(els.achievementsBlock) els.achievementsBlock.innerHTML = "";
    console.error("Season load failed:", err);
  }
}

function metaText(a, url){
  const lists = (a && a.achievements ? a.achievements.length : 0);
  const season = a && a.season && a.season.name ? a.season.name : "—";
  const year = a && a.season && a.season.year ? a.season.year : "—";
  const gen = a && a.generated_at ? a.generated_at : "—";
  return `Season ${escapeHtml(String(season))} ${escapeHtml(String(year))} • ${lists} lists • Generated <code>${escapeHtml(gen)}</code> • Source <code>${escapeHtml(url)}</code>`;
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
          cover: b.cover || "",
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
    cover: r.cover || "",
    achievements: Array.from(r.achievements).sort(),
    isDup: (dupTA[keyTA(r.title, r.author)] || []).length > 1
  }));

  const allAchNames = new Set();
  (a && a.achievements ? a.achievements : []).forEach(ach => allAchNames.add(ach.name));
  buildAchChips(Array.from(allAchNames).sort());
}

function buildAchChips(names){
  if(!els.achFilterWrap) return;
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
  if(!els.achFilterWrap) return;
  const cbs = els.achFilterWrap.querySelectorAll("input[type=checkbox]");
  for(let i=0;i<cbs.length;i++) cbs[i].checked = false;
}

function render(){
  const filtered = applyFilters(ROWS, FILTERS);
  const sorted = sortRows(filtered, FILTERS.sort);

  // View switch
  if(FILTERS.viewMode === "grid"){
    if(els.bookTableWrap) els.bookTableWrap.classList.add("hidden");
    if(els.bookGridWrap) els.bookGridWrap.classList.remove("hidden");
    renderGrid(sorted);
  }else{
    if(els.bookTableWrap) els.bookTableWrap.classList.remove("hidden");
    if(els.bookGridWrap) els.bookGridWrap.classList.add("hidden");
    renderTableRows(sorted);
  }

  renderAchievementsBlock(filtered); // dynamic per-achievement counts based on visible rows
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
    if(f.achMode === "all"){
      // AND semantics: book must contain ALL selected achievements
      out = out.filter(r => {
        const achList = r.achievements || [];
        if(achList.length === 0) return false;
        for(const ach of f.achievements){
          if(!achList.includes(ach)) return false;
        }
        return true;
      });
    }else{
      // "any" (OR) semantics
      out = out.filter(r => r.achievements.some(a => f.achievements.has(a)));
    }
  }

  return out;
}

function sortRows(rows, sortKey){
  const parts = (sortKey || "title-asc").split("-");
  const field = parts[0];
  const dir = parts[1] || "asc";
  const m = dir === "desc" ? -1 : 1;
  const byTitle = (a,b) => a.title.localeCompare(b.title);
  const byAuthor = (a,b) => a.author.localeCompare(b.author);
  const byAchCnt = (a,b) => (a.achievements.length - b.achievements.length);

  const cmp = (a,b) => {
    if(field === "author") return byAuthor(a,b) * m || byTitle(a,b) * m;
    if(field === "achcnt") return byAchCnt(a,b) * m || byTitle(a,b) * m;
    return byTitle(a,b) * m;
  };

  return rows.slice(0).sort(cmp);
}

// ---- Table view ----
function renderTableRows(rows){
  if(!els.tbody) return;
  els.tbody.innerHTML = "";
  let i = 0;
  rows.forEach(r => {
    const tr = document.createElement("tr");
    if(r.isDup) tr.classList.add("dupe");

    const linkOpen = r.link ? '<a class="link" href="'+r.link+'" target="_blank" rel="noopener">' : "";
    const linkClose = r.link ? "</a>" : "";

    let coverSnippet = "";
    if(FILTERS.showCovers){
      if(r.cover && r.link){
        coverSnippet =
          '<a href="'+r.link+'" target="_blank" rel="noopener">' +
          '<img src="'+r.cover+'" alt="" style="width:40px;height:auto;" />' +
          '</a>';
      }else if(r.cover){
        coverSnippet =
          '<img src="'+r.cover+'" alt="" style="width:40px;height:auto;" />';
      }
    }

    const titleSnippet = linkOpen + escapeHtml(r.title) + linkClose;

    const titleCellInner = (coverSnippet
      ? '<div class="title-cell">'+coverSnippet+'<div>'+titleSnippet+'</div></div>'
      : '<div class="title-cell"><div>'+titleSnippet+'</div></div>');

    tr.innerHTML =
      "<td>"+(++i)+"</td>"+
      "<td>"+titleCellInner+"</td>"+
      "<td>"+escapeHtml(r.author)+"</td>"+
      '<td><div class="ach">'+
        r.achievements.map(a => '<span class="pill">'+escapeHtml(a)+'</span>').join(" ")+
      "</div></td>";

    els.tbody.appendChild(tr);
  });

  const dupCount = rows.filter(r => r.isDup).length;
  if(els.stats){
    els.stats.textContent = rows.length + " books · " + dupCount + " duplicates highlighted";
  }
}

// ---- Grid view ----
function renderGrid(rows){
  if(!els.bookGrid) return;
  els.bookGrid.innerHTML = "";
  rows.forEach(r => {
    const card = document.createElement("div");
    card.className = "card";

    if(FILTERS.showCovers && r.cover){
      const coverWrap = document.createElement("div");
      coverWrap.className = "card-cover";
      if(r.link){
        const a = document.createElement("a");
        a.href = r.link;
        a.target = "_blank";
        a.rel = "noopener";
        const img = document.createElement("img");
        img.src = r.cover;
        img.alt = "";
        a.appendChild(img);
        coverWrap.appendChild(a);
      }else{
        const img = document.createElement("img");
        img.src = r.cover;
        img.alt = "";
        coverWrap.appendChild(img);
      }
      card.appendChild(coverWrap);
    }

    const titleDiv = document.createElement("div");
    titleDiv.className = "card-title";
    if(r.link){
      const a = document.createElement("a");
      a.href = r.link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = r.title;
      titleDiv.appendChild(a);
    }else{
      titleDiv.textContent = r.title;
    }
    card.appendChild(titleDiv);

    if(r.author){
      const authorDiv = document.createElement("div");
      authorDiv.className = "card-author";
      authorDiv.textContent = r.author;
      card.appendChild(authorDiv);
    }

    if(r.achievements && r.achievements.length){
      const achDiv = document.createElement("div");
      achDiv.className = "card-ach";
      r.achievements.forEach(a => {
        const span = document.createElement("span");
        span.className = "pill";
        span.textContent = a;
        achDiv.appendChild(span);
      });
      card.appendChild(achDiv);
    }

    els.bookGrid.appendChild(card);
  });

  const dupCount = rows.filter(r => r.isDup).length;
  if(els.stats){
    els.stats.textContent = rows.length + " books · " + dupCount + " duplicates highlighted";
  }
}

// ---- Achievements Block (informational) ----
function getSeasonConfig(year, season){
  if(!VIEWER_CONFIG || !Array.isArray(VIEWER_CONFIG.seasons)) return null;
  const y = parseInt(year, 10);
  const s = String(season || "").toLowerCase();
  return VIEWER_CONFIG.seasons.find(sea =>
    parseInt(sea.year, 10) === y &&
    String(sea.season || "").toLowerCase() === s
  ) || null;
}

function renderAchievementsBlock(filteredRows){
  if(!els.achievementsBlock) return;
  if(!VIEWER_CONFIG || !els.year || !els.season){
    els.achievementsBlock.innerHTML = "";
    return;
  }
  const year = parseInt(els.year.value, 10);
  const season = els.season.value;
  const cfgSeason = getSeasonConfig(year, season);
  if(!cfgSeason){
    els.achievementsBlock.innerHTML = "";
    return;
  }

  const booksRead = cfgSeason.books_read_achievements || [];
  const bookLists = cfgSeason.book_list_achievements || [];

  // Map for visible counts per book-list achievement
  const counts = Object.create(null);
  const rows = filteredRows || [];
  rows.forEach(r => {
    (r.achievements || []).forEach(aName => {
      counts[aName] = (counts[aName] || 0) + 1;
    });
  });

  const wrap = document.createDocumentFragment();

  function createAchItem(entry, count){
    const div = document.createElement("div");
    div.className = "ach-item";

    const iconWrap = document.createElement("a");
    iconWrap.className = "ach-icon-wrap";
    const href = entry.goodreads_url || "#";
    if(href && href !== "#"){
      iconWrap.href = href;
      iconWrap.target = "_blank";
      iconWrap.rel = "noopener";
    }else{
      iconWrap.removeAttribute("href");
    }

    if(entry.icon_url){
      const img = document.createElement("img");
      img.src = entry.icon_url;
      img.alt = entry.name || "";
      iconWrap.appendChild(img);
    }else{
      const span = document.createElement("span");
      span.textContent = "G";
      iconWrap.appendChild(span);
    }

    const name = document.createElement("div");
    name.className = "ach-name";
    name.textContent = entry.name || "";

    const cnt = document.createElement("div");
    cnt.className = "ach-count";

    if(entry.type === "book_list"){
      if(typeof count === "number"){
        cnt.textContent = count + " books visible";
      }else{
        cnt.textContent = "";
      }
    }else{
      cnt.textContent = ""; // Books Read / placeholder: no per-book count
    }

    div.appendChild(iconWrap);
    div.appendChild(name);
    if(cnt.textContent) div.appendChild(cnt);
    return div;
  }

  // Books Read / placeholders first (no counts)
  booksRead.forEach(entry => {
    wrap.appendChild(createAchItem(entry, null));
  });

  // Then book-list achievements, with visible-count based on filtered rows
  bookLists.forEach(entry => {
    const key = entry.artifact_name_match || entry.name;
    const c = key ? (counts[key] || 0) : 0;
    wrap.appendChild(createAchItem(entry, c));
  });

  els.achievementsBlock.innerHTML = "";
  els.achievementsBlock.appendChild(wrap);
}

// ---- utils ----
function keyTA(title, author){
  return (title || "").trim().toLowerCase() + "||" + (author || "").trim().toLowerCase();
}
function slug(s){
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/(^-|-$)/g,"");
}
function escapeHtml(s){
  const str = (s == null) ? "" : String(s);
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
function debounce(fn, ms){
  let t;
  return function(){
    clearTimeout(t);
    const a = arguments;
    const ctx = this;
    t = setTimeout(function(){ fn.apply(ctx,a); }, ms);
  };
}

// ---- Viewer config + bootstrap ----
async function loadViewerConfig(){
  try{
    const res = await fetch("../config/grchallenges_viewer_config.json", { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    VIEWER_CONFIG = data;
    return data;
  }catch(err){
    console.warn("Failed to load viewer config:", err);
    VIEWER_CONFIG = null;
    return null;
  }
}

function getViewerDefaultSeason(){
  if(!VIEWER_CONFIG || !VIEWER_CONFIG.viewer || !VIEWER_CONFIG.viewer.default_season) return null;
  const ds = VIEWER_CONFIG.viewer.default_season;
  const year = parseInt(ds.year, 10);
  const season = String(ds.season || "").toLowerCase();
  if(!Number.isFinite(year) || SEASONS.indexOf(season) < 0) return null;
  return { year, season };
}

function applyViewerStaticFromConfig(){
  if(!VIEWER_CONFIG || !VIEWER_CONFIG.viewer) return;
  const v = VIEWER_CONFIG.viewer;

  if(els.appTitle && v.app_name){
    els.appTitle.textContent = v.app_name;
  }
  if(els.createdByLink && v.created_by_url){
    els.createdByLink.href = v.created_by_url;
  }
  if(els.createdByLink && v.created_by_label){
    const label = v.created_by_label.replace(/^Created by\s*/i, "").trim();
    els.createdByLink.textContent = label || v.created_by_label;
  }
  if(els.createdByCoffeeWrapper){
    if(v.buy_me_a_coffee_url){
      els.createdByCoffeeWrapper.classList.remove("hidden");
      if(els.coffeeLink){
        els.coffeeLink.href = v.buy_me_a_coffee_url;
      }
    }else{
      els.createdByCoffeeWrapper.classList.add("hidden");
    }
  }

  // About block – global text/links
  if(els.aboutDescription && v.description){
    els.aboutDescription.textContent = v.description;
  }
  if(els.aboutDisclaimer && v.disclaimer){
    els.aboutDisclaimer.textContent = v.disclaimer;
  }
  if(els.aboutFeedbackLink && v.feedback_url){
    els.aboutFeedbackLink.href = v.feedback_url;
  }
  if(els.aboutCoffeeLink && v.buy_me_a_coffee_url){
    els.aboutCoffeeLink.href = v.buy_me_a_coffee_url;
  }
  if(els.aboutVersion && v.version){
    els.aboutVersion.textContent = "Viewer version: " + v.version;
  }
}

function applySeasonMetaFromConfig(year, season, artifact){
  if(!VIEWER_CONFIG) return;
  const y = parseInt(year, 10);
  const s = String(season || "").toLowerCase();
  const entry = getSeasonConfig(y, s);

  const seasonName = artifact && artifact.season && artifact.season.name ? artifact.season.name : s;
  const seasonYear = artifact && artifact.season && artifact.season.year ? artifact.season.year : y;
  const generatedAt = artifact && artifact.generated_at ? artifact.generated_at : "";

  if(els.seasonLabel){
    if(entry && entry.challenge_display_name){
      els.seasonLabel.textContent = entry.challenge_display_name;
    }else{
      els.seasonLabel.textContent = (seasonName ? seasonName : s) + " " + (seasonYear || "");
    }
  }

  if(els.aboutSeason){
    let txt = "";
    if(seasonName && seasonYear){
      txt = "Season: " + seasonName + " " + seasonYear;
    }
    if(generatedAt){
      txt += (txt ? " • " : "") + "Generated at: " + generatedAt;
    }
    els.aboutSeason.textContent = txt || "Season and generation info not available.";
  }

  if(els.aboutChallengeLink){
    if(entry && entry.challenge_url){
      els.aboutChallengeLink.href = entry.challenge_url;
    }else{
      els.aboutChallengeLink.removeAttribute("href");
    }
  }
}

function applyAdminVisibility(){
  if(!els.adminBlock) return;
  try{
    const u = new URL(window.location.href);
    const adminParam = u.searchParams.get("admin");
    const show = !!adminParam && adminParam !== "0" && adminParam.toLowerCase() !== "false";
    if(show){
      els.adminBlock.classList.remove("hidden");
    }else{
      els.adminBlock.classList.add("hidden");
    }
  }catch(e){
    console.warn("Failed to parse admin param:", e);
  }
}

// ---- Bootstrap ----
(async function main(){
  await loadViewerConfig();
  applyAdminVisibility();
  bootstrapYears();
  bootstrapSeasons();
  restoreState();
  applyViewerStaticFromConfig();
  wireEvents();
  initialLoad();
})();
