# Hoops Dynasty — Spec

Phase 0 output. Derived from BRIEF.md plus the interview on 2026-09-10.
BRIEF.md wins on any conflict. This file says *how*.

## 1. Interview answers

| Question | Answer | Consequence |
|---|---|---|
| Game view | Box score only | Engine returns a finished game: box score + play-by-play log. No streaming, no mid-game pause. |
| Drop-in point | Opening night | A season bundle holds rosters, contracts and cap as of game 1. Your first free agency is the following summer. |
| Runtime | Browser tab | Vite dev server. Season bundles are static files. Saves in IndexedDB, export/import as one JSON file. |

## 2. Stack

- Node 26, TypeScript 5, npm workspaces. Nothing installed outside the repo.
- Pipeline DB: `node:sqlite` (built into Node 26). No native modules.
- Tests: `node:test` via `tsx`. One runner everywhere.
- Web: Vite + React + TanStack Table/Virtual. Engine and game run in a Web Worker.
- RNG: seeded xoshiro128**. Every random call goes through it. Same seed, same season.
- Format/lint: Biome.

## 3. Repo layout

```
packages/
  core/       shared types (Season, Era, Team, Player, Contract, GameResult), rng, ids
  data/       pipeline: fetch → data/raw → data/db.sqlite → data/bundles/*.json
  ratings/    real stats → ratings, potential, development curve. Pure. Documented.
  engine/     simulateGame(). Pure. The bake-off winner lives here.
  game/       season loop, front office, dynasty. Pure reducers over one JSON state.
  calibrate/  harness CLI. Writes CALIBRATION.md.
apps/
  web/        Vite + React. Worker hosts game + engine.
data/         gitignored except REPORT.md. raw/, db.sqlite, bundles/
.claude/skills/  calibrate, add-season, run-dynasty
```

Every package is pure TS with no DOM. Only `apps/web` touches the browser.

## 4. Data (Phase 1)

Seasons: `1997-98` → `2025-26`. 29 seasons. "Latest" = last completed season.

### Sources, in order of preference

1. **stats.nba.com** via plain `fetch` with browser headers.
   Endpoint catalogue taken from `swar/nba_api` source, called from TS.
   Rosters, bio, per-100, advanced, team stats, game logs, draft history.
2. **Open datasets on GitHub/Kaggle.** Lead: `sumitrodatta/nba-aba-baa-stats`
   (per-100, advanced, awards, All-NBA, team summaries as CSV).
   Salaries: open salary CSVs on GitHub; hoopshype season pages if needed.
3. **Hand-curated era table** with citations: cap, tax, aprons, min/max salary,
   rookie scale, roster limits, schedule length, playoff format, lottery odds,
   rule flags (hand-check, zone, play-in).
4. **basketball-reference.com** cross-check only. ≤1 request per 4 s, cached, never twice.

Every source is verified with a real fetch before it is relied on. Failures go in `data/REPORT.md`.

### Rules

- Raw responses cached under `data/raw/<source>/<key>.json`. Pipeline re-runs offline from cache.
- Cross-source ID matching (NBA id vs b-ref id) by name + season + team, with a manual override file.
- Contract terms (length, options) are not free in bulk. They are **inferred from forward salary history**
  and flagged `inferred`. Latest season uses current contract data.
- Future traded picks as of opening night: no free source. Each team owns its own picks. Gap logged.
- Injuries: only if a free bulk source proves out. Otherwise gap logged.

### Tables (sqlite)

seasons, team_seasons, players, player_seasons (per team), team_stats, games,
playoff_series, draft_picks, salaries, contracts, awards, injuries (optional), id_map.

### EraContext and life after the latest season

- `EraContext` (core/types.ts) holds that season's league baselines, computed from the data:
  pace, ORtg, 3PAr, FTr, TOV%, ORB%, FG% by zone, shot share by zone, assisted share, home win%.
- Seasons after 2025-26 reuse the 2025-26 EraContext and rules. Money fields (cap, tax, aprons,
  minimums, maximums, exceptions) grow by a game setting, default 7% a year.

### Outputs

