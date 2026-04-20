# The Drake Effect — Visualization Summary

## Project Goal

Create a data visualization that demonstrates "The Drake Effect" — the phenomenon where Drake collaborations serve as career inflection points for artists and cultural gateways for entire genres into mainstream North American consciousness.

## Core Thesis

Drake has functionally operated as a tastemaker and amplifier for over a decade, with two distinct but related impacts:

1. **Artist-level boost**: Drake features correlate with breakthrough moments for specific artists, launching regional or niche acts into mainstream visibility
2. **Genre-level gateway**: Drake pulls entire musical scenes (UK rap/drill, Afrobeats, amapiano, Memphis rap, dancehall) into North American ears

## Visualization Approach

### Primary Chart: Artist Trajectories (Spaghetti Plot)

**Format**: Multi-line time series chart showing monthly listener counts indexed to each artist's Drake collaboration month (collab month = 100)

**Key Design Decisions**:
- **Metric**: Monthly listeners (Spotify-style, smooth curves)
- **Indexing**: All artists normalized to collab month = 100, enabling direct comparison of relative lift
- **Time window**: ±24 months around collaboration date (potentially extend to ±36/48 months)
- **Layout**: Single chart with all artists overlaid, color-coded by tier
- **Interactivity**: Lightly interactive — hover for details, toggle artist tiers

**Artist Roster (8-10 artists across two tiers)**:

**Tier 1 — True Breakouts** (6 artists)
- BlocBoy JB — "Look Alive" (Feb 2018)
- iLoveMakonnen — "Tuesday" remix (2014)
- Yung Bleu — "You're Mines Still" (2021)
- Tems — "Fountains" (2021)
- Lil Baby — "Yes Indeed" (2018)
- Jorja Smith — "Get It Together" (2017)

**Tier 2 — Already Rising** (4 artists)
- Migos — "Versace" remix (2013)
- Wizkid — "One Dance" (2016)
- Central Cee — "On The Radar" (2023)
- Bad Bunny — "MIA" (2018)

**Visual Treatment**:
- Tier 1: Hot accent color (orange/red) — clear breakout cases
- Tier 2: Cool accent color (blue) — nuanced cases where Drake accelerated existing momentum
- Month 0: Gold vertical line marking collaboration release
- Dark background with editorial/music-journalism aesthetic

### Secondary Consideration: Genre-Level Analysis

Could include stacked area chart or stream graph showing genre penetration over time (UK drill, Afrobeats, amapiano share of US streams), with Drake's genre-crossing moments annotated.

## Data Sources Required

### Primary Sources
- **Chartmetric or Songstats** (paid) — historical monthly listener data (IDEAL but requires subscription)
- **Spotify API** — current monthly listeners, track popularity (limitation: no historical snapshots)
- **Billboard / Official Charts** — chart positions and peak dates
- **Google Trends** — cultural attention proxy, good for inflection point identification

### Supporting Sources
- **Wikipedia / Genius** — collaboration dates and metadata
- **Apple Music / YouTube** — additional streaming/view signals for validation

## Open Design Questions

1. **Time window**: Is ±24 months sufficient, or should we extend to ±36/48 to capture longer-term trajectories (Tems, Lil Baby)?

2. **Label density**: Right edge is crowded with 10 artist labels. Options:
   - Reduce roster to 6-8 strongest cases
   - Use shorter labels
   - Move labels inline on curves
   - Accept the density

3. **Context view**: Should we add a companion chart showing absolute monthly listeners today (bar chart) so viewers understand relative scale differences between artists?

4. **Control group**: Would including non-Drake control artists (similar pre-collab trajectories but no Drake feature) strengthen the analytical case?

5. **Distribution format**: Standalone piece, Twitter/X thread visual, blog post, slide deck? This determines static vs. interactive priority.

## Next Steps

1. **Align on final design decisions** (time window, label approach, companion views)
2. **Source actual data** — determine whether Chartmetric access is feasible; if not, pivot to Billboard + Google Trends approach
3. **Build production version** with real data
4. **Consider genre-level visualization** as Part 2 if artist-level piece proves compelling

## Current Status

- ✅ Artist roster finalized across two tiers
- ✅ Mockup built with plausible placeholder data
- ✅ Visual design and interaction patterns established
- ⏳ Awaiting real data sourcing decisions
- ⏳ Final design refinements needed
