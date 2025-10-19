# Goodreads Challenge Scraper and Viewer

A modular, config-driven system that automates the collection and visualization of **Goodreads Seasonal Reading Challenges**.  
It scrapes challenge pages, compiles book lists into structured JSON, and displays them in an interactive viewer that highlights duplicate titles across multiple challenges.

---

## 📚 Overview

Goodreads publishes seasonal challenges (Spring, Summer, Fall, Winter), each containing several mini-challenges.  
This project focuses on *list-based* challenges—those providing specific book lists rather than “read X books” goals.

### Core Features
- **Python scraper (`scripts/grchallenges_scraper.py`)**
  - Reads configuration from `config/grchallenges_config.json`
  - Extracts book data from multiple Goodreads blog pages
  - Handles different HTML layouts
  - Outputs a season JSON file (e.g., `data/2025/summer.json`)
  - Optional debug CSV export

- **Web viewer (`viewer/grchallenges_viewer.html/js`)**
  - Loads JSON automatically (no manual import)
  - Sorting, filtering, dark/light modes, and duplicate highlighting
  - Season/year switcher

---

## 🧩 Folder Structure
Goodreads Challenge/
├─ config/
│ └─ grchallenges_config.json
├─ scripts/
│ └─ grchallenges_scraper.py
├─ viewer/
│ ├─ grchallenges_viewer.html
│ └─ grchallenges_viewer.js
├─ data/
│ └─ {year}/
│ ├─ spring.json
│ ├─ summer.json
│ ├─ fall.json
│ └─ winter.json
├─ requirements/
│ └─ scraping_html_patterns.md
├─ tests/
│ └─ test_scraper.py
├─ README.md
├─ LICENSE
└─ .gitignore


---

## ⚙️ Usage

### Run the scraper
```bash
python scripts/grchallenges_scraper.py \
  --config config/grchallenges_config.json \
  --only "Chart Toppers, Debut Darlings" \
  --verbose
View results

Open viewer/grchallenges_viewer.html in a browser.
Use the dropdowns to switch between seasons and years.

🧪 Development

Python ≥ 3.13

Recommended: VS Code
 with the official ChatGPT: Work with Apps extension

Dependencies: requests, beautifulsoup4 (if used)

Linting: ruff or flake8

Tests: pytest

📄 Requirements Documentation

All known Goodreads HTML patterns are tracked in
requirements/scraping_html_patterns.md with selectors, pitfalls, and test coverage.

🚀 Roadmap

 Viewer year/season switcher

 Config schema validation

 More HTML pattern fixtures

 CSV debug export toggle

 Optional GitHub Pages hosting

 Monetization (ads or affiliate links)
