"""Fetch Google Trends data for each Drake collaborator and emit data/artists.json.

Indexed so collab month = 100; curve spans -24 to +24 months (49 points).
"""
import json
import time
from datetime import date
from pathlib import Path

import pandas as pd
from pytrends.request import TrendReq

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "artists.json"

WINDOW_MONTHS = 24  # ± on each side of collab
Y_CAP = 1000

ARTISTS = [
    # Tier 1 — Breakouts
    {"artist": "BlocBoy JB",    "query": "BlocBoy JB",     "track": "Look Alive (2018)",          "tier": 1, "collab": "2018-02"},
    {"artist": "iLoveMakonnen", "query": "iLoveMakonnen",  "track": "Tuesday remix (2014)",       "tier": 1, "collab": "2014-10"},
    {"artist": "Yung Bleu",     "query": "Yung Bleu",      "track": "You're Mines Still (2021)",  "tier": 1, "collab": "2021-04"},
    {"artist": "Tems",          "query": "Tems singer",    "track": "Fountains (2021)",           "tier": 1, "collab": "2021-09"},
    {"artist": "Lil Baby",      "query": "Lil Baby",       "track": "Yes Indeed (2018)",          "tier": 1, "collab": "2018-05"},
    {"artist": "Jorja Smith",   "query": "Jorja Smith",    "track": "Get It Together (2017)",     "tier": 1, "collab": "2017-03"},
    # Tier 2 — Already rising
    {"artist": "Migos",         "query": "Migos rap",      "track": "Versace remix (2013)",       "tier": 2, "collab": "2013-08"},
    {"artist": "Wizkid",        "query": "Wizkid",         "track": "One Dance (2016)",           "tier": 2, "collab": "2016-04"},
    {"artist": "Central Cee",   "query": "Central Cee",    "track": "On The Radar (2023)",        "tier": 2, "collab": "2023-06"},
    {"artist": "Bad Bunny",     "query": "Bad Bunny",      "track": "MIA (2018)",                 "tier": 2, "collab": "2018-10"},
]


def month_offset(year_month: str, months: int) -> str:
    y, m = map(int, year_month.split("-"))
    total = y * 12 + (m - 1) + months
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def month_range(collab: str, window: int) -> list[str]:
    return [month_offset(collab, i) for i in range(-window, window + 1)]


def fetch_one(pytrends: TrendReq, entry: dict) -> list[float]:
    collab = entry["collab"]
    start = month_offset(collab, -WINDOW_MONTHS)
    end = month_offset(collab, WINDOW_MONTHS)
    timeframe = f"{start}-01 {end}-28"

    pytrends.build_payload([entry["query"]], timeframe=timeframe, geo="")
    df = pytrends.interest_over_time()
    if df.empty:
        raise RuntimeError(f"No Trends data for {entry['artist']} ({entry['query']})")

    series = df[entry["query"]].astype(float)
    # Resample weekly -> monthly (mean)
    monthly = series.resample("MS").mean()
    # Index by YYYY-MM string for easy lookup
    monthly.index = monthly.index.strftime("%Y-%m")

    # Ensure every expected month is represented (forward-fill tiny gaps)
    months = month_range(collab, WINDOW_MONTHS)
    values = [float(monthly.get(m, float("nan"))) for m in months]

    # Fill any NaN with nearest non-nan neighbor (rare)
    s = pd.Series(values).ffill().bfill()
    raw = s.tolist()

    # 3-month rolling smooth
    smoothed = pd.Series(raw).rolling(window=3, min_periods=1, center=True).mean().tolist()

    collab_val = smoothed[WINDOW_MONTHS]
    if collab_val <= 0:
        # Degenerate case: artist had ~zero pre-collab search. Use the smallest
        # positive value as the denominator so the curve still plots.
        positive = [v for v in smoothed if v > 0]
        collab_val = min(positive) if positive else 1.0

    indexed = [min(Y_CAP, round(100.0 * v / collab_val, 2)) for v in smoothed]
    if any(v >= Y_CAP for v in indexed):
        print(f"  note: {entry['artist']} clipped at y={Y_CAP}")
    return indexed


def main() -> None:
    pytrends = TrendReq(hl="en-US", tz=360)
    out = []
    for entry in ARTISTS:
        print(f"Fetching {entry['artist']} ({entry['query']})…")
        for attempt in range(3):
            try:
                curve = fetch_one(pytrends, entry)
                break
            except Exception as exc:
                print(f"  attempt {attempt + 1} failed: {exc}")
                time.sleep(5 * (attempt + 1))
        else:
            raise SystemExit(f"Giving up on {entry['artist']}")
        out.append({
            "artist": entry["artist"],
            "track": entry["track"],
            "tier": entry["tier"],
            "collabDate": entry["collab"],
            "collabMonthIdx": WINDOW_MONTHS,
            "curve": curve,
        })
        time.sleep(2)  # be gentle with Trends

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT} ({len(out)} artists)")


if __name__ == "__main__":
    main()
