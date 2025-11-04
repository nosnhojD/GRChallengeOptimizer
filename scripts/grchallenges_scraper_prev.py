#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
grchallenges_scraper.py — Goodreads seasonal list scraper (v2, book-id + author enrichment)

- Pass 1: scrape challenge blog pages; extract unique books by Goodreads ID via .js-tooltipTrigger.book
- Pass 2 (configurable): for books missing authors, fetch the book page and fill {title, author, cover}
- Emits JSON to ./data/{year}/{season}.json
- Dedupe: by title+author (legacy) and by book_id (preferred)
- CSV debug (optional) mirrors JSON rows

Config (./config/grchallenges_config.json) can include:

"enrich": {
  "fill_missing_authors": true,
  "max_books_per_achievement": 300,
  "respect_delay_ms": 450
}

CLI (typical):
  py -3.13 scripts\\grchallenges_scraper.py --config .\\config\\grchallenges_config.json --verbose
"""
import argparse, csv, datetime as dt, json, re, sys, time
from pathlib import Path
from typing import Dict, List, Any
from urllib.parse import urljoin, urlparse

# ----- guard old interpreters -----
if sys.version_info < (3, 10):
    sys.exit("This scraper requires Python 3.10+. On Windows, run: py -3.13 scripts\\grchallenges_scraper.py ...")

# ----- bootstrap minimal deps -----
def _ensure(pkg, import_name=None):
    try:
        __import__(import_name or pkg)
    except Exception:
        import subprocess
        # ensure pip exists for this interpreter
        try:
            import ensurepip
            ensurepip.bootstrap()
        except Exception:
            pass
        subprocess.check_call([sys.executable, "-m", "pip", "install", "--upgrade", "pip"])
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg])
        __import__(import_name or pkg)

for p in [("requests", None), ("beautifulsoup4", "bs4")]:
    _ensure(*p)
try:
    __import__("lxml")
    HAVE_LXML = True
except Exception:
    HAVE_LXML = False

import requests
from bs4 import BeautifulSoup

DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36")

BOOK_SHOW_ABS_RE = re.compile(r"^https?://(?:www\.)?goodreads\.com/book/(?:show|details)/\d+")
BOOK_ID_RE       = re.compile(r"/book/(?:show|details)/(\d+)")
IMG_COVER_RE     = re.compile(r"/assets/nocover|/books/|/covers/")

# ---------- Config I/O ----------
def load_config(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    # output settings (required)
    out = cfg.get("output", {})
    if "year" not in out or "season" not in out or "path" not in out:
        raise ValueError("Config.output.{year,season,path} is required (e.g., ./data/{year}/{season}.json).")
    # scrape defaults
    scrape_cfg = cfg.setdefault("scrape", {})
    scrape_cfg.setdefault("respect_delay_ms", 600)
    scrape_cfg.setdefault("user_agent", DEFAULT_UA)
    scrape_cfg.setdefault("save_html", False)
    scrape_cfg.setdefault("html_out_dir", "./requirements/fixtures/html")
    # enrichment defaults
    enrich = cfg.setdefault("enrich", {})
    enrich.setdefault("fill_missing_authors", True)
    enrich.setdefault("max_books_per_achievement", 300)
    enrich.setdefault("respect_delay_ms", 450)
    return cfg

# ---------- HTTP ----------
def make_session(user_agent: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": user_agent or DEFAULT_UA, "Accept-Language": "en-US,en;q=0.9"})
    return s

def http_get_text(session: requests.Session, url: str, timeout=30) -> str:
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text

# ---------- Helpers ----------
def _choose_scope(soup: BeautifulSoup):
    for sel in [".articleBody", ".postBody", ".entry-content", ".content", "article", "#content", "#main", "body"]:
        node = soup.select_one(sel)
        if node:
            return node
    return soup

def _abs(url: str, base_url: str) -> str:
    return url if url.startswith("http") else urljoin(base_url, url)

def _book_id_from_href(href: str) -> str:
    if not href:
        return ""
    m = BOOK_ID_RE.search(href)
    return m.group(1) if m else ""

def _normalize_book_link(href: str, base_url: str) -> str:
    """Normalize to https://www.goodreads.com/book/show/<id> (strip query/hash; coerce /details/→/show/)."""
    full = _abs(href, base_url)
    u = urlparse(full)
    path = re.sub(r"(\?.*|#.*)$", "", u.path)
    m = re.match(r"^(/(?:en/)?book/(?:show|details)/)(\d+)", path)
    if m:
        path = m.group(1).replace("/details/", "/show/") + m.group(2)
    return f"{u.scheme}://{u.netloc}{path}"

