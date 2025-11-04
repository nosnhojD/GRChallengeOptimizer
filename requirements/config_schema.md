# grchallenges_config.json — Canonical Schema (v1)

> **Decision:** We are standardizing on a single, simple schema. No legacy/alternate locations. All season metadata lives under `output.*`.

## Top-level

* `run_label` (string) — optional; free-form label for the run.
* `output` (object) — **required**

  * `year` (string | integer) — **required**. Example: `2025`.
  * `season` (string) — **required**. One of `Spring | Summer | Fall | Winter` (case-insensitive in code, but store in title case).
  * `path` (string) — **required**. Template for the compiled season JSON. Supports tokens `{year}` and `{season}` which will be lowercased when substituted. Example: `"./data/{year}/{season}.json"` → `./data/2025/fall.json`.
* `csv_debug_path` (string) — optional; legacy CSV output path. Will be removed later.
* `scrape` (object) — **required**

  * `respect_delay_ms` (integer) — polite delay between requests.
  * `user_agent` (string) — UA string to send.
  * `save_html` (boolean) — save fetched HTML pages to `html_out_dir`.
  * `html_out_dir` (string) — where to save raw HTML if `save_html=true`.
* `compile` (object) — optional

  * `input_dir` (string) — override where per-achievement JSONs are read/written. If omitted, defaults to `./data/{year}/{season}/achievements`.
* `achievements` (array<object>) — **required**

  * `enabled` (boolean) — whether to scrape.
  * `name` (string) — **required**.
  * `url` (string) — **required**.
  * `expected_min` (integer) — optional (for sanity checks only).
  * `expected_max` (integer) — optional.
  * `release_date` (ISO date string) — optional; informational.

## Derived paths

Given:

```json
{
  "output": { "year": 2025, "season": "Fall", "path": "./data/{year}/{season}.json" }
}
```

* **Per-achievement directory (scraper):** `./data/2025/fall/achievements/`
  (lowercased substitutions)
* **Season file (compiler):** `./data/2025/fall.json`

## Rules

* The scraper **must** read season metadata only from `output.year` and `output.season`.
* The compiler **must** read season metadata only from `output.year` and `output.season`, and write the compiled file to the path formed by substituting `{year}` and `{season}` into `output.path` (lowercased substitutions).
* If `compile.input_dir` is present, both the scraper (write) and compiler (read) use it. Otherwise, they derive the default path `./data/{year}/{season}/achievements/`.
* No support for legacy `season` at the root.

## Notes

* All filesystem substitutions for `{year}` and `{season}` are lowercased to keep paths consistent: `2025` and `fall`.
* Viewer assumes the compiled season JSON is discoverable at `./data/{year}/{season}.json` by default.