- `data/db.sqlite` — the normalised database.
- `data/bundles/<year>.json` — one file per season: era, teams, players (bio, ratings, contract), schedule.
- `data/bundles/history.json` — real results, awards, and future draftees with real career arcs.
- `data/REPORT.md` — row counts per season per table, gaps with reasons, 10 spot-checks vs a second source.

## 5. Ratings (Phase 2)

- Input: a player-season's per-100, advanced, shooting-zone and play-by-play stats plus bio.
- Each rating is one documented function: z-score vs the **pooled 1998–2026 league** (minutes-weighted),
  then mapped to 0–100 (50 = pooled mean, 15 per sd). The anchor is fixed, not per season, so a 1998
  shooter keeps his number in 2010 and careers compare across eras.
- Era differences are carried by Tendencies (shot mix, usage) and EraContext (pace, foul, turnover,
  rebound and zone baselines, home-court edge), never by re-scaling ratings.
- The rating list is `Ratings` in `packages/core/src/types.ts`. SPEC does not duplicate it.
- Potential and development curve for historical draftees come from the real career:
  peak rating, age at peak, career length. The fate slider blends toward a random curve.
- Fictional prospects: sampled from the same curve families.

## 6. Engine (Phase 2)

Interface, fixed before the bake-off:

```ts
simulateGame(input: GameInput, seed: number): GameResult
// GameInput: era, home, away. Each side: players with ratings, rotation targets, role, tactics.
// GameResult: box score per player and team, play-by-play log, pace.
```

Three worktrees, same interface, same harness:

1. `engine-possession` — per possession: shooter by usage, shot zone, make, rebound, TO, foul.
2. `engine-pbp` — finer state machine inside the possession: actions, passes, help defence.
3. `engine-boxscore` — sample each player's line from rating-derived distributions, reconcile to team totals.

Winner chosen by calibration. Best ideas from the losers ported. Recorded in `DECISIONS.md`.

## 7. Calibration harness (Phase 2)

```
npm run calibrate -- --seasons 1998,2004,2010,2016,2026 --runs 100
```

- Loads real rosters and ratings for each season.
- Two minute modes: `real` (real minutes and availability per team stint, so traded players play for
  the right team; isolates engine error) and `model` (the game's rotation model).
- Pass criterion for standings: pearson(mean simulated wins over runs, real wins) ≥ 0.8.
  Per-run correlation is reported next to it.
- Reports vs reality: pace, ORtg, 3PA rate, FT rate, TOV%, ORB% within bands;
  team win% correlation r ≥ 0.8; top-scorer/usage/minute distributions; rating monotonicity.
- Writes `CALIBRATION.md` listing every stat outside its band.
- Rule: fix the engine, not the targets.

## 8. Game state (Phase 3–5)

- One JSON object is the whole save. Reducers are pure: `(state, action, rng) → state`.
- Headless CLI: `npm run dynasty -- --start 2003 --team SAS --seasons 20 --seed 1`.
- Season loop, front office, and dynasty systems as listed in BRIEF A8. Era rules come from the era table.
- The game generates era-correct schedules. The real schedule is used only by the harness and the
  "vs reality" view, so expansion teams and relocations need no real fixture list.
- Expansion drafts follow the era table's expansion rules (1995 and 2004 precedents).
- Historical draft mode past the latest real draft falls back to fictional prospects.
- Save: snapshot of the state object. Export/import as a JSON file.

## 9. UI (Phase 6)

- Vite + React. Dense sortable tables. Inbox. Roster, depth chart, tactics, finances, player cards, box scores, history.
- Worker owns the state. UI asks for views. Full season sims in seconds.
- Desktop-first.
- All news and press text comes from templates. Any LLM-written text is a setting, off by default.

## 10. Working rules

- Fable commits locally at phase boundaries and merges worktree lanes. Never pushes.
- Every phase ends with a fresh-context review agent judging against BRIEF.md.
- `AGENTS.md` stays current. Skills exist for `calibrate`, `add-season`, `run-dynasty`.
- Deviations from BRIEF.md go in `DECISIONS.md` with the reason.