# --- Pass 1: core pattern .js-tooltipTrigger.book ---
def _extract_tooltip_triggers(html: str, base_url: str, verbose: bool=False) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml" if HAVE_LXML else "html.parser")
    scope = _choose_scope(soup)

    cards = scope.select(".js-tooltipTrigger.book")
    if verbose:
        print(f"[parse] tooltip-triggers found: {len(cards)}")

    out: Dict[str, Dict[str, Any]] = {}
    for c in cards:
        a = c.select_one("a[href*='/book/']")
        if not a:
            continue
        href = a.get("href") or ""
        link = _normalize_book_link(href, base_url)
        if not BOOK_SHOW_ABS_RE.match(link):
            continue

        gr_id = _book_id_from_href(link)
        if not gr_id:
            continue

        # Title from image alt (most reliable on these pages), fallback to anchor text
        title = ""
        img = c.select_one("img")
        if img and img.get("alt"):
            title = img["alt"].strip()
        if not title:
            title = (a.get("title") or a.get_text(" ", strip=True) or "").strip()
        if not title:
            continue

        # Author is often missing in the blog card (we enrich later)
        author = ""
        at = c.select_one("a[href*='/author/show/'], .authorName, a.authorName, .author, .byline, [itemprop='author']")
        if at:
            author = at.get_text(" ", strip=True)

        cover = ""
        if img and img.get("src") and IMG_COVER_RE.search(img["src"]):
            cover = img["src"]

        if gr_id not in out:
            out[gr_id] = {"title": title, "author": author, "link": link, "cover": cover, "gr_id": gr_id}

    if verbose:
        print(f"[parse] tooltip unique (by book id): {len(out)}")
    return list(out.values())

