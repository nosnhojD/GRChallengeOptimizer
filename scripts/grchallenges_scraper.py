#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Goodreads Seasonal Challenge Scraper (config-driven, simple schema)

Canonical config schema (v1) — see requirements/config_schema.md
- Season metadata lives under output.{year, season}
- Per-achievement JSONs go to ./data/{year}/{season}/achievements/
- Compiler will merge to output.path (e.g., ./data/{year}/{season}.json)

Extraction approach (finalized):
- Prefer DOM-ordered [data-resource-id] list items within <article>
- Fallback: DOM-ordered anchors that are *relative* /book/(show|details)/ID (to avoid intro absolute links)
"""
import sys, csv, time, re, json, argparse, os, datetime
from urllib.parse import urljoin


def _ensure(pkg, import_name=None):
    try:
        __import__(import_name or pkg)
    except ImportError:
        import subprocess
        print(f"Installing {pkg} …")
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])
        __import__(import_name or pkg)


for p in [("requests", None), ("beautifulsoup4", "bs4")]:
    _ensure(*p)

import requests
from bs4 import BeautifulSoup

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})

HEADERS = ["Book","Author","Achievement","Active Dates","Source","Link","Cover","Season"]
BOOK_HREF = re.compile(r"^/book/(?:show|details)/(\d+)")  # relative-only


# -------------------------- Config helpers --------------------------

def utc_now_z() -> str:
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    if "output" not in cfg:
        raise ValueError("Config missing 'output' block (see requirements/config_schema.md)")
    if "year" not in cfg["output"] or "season" not in cfg["output"]:
        raise ValueError("Config 'output' must include 'year' and 'season'")
    return cfg


def season_meta(cfg):
    y = str(cfg["output"]["year"]).strip()
    n = str(cfg["output"]["season"]).strip()
    return {"year": y, "name": n, "year_l": y.lower(), "name_l": n.lower()}


def per_achievement_dir(cfg):
    s = season_meta(cfg)
    override = (cfg.get("compile", {}) or {}).get("input_dir")
    return override or os.path.join("data", s["year_l"], s["name_l"], "achievements")


# -------------------------- HTTP + parsing --------------------------

def parse_args():
    ap = argparse.ArgumentParser(description="Goodreads Seasonal Challenge Scraper (simple schema)")
    ap.add_argument("-c", "--config", default="config/grchallenges_config.json", help="Path to config JSON")
    ap.add_argument("--only", action="append", help="Scrape only these achievement names (can repeat)")
    ap.add_argument("--dry-run", action="store_true", help="Preflight: don't scrape book pages or write CSV/JSON")
    ap.add_argument("--save-html", action="store_true", help="Save fetched blog HTML (for debugging)")
    ap.add_argument("-v", "--verbose", action="store_true", help="Verbose logging")
    return ap.parse_args()


def safe_slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").strip().lower()).strip("_")


def get(url, timeout=30):
    r = SESSION.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text


def get_og(soup, prop):
    tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    return tag.get("content", "").strip() if tag and tag.get("content") else ""


def scrape_book_page(book_url):
    try:
        html = get(book_url)
    except Exception:
        return {"title":"", "author":"", "cover":"", "link":book_url}
    soup = BeautifulSoup(html, "html.parser")
    og_title = get_og(soup, "og:title")
    og_image = get_og(soup, "og:image")
    title, author = "", ""
    if og_title:
        parts = og_title.split(" by ")
        if len(parts) >= 2:
            title = parts[0].strip()
            author = parts[1].split("|")[0].strip()
        else:
            title = og_title.replace("| Goodreads", "").strip()
    if not title:
        t = soup.select_one("h1#bookTitle, h1[data-testid='bookTitle']")
        if t: title = t.get_text(" ", strip=True)
    if not author:
        a = soup.select_one("a.authorName, [data-testid='name'], .ContributorLinksList a")
        if a: author = a.get_text(" ", strip=True)
    cover = og_image or ""
    if not cover:
        img = soup.select_one("#coverImage, img.BookCover__image")
        if img and img.get("src"): cover = img["src"]
    return {"title": title, "author": author, "cover": cover, "link": book_url}


# -------------------------- Core extraction --------------------------

def _resource_ids_in_dom_order(article):
    out, seen = [], set()
    for node in article.select("[data-resource-id]"):
        bid = node.get("data-resource-id")
        if bid and bid.isdigit() and bid not in seen:
            seen.add(bid)
            out.append(bid)
    return out


def _anchors_in_dom_order(article):
    """Fallback: only accept *relative* /book/(show|details)/ID links to avoid intro absolute links."""
    out, seen = [], set()
    for a in article.find_all("a", href=True):
        href = a["href"].strip()
        if not href.startswith("/book/"):
            continue
        m = BOOK_HREF.match(href)
        if m:
            bid = m.group(1)
            if bid not in seen:
                seen.add(bid)
                out.append(bid)
    return out


def extract_book_links_from_blog(html):
    soup = BeautifulSoup(html, "html.parser")
    article = soup.select_one("article") or soup

    ids = _resource_ids_in_dom_order(article)
    if not ids:
        ids = _anchors_in_dom_order(article)

    if not ids:
        print("    WARNING: no book IDs found in article.")
    else:
        print(f"    -> using ordered unique IDs: {len(ids)}")

    return [f"https://www.goodreads.com/book/show/{bid}" for bid in ids]


# -------------------------- Output --------------------------

def write_achievement_json(path, season, ach_name, source_url, book_rows):
    data = {
        "generated_at": utc_now_z(),
        "season": {"year": season["year"], "name": season["name"]},
        "name": ach_name,
        "source_url": source_url or "",
        "book_count": len(book_rows),
        "books": [
            {
                "title": r.get("Book",""),
                "author": r.get("Author",""),
                "link": r.get("Link",""),
                "cover": r.get("Cover","")
            } for r in book_rows
        ]
    }
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# -------------------------- Main --------------------------

def parse_args_only_enabled(all_achs, only_names):
    if only_names:
        wanted = {n.strip().lower() for n in only_names}
        return [a for a in all_achs if a["name"].strip().lower() in wanted]
    return [a for a in all_achs if a.get("enabled", True)]


def main():
    args = parse_args()
    cfg = load_config(args.config)

    s = season_meta(cfg)
    ach_dir = per_achievement_dir(cfg)
    season_label = f"{s['name']} {s['year']}".strip()

    sources = parse_args_only_enabled(cfg["achievements"], args.only)
    rows_all = []
    output_csv = cfg.get("csv_debug_path", "goodreads_summer_challenge.csv")

    for src in sources:
        name = src["name"]
        url = src["url"]
        dates = src.get("active_dates", "")

        print(f"Fetching: {name} — {url}")
        try:
            html = get(url)
            if args.save_html:
                fn = f"{safe_slug(name)}.html"
                with open(fn, "w", encoding="utf-8") as f:
                    f.write(html)

            links = extract_book_links_from_blog(html)
            print(f"  Found {len(links)} direct book links.")

            if args.dry_run:
                continue

            rows_i = []
            for i, burl in enumerate(links, 1):
                info = scrape_book_page(burl)
                if not info["title"] or not info["author"]:
                    continue
                rows_i.append({
                    "Book": info["title"],
                    "Author": info["author"],
                    "Achievement": name,
                    "Active Dates": dates,
                    "Source": url,
                    "Link": info["link"],
                    "Cover": info["cover"],
                    "Season": season_label
                })
                rows_all.append(rows_i[-1])
                if i % 5 == 0:
                    time.sleep(0.6)

            ach_path = os.path.join(ach_dir, f"{safe_slug(name)}.json")
            write_achievement_json(ach_path, s, name, url, rows_i)
            print(f"  Wrote per-achievement JSON: {ach_path} ({len(rows_i)} books)")

        except Exception as e:
            print(f"  ERROR scraping {url}: {e}")

    if args.dry_run:
        print(f"\nDry run complete. Parsed {len(rows_all)} rows (no CSV/JSON written).")
        return

    # Legacy CSV (to be removed later)
    with open(output_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADERS)
        w.writeheader()
        for r in rows_all:
            w.writerow(r)

    print(f"\nDone. Wrote {output_csv} with {len(rows_all)} rows.")
    print("Per-achievement JSON files emitted under:", ach_dir)


if __name__ == "__main__":
    main()
