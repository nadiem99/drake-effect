# Data pipeline

`fetch_trends.py` pulls Google Trends search interest for each artist in the roster, resamples weekly → monthly, smooths with a 3-month rolling mean, indexes to the collab month (= 100), and writes `../data/artists.json`.

## Adding or editing an artist

Edit the `ARTISTS` list at the top of `fetch_trends.py`. Each entry needs:

- `artist` — display name (must match keys in `data/spotify_current.json`)
- `query` — Google Trends query string. Disambiguate common names here (e.g. `"Migos rap"` instead of `"Migos"` to avoid the Italian fashion brand).
- `track` — collab track + year, shown in the tooltip
- `tier` — 1 (Breakout) or 2 (Already rising)
- `collab` — `"YYYY-MM"` of the collab release month

Then rerun `fetch_trends.py` and update `data/spotify_current.json` with the new artist's current monthly listeners.