# --- Pass 1b: generic fallback (used only if tooltip finds nothing) ---
def _extract_generic_scoped(html: str, base_url: str, verbose: bool=False) -> List[Dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml" if HAVE_LXML else "html.parser")
    scope = _choose_scope(soup)
    results: Dict[str, Dict[str, Any]] = {}

    containers = scope.select(".gr-list li, ol li, .listCard, .bookCard, article, figure, .bookBox")
    for card in containers:
        a = card.select_one("a[href*='/book/']")
        if not a:
            continue
        href = a.get("href") or ""
        link = _normalize_book_link(href, base_url)
        if not BOOK_SHOW_ABS_RE.match(link):
            continue

        gr_id = _book_id_from_href(link)
        if not gr_id:
            continue

        title = (a.get("title") or
                 (card.select_one(".bookTitle, em, i").get_text(" ", strip=True) if card.select_one(".bookTitle, em, i") else "") or
                 a.get_text(" ", strip=True) or "").strip()
        if not title:
            img = card.select_one("img")
            if img and img.get("alt"):
                title = img["alt"].strip()
        if not title:
            continue

        author = ""
        at = card.select_one("a[href*='/author/show/'], .authorName, a.authorName, .author, .byline, [itemprop='author']")
        if at:
            author = at.get_text(" ", strip=True)

        cover = ""
        img = card.select_one("img")
        if img and img.get("src") and IMG_COVER_RE.search(img["src"]):
            cover = img["src"]

        if gr_id not in results:
            results[gr_id] = {"title": title, "author": author, "link": link, "cover": cover, "gr_id": gr_id}

    if verbose:
        print(f"[parse] generic fallback unique (by book id): {len(results)}")
    return list(results.values())

# --- Pass 2: enrichment on the actual book page (fills author/title/cover robustly) ---
def _get_og(soup: BeautifulSoup, prop: str) -> str:
    tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    return tag.get("content", "").strip() if tag and tag.get("content") else ""

def _scrape_book_page(session: requests.Session, book_url: str) -> Dict[str, str]:
    try:
        html = http_get_text(session, book_url, timeout=30)
    except Exception:
        return {"title":"", "author":"", "cover":"", "link":book_url}
    soup = BeautifulSoup(html, "lxml" if HAVE_LXML else "html.parser")

    og_title = _get_og(soup, "og:title")
    og_image = _get_og(soup, "og:image")

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
        a = soup.select_one("a.authorName, [data-testid='name'], .ContributorLinksList a, a[href*='/author/show/']")
        if a: author = a.get_text(" ", strip=True)

    cover = og_image or ""
    if not cover:
        img = soup.select_one("#coverImage, img.BookCover__image")
        if img and img.get("src"): cover = img["src"]

    return {"title": title, "author": author, "cover": cover, "link": book_url}

def enrich_books(session: requests.Session, books: List[Dict[str, Any]], respect_delay_ms: int, cap: int, verbose: bool) -> int:
    """Fill missing authors (and normalize title/cover) by visiting the book page."""
    filled = 0
    count = 0
    for b in books:
        if count >= cap:
            break
        need = not b.get("author")
        if not need:
            continue
        info = _scrape_book_page(session, b["link"])
        # prefer enrichment values when present
        if info.get("title"):  b["title"] = info["title"]
        if info.get("author"): b["author"] = info["author"]
        if info.get("cover"):  b["cover"] = info["cover"]
        filled += 1 if info.get("author") else 0
        count  += 1
        time.sleep(max(0, respect_delay_ms) / 1000.0)
    if verbose:
        print(f"[enrich] visited {count} book pages; filled authors for {filled} items")
    return filled

# ---------- Dedupe ----------
def build_duplicates_maps(achievements: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    by_title_author: Dict[tuple, Dict[str, Any]] = {}
    by_id: Dict[str, Dict[str, Any]] = {}
    for ach in achievements:
        nm = ach["name"]
        for b in ach.get("books", []):
            key_ta = (b.get("title","").strip().lower(), b.get("author","").strip().lower())
            if key_ta[0]:
                rec = by_title_author.setdefault(key_ta, {"title": b.get("title",""), "author": b.get("author",""), "achievements": set()})
                rec["achievements"].add(nm)
            gid = (b.get("gr_id") or "").strip()
            if gid:
                rec2 = by_id.setdefault(gid, {"gr_id": gid, "title": b.get("title",""), "author": b.get("author",""), "achievements": set()})
                rec2["achievements"].add(nm)

    dupes_ta = []
    for (_t,_a), rec in by_title_author.items():
        if len(rec["achievements"]) > 1:
            dupes_ta.append({"title": rec["title"], "author": rec["author"], "achievements": sorted(rec["achievements"])})
    dupes_ta.sort(key=lambda d: (d["title"].lower(), d["author"].lower()))

    dupes_id = []
    for gid, rec in by_id.items():
        if len(rec["achievements"]) > 1:
            dupes_id.append({"gr_id": gid, "title": rec["title"], "author": rec["author"], "achievements": sorted(rec["achievements"])})
    dupes_id.sort(key=lambda d: (d["title"].lower(), d["author"].lower()))

    return {
        "duplicates_by_title_author": dupes_ta,
        "duplicates_by_book_id": dupes_id
    }

# ---------- Main scrape ----------
def scrape(cfg: dict, only: List[str], dry_run: bool, verbose: bool, save_html_flag: bool, dump_map: bool) -> Dict[str, Any]:
    out_year = cfg["output"]["year"]
    out_season = cfg["output"]["season"]
    out_path_tmpl = cfg["output"]["path"]
    scrape_cfg = cfg.get("scrape", {})
    delay_ms = int(scrape_cfg.get("respect_delay_ms", 600))
    ua = scrape_cfg.get("user_agent", DEFAULT_UA)
    save_html = bool(scrape_cfg.get("save_html", False) or save_html_flag)
    html_dir = Path(scrape_cfg.get("html_out_dir", "./requirements/fixtures/html"))
    if save_html:
        html_dir.mkdir(parents=True, exist_ok=True)

    enrich_cfg = cfg.get("enrich", {})
    enrich_authors = bool(enrich_cfg.get("fill_missing_authors", True))
    enrich_cap = int(enrich_cfg.get("max_books_per_achievement", 300))
    enrich_delay = int(enrich_cfg.get("respect_delay_ms", 450))

    session = make_session(ua)

    # Filter achievements
    ach_list = [a for a in cfg.get("achievements", []) if a.get("enabled", True)]
    if only:
        only_set = {s.strip().lower() for s in only}
        ach_list = [a for a in ach_list if a["name"].strip().lower() in only_set]

    achievements_out = []
    for ach in ach_list:
        name = ach["name"]
        url = ach["url"]
        lo = int(ach.get("expected_min", 0))
        hi = int(ach.get("expected_max", 10**9))

        if verbose:
            print(f"[scrape] {name}: GET {url}")

        html = ""
        if not dry_run:
            html = http_get_text(session, url, timeout=30)
            if save_html:
                safe = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_")
                html_dir.mkdir(parents=True, exist_ok=True)
                (html_dir / f"{out_year}_{out_season}_{safe}.html").write_text(html, encoding="utf-8")

        # Pass 1: tooltip triggers (or generic fallback)
        books = [] if dry_run else _extract_tooltip_triggers(html, url, verbose=verbose)
        if not books and not dry_run:
            books = _extract_generic_scoped(html, url, verbose=verbose)

        # Pass 2: enrichment
        if enrich_authors and not dry_run:
            filled = enrich_books(session, books, respect_delay_ms=enrich_delay, cap=enrich_cap, verbose=verbose)
            if verbose:
                print(f"[scrape] enriched authors: {filled}")

        if verbose:
            print(f"[scrape]  -> found {len(books)}")

        if not (lo <= len(books) <= hi):
            print(f"[warn] '{name}' returned {len(books)} (expected {lo}-{hi}). Verify URL/layout.")

        achievements_out.append({
            "name": name,
            "source_url": url,
            "book_count": len(books),
            "books": books
        })

        time.sleep(delay_ms / 1000.0)

    artifact = {
        "season": {"year": out_year, "name": out_season},
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),
        "achievements": achievements_out,
        "dedupe": build_duplicates_maps(achievements_out)
    }

    out_path = out_path_tmpl.format(year=out_year, season=out_season)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, ensure_ascii=False, indent=2)
    print(f"[ok] Wrote JSON: {out_path}")

    # Optional CSV debug export (flattened view)
    csv_debug = cfg.get("csv_debug_path")
    if csv_debug:
        rows = []
        for ach in achievements_out:
            for b in ach["books"]:
                rows.append({
                    "SeasonName": out_season,
                    "SeasonYear": out_year,
                    "Achievement": ach["name"],
                    "Title": b.get("title",""),
                    "Author": b.get("author",""),
                    "Link": b.get("link",""),
                    "Cover": b.get("cover",""),
                    "GR_ID": b.get("gr_id",""),
                    "SourceURL": ach["source_url"]
                })
        with open(csv_debug, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                               ["SeasonName","SeasonYear","Achievement","Title","Author","Link","Cover","GR_ID","SourceURL"])
            w.writeheader()
            w.writerows(rows)
        print(f"[ok] Wrote CSV debug: {csv_debug}")

    if dump_map:
        print("\n=== Sample titles per achievement (first 5) ===")
        for ach in artifact.get("achievements", []):
            print(f"- {ach['name']} ({ach['book_count']}):")
            for b in ach.get("books", [])[:5]:
                print(f"   · {b.get('title','')} — {b.get('author','')}")

    return artifact

def main():
    ap = argparse.ArgumentParser(description="Goodreads Seasonal Challenge Scraper (v2 JSON, enrichment)")
    ap.add_argument("--config", default="./config/grchallenges_config.json")
    ap.add_argument("--only", default="", help="Comma-separated achievement names to scrape")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--save-html", action="store_true", help="Force-save raw HTML regardless of config")
    ap.add_argument("--dump-map", action="store_true",
                    help="After scrape, print first 5 titles per achievement for sanity-checking")
    args = ap.parse_args()

    cfg = load_config(args.config)
    only = [s for s in args.only.split(",") if s.strip()] if args.only else []
    scrape(cfg, only, args.dry_run, args.verbose, args.save_html, args.dump_map)

if __name__ == "__main__":
    main()
