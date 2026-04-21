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

PRE_MONTHS = 3      # tiny lookback so the collab-month baseline isn't a blind edge
POST_MONTHS = 24    # main story: what happens in the 2 years after collab
# Curve is PERCENT CHANGE from the collab month value.
# Collab month = 0%. +100% = twice as much attention. -50% = half. -100% = zero.
PCT_CAP = 900

ARTISTS = [
    # Tier 1 — Breakouts: Drake was clearly the gateway
    {"artist": "Jorja Smith",   "query": "Jorja Smith",     "track": "Get It Together (2017)",     "tier": 1, "collab": "2017-03"},
    {"artist": "Dave",          "query": "Dave rapper",     "track": "Wanna Know remix (2016)",    "tier": 1, "collab": "2016-04"},
    {"artist": "Tems",          "query": "Tems singer",     "track": "Fountains (2021)",           "tier": 1, "collab": "2021-09"},
    {"artist": "Lil Baby",      "query": "Lil Baby",        "track": "Yes Indeed (2018)",          "tier": 1, "collab": "2018-05"},
    {"artist": "The Weeknd",    "query": "The Weeknd",      "track": "Crew Love (2011)",           "tier": 1, "collab": "2011-11"},
    # Tier 2 — Amplified: Drake accelerated existing momentum
    {"artist": "Migos",         "query": "Migos rap",       "track": "Versace remix (2013)",       "tier": 2, "collab": "2013-08"},
    {"artist": "Wizkid",        "query": "Wizkid",          "track": "One Dance (2016)",           "tier": 2, "collab": "2016-04"},
    {"artist": "Central Cee",   "query": "Central Cee",     "track": "On The Radar (2023)",        "tier": 2, "collab": "2023-06"},
]


def month_offset(year_month: str, months: int) -> str:
    y, m = map(int, year_month.split("-"))
    total = y * 12 + (m - 1) + months
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def month_range(collab: str, pre: int, post: int) -> list[str]:
    return [month_offset(collab, i) for i in range(-pre, post + 1)]


def fetch_one(pytrends: TrendReq, entry: dict) -> list[float]:
    collab = entry["collab"]
    # Fetch a small pre-window so the 3-month smoother has a real anchor at
    # the collab month, but we trim it before returning — chart starts at 0.
    start = month_offset(collab, -PRE_MONTHS)
    end = month_offset(collab, POST_MONTHS)
    timeframe = f"{start}-01 {end}-28"

    pytrends.build_payload([entry["query"]], timeframe=timeframe, geo="")
    df = pytrends.interest_over_time()
    if df.empty:
        raise RuntimeError(f"No Trends data for {entry['artist']} ({entry['query']})")

    series = df[entry["query"]].astype(float)
    monthly = series.resample("MS").mean()
    monthly.index = monthly.index.strftime("%Y-%m")

    months = month_range(collab, PRE_MONTHS, POST_MONTHS)
    values = [float(monthly.get(m, float("nan"))) for m in months]
    s = pd.Series(values).ffill().bfill()
    raw = s.tolist()

    smoothed = pd.Series(raw).rolling(window=3, min_periods=1, center=True).mean().tolist()

    collab_val = smoothed[PRE_MONTHS]
    if collab_val <= 0:
        positive = [v for v in smoothed if v > 0]
        collab_val = min(positive) if positive else 1.0

    pct_full = [min(PCT_CAP, round(100.0 * (v / collab_val - 1.0), 2)) for v in smoothed]
    # Return only the post-collab window (month 0 through +POST_MONTHS)
    pct = pct_full[PRE_MONTHS:]
    if any(v >= PCT_CAP for v in pct):
        print(f"  note: {entry['artist']} clipped at +{PCT_CAP}%")
    return pct


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
        # Peak post-collab lift — curve now starts at month 0, so indexing
        # directly is fine. Skip index 0 itself (= 0% by construction).
        peak_val = max(curve)
        peak_month = curve.index(peak_val)
        out.append({
            "artist": entry["artist"],
            "track": entry["track"],
            "tier": entry["tier"],
            "collabDate": entry["collab"],
            "collabMonthIdx": 0,
            "curve": curve,
            "peakPct": peak_val,
            "peakMonth": peak_month,
        })
        time.sleep(2)  # be gentle with Trends

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT} ({len(out)} artists)")


if __name__ == "__main__":
    main()
