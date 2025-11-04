#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Season Compiler for Goodreads Challenges (simple schema)

Canonical config schema (v1) — see requirements/config_schema.md
- Read season metadata ONLY from output.{year,season}
- Read/write directories:
  - Per-achievement input dir: ./data/{year}/{season}/achievements (unless compile.input_dir overrides)
  - Season file path: output.path with {year}/{season} tokens (lowercased)
"""

import os, json, argparse, datetime
from glob import glob


def utc_now_z():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00','Z')


def parse_args():
    ap = argparse.ArgumentParser(description="Compile per-achievement JSONs into a season JSON (simple schema)")
    ap.add_argument("-c", "--config", default="config/grchallenges_config.json",
                    help="Path to grchallenges_config.json")
    ap.add_argument("--input-dir", help="Override achievements input dir (defaults to compile.input_dir or derived)")
    ap.add_argument("--out", help="Override season JSON output path (defaults to output.path)")
    ap.add_argument("-v", "--verbose", action="store_true")
    return ap.parse_args()


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    if "output" not in cfg or "year" not in cfg["output"] or "season" not in cfg["output"] or "path" not in cfg["output"]:
        raise SystemExit("Config must include output.year, output.season, and output.path (see requirements/config_schema.md)")
    return cfg


def season_meta(cfg):
    y = str(cfg["output"]["year"]).strip()
    n = str(cfg["output"]["season"]).strip()
    return {"year": y, "name": n, "year_l": y.lower(), "name_l": n.lower()}


def derive_input_dir(cfg):
    s = season_meta(cfg)
    override = (cfg.get("compile", {}) or {}).get("input_dir")
    return override or os.path.join("data", s["year_l"], s["name_l"], "achievements")


def derive_output_path(cfg):
    s = season_meta(cfg)
    tpl = cfg["output"]["path"]
    out = tpl.replace("{year}", s["year_l"]).replace("{season}", s["name_l"])
    return out


def read_achievement_files(input_dir, verbose=False):
    files = sorted(glob(os.path.join(input_dir, "*.json")))
    if verbose:
        print(f"[compile] Reading {len(files)} achievement files from: {input_dir}")
    data = []
    for fp in files:
        try:
            with open(fp, "r", encoding="utf-8") as f:
                obj = json.load(f)
            if not all(k in obj for k in ("name","books")):
                if verbose:
                    print(f"  ! Skipping malformed file: {fp}")
                continue
            data.append(obj)
        except Exception as e:
            if verbose:
                print(f"  ! Error reading {fp}: {e}")
    return data


def norm(s):
    return (s or "").strip().lower()


def build_dedupe_index(achievements):
    index = {}
    for ach in achievements:
        aname = ach.get("name","")
        for b in ach.get("books", []):
            k = (norm(b.get("title")), norm(b.get("author")))
            if k not in index:
                index[k] = {"title": (b.get("title") or "").strip(),
                            "author": (b.get("author") or "").strip(),
                            "achievements": []}
            if aname not in index[k]["achievements"]:
                index[k]["achievements"].append(aname)
    return [v for v in index.values() if len(v["achievements"]) > 1]


def to_season_json(season_meta, achievements):
    ach_entries = []
    for a in achievements:
        ach_entries.append({
            "name": a["name"],
            "source_url": a.get("source_url",""),
            "book_count": a.get("book_count", len(a.get("books",[]))),
            "books": [
                {
                    "title": (b.get("title") or "").strip(),
                    "author": (b.get("author") or "").strip(),
                    "link": b.get("link",""),
                    "cover": b.get("cover","")
                } for b in a.get("books",[])
            ]
        })
    return {
        "season": {"year": season_meta["year"], "name": season_meta["name"]},
        "generated_at": utc_now_z(),
        "achievements": ach_entries,
        "dedupe": {"duplicates_by_title_author": build_dedupe_index(achievements)}
    }


def write_json(path, data, verbose=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    if verbose:
        print(f"[compile] Wrote {path}")


def main():
    args = parse_args()
    cfg = load_config(args.config)

    s = season_meta(cfg)
    input_dir = args.input_dir or derive_input_dir(cfg)
    out_path = args.out or derive_output_path(cfg)

    achievements = read_achievement_files(input_dir, verbose=args.verbose)
    if not achievements:
        raise SystemExit(f"No achievement JSON files found in {input_dir}")

    season_json = to_season_json({"year": s["year"], "name": s["name"]}, achievements)
    write_json(out_path, season_json, verbose=args.verbose)

    if args.verbose:
        total_books = sum(a.get("book_count", len(a.get("books",[]))) for a in achievements)
        print(f"[compile] Achievements: {len(achievements)} | Total listed books: {total_books}")
        print(f"[compile] Duplicates entries: {len(season_json['dedupe']['duplicates_by_title_author'])}")


if __name__ == "__main__":
    main()
