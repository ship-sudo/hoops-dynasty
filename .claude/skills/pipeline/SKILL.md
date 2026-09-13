---
name: pipeline
description: Rebuild the local NBA database and season bundles from the raw cache, or add a new season. Use after changing loaders, ratings, or the era table.
---

# pipeline

Turns `data/raw/` into `data/db.sqlite`, `data/bundles/<year>.json`, `data/bundles/history.json`, `data/REPORT.md`.

## Run

```sh
export HOOPS_DATA_DIR=/Users/mkm/Code/lab/hoops-dynasty/data   # inside a worktree
export HOOPS_OFFLINE=1                                          # never fetch by accident
npm run pipeline -- load      # raw cache → db.sqlite (≈6 s)
npm run pipeline -- bundles   # db → bundles, calls @hoops/ratings (≈1 s)
npm run pipeline -- report    # db → data/REPORT.md
npm run pipeline -- all       # fetch (cached) + the three above
```

After a ratings change: `bundles` only. After a loader or era change: `load`, `bundles`, `report`.

## Add a season (next summer)

1. Unset `HOOPS_OFFLINE`. Run `npm run pipeline -- fetch --from 2027 --to 2027` (stats.nba.com; ~40 requests plus 30 rosters).
2. Check whether `sumitrodatta/bball-reference-datasets` has the season; `download.ts` fetches only missing files.
3. Add the season to `packages/data/src/era/era.ts` with sources in `SOURCES.md`. Mark unknowns in `unverified`.
4. Salaries: add a Wayback snapshot date near opening night to `packages/data/src/open/wayback.ts`.
5. `npm run pipeline -- all`, then read `data/REPORT.md` for new gaps. Then `/calibrate` on the new season.

## Traps

- curl cannot reach stats.nba.com. Only Node fetch works. Test with `npx tsx`, never curl.
- basketball-reference: never fetch. Two pages are cached under `data/raw/bref`; that is the cross-check budget.
- Two pipeline processes at once double the rate on slow hosts. Run one.
- `data/` is gitignored except `REPORT.md`. Never commit raw data.
