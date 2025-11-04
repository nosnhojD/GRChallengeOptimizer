# Goodreads Challenges — Feature Roadmap & Prioritization
_Last updated: 2025-10-19_

This document summarizes current and planned features across the **Goodreads Challenges Scraper and Viewer** project.  
It acts as a living roadmap describing core architecture decisions, priorities, and interdependencies.

---

## 🧭 Project Overview

The system currently consists of:
- **Scraper (`scripts/grchallenges_scraper.py`)** — v2 implementation that extracts list-based challenges, enriches missing author data, and emits `data/{year}/{season}.json`.
- **Viewer (`viewer/grchallenges_viewer.html`)** — interactive table-based web UI supporting dark/light themes, search, and duplicate highlighting.
- **Config (`config/grchallenges_config.json`)** — runtime definition of scraper behavior, target season, and achievements.

This roadmap documents enhancements planned for **v3 and beyond**, grouped by domain.

---

## 🟣 Scraper & Compiler Enhancements

| ID | Title | Summary | Status |
|----|--------|----------|--------|
| **S-1** | **Split scraper output into per-achievement files** | Each achievement will generate its own JSON artifact (e.g. `/data/{year}/{season}/achievements/<sanitized_name>.json`) enabling partial re-scrapes and reduced runtime. | 🟡 Planned |
| **S-2** | **Season compiler script (`grchallenges_compile.py`)** | New standalone script that merges per-achievement files, computes cross-achievement dedupe maps, and emits the final season file (`/data/{year}/{season}.json`). | 🟡 Planned |
| **S-3** | **Schema evolution for "count" achievements** | Extend config and compiler logic to handle “read X books” type achievements as summary metadata (not list-based). | 🔵 Backlog |
| **S-4** | **Retry / recovery logic for enrichment** | Implement retry queue for failed author lookups with exponential backoff. | 🔵 Backlog |
| **S-5** | **Remove CSV paths and export logic** | Deprecate `csv_debug_path` in the config and remove all CSV export logic from the scraper and viewer. JSON will be the sole data format going forward. | 🟢 Near-term |

---

## 🟢 Viewer Enhancements

| ID | Title | Summary | Status |
|----|--------|----------|--------|
| **V-1** | **Multi-achievement visualization** | Highlight books appearing in multiple challenges; add visual grouping, numeric badges, or sort by overlap count. | 🟡 Planned |
| **V-2** | **Cover image display toggle** | Add a user toggle (persisted via `localStorage`) for showing/hiding book covers. Include a global system override. | 🟡 Planned |
| **V-3** | **Achievement summary view** | Introduce a season overview panel showing all achievements, including “count” type ones, before the detailed book list. | 🟡 Planned |
| **V-4** | **Responsive layout polish** | Improve mobile/tablet layouts; refine column scaling and card-based display mode. | 🔵 Backlog |

---

## 🟠 Config, Schema & Developer Tools

| ID | Title | Summary | Status |
|----|--------|----------|--------|
| **C-1** | **VS Code launch presets** | Create `.vscode/launch.json` with predefined tasks: full scrape, single achievement scrape, dry-run with HTML save, and season compile. | 🟢 Near-term |
| **C-2** | **Enhanced config schema validation** | Add JSON Schema definition for `grchallenges_config.json` to support validation and IDE autocompletion. | 🔵 Backlog |
| **C-3** | **Environment-aware paths** | Support overriding data/config paths via environment variables for deployment. | 🔵 Backlog |

---

## 💰 Monetization & Hosting

| ID | Title | Summary | Status |
|----|--------|----------|--------|
| **M-1** | **Monetization features** | Integrate affiliate links, ad placeholders, or “Buy Me a Coffee” button to support hosting costs. | 🔵 Backlog |
| **H-1** | **Page hosting & business setup** | Prepare for static hosting (e.g., GitHub Pages or Netlify). Formalize branding and lightweight business entity. | 🔵 Backlog |
| **L-1** | **Legal pages** | Add Privacy Policy, Terms of Use, and Attribution notices. | 🔵 Backlog |

---

## ⚙️ Infrastructure & Integration

| ID | Title | Summary | Status |
|----|--------|----------|--------|
| **G-1** | **GitHub ↔ ChatGPT integration** | Connect GitHub repo to ChatGPT project to allow code diffs, branch operations, and file sync directly from conversations. | 🟢 Near-term |

---

## 🔗 Interdependency Summary

| Feature | Depends On | Enables |
|----------|-------------|---------|
| **S-1** | — | S-2, faster iteration for all downstream steps |
| **S-2** | S-1 | Provides season-level data for Viewer |
| **S-5** | S-1/S-2 | Simplifies output pipeline, removes redundant data format |
| **V-1** | S-2 | Core user-facing feature using dedupe data |
| **V-3** | S-2 + config updates | Enables summary overview and count-type tracking |
| **V-2** | Existing cover data | Independent visual enhancement |
| **C-1** | Existing scraper | Simplifies execution for all dev tasks |
| **M/H/L** | Hosting platform | Monetization and legal structure |

---

## 🗓 Suggested Implementation Sequence

1. **Phase 1 – Architecture Backbone**
   - Implement S-1 and S-2 (scraper split + compiler)
   - Implement S-5 (remove CSV support)
   - Update config schema accordingly

2. **Phase 2 – Viewer Enhancements**
   - Implement V-1 (multi-achievement visualization)
   - Add V-2 (cover toggle)
   - Prepare groundwork for V-3 (summary view)

3. **Phase 3 – Developer Workflow**
   - Add launch presets (C-1)
   - Integrate GitHub ↔ ChatGPT connection (G-1)

4. **Phase 4 – Public Hosting & Monetization**
   - Prepare hosting environment
   - Add legal and monetization layers (M-1 / H-1 / L-1)

---

## 📌 Notes

- All structural changes must preserve backward compatibility with existing season JSON files.
- Viewer and scraper should remain functional in a local, offline context for reproducibility.
- Raw HTML fixtures for each achievement should continue to be saved to `requirements/fixtures/html` when `save_html=true` or `--save-html` is passed.
- CSV export and config references are deprecated as of v3; JSON is now the canonical format for all outputs.

---

_This document will be maintained in coordination with the Task Tracker and automatically updated after major roadmap discussions._
