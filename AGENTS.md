# AGENTS.md — rails for anyone working on Hoops Dynasty

Read BRIEF.md (what), SPEC.md (how), DECISIONS.md (why). Then this.

## Status

- Phase 0–1: done 2026-09-10/11 (spec, data pipeline; see `data/REPORT.md`).
- Phase 2: done 2026-09-12. `packages/ratings` (era-fair proxies on a frozen pooled anchor,
  `npm run ratings:anchors`) and `packages/engine` (possession model, `anchors.ts` solves every
  per-game probability from EraContext by bisection). Calibration on main, 10 runs, `--minutes real`:
  win r 0.939 (1998), 0.914 (2004), 0.876 (2016), **0 stats out of band** in all three. Baseline
  naive engine was r 0.86–0.88 with 4 bands broken and a standings spread of 6 wins against a real 11–15.
- Phase 3: done 2026-09-12. `packages/game`: schedule, standings with era tiebreakers, play-in,
  playoffs, lottery, draft, awards, rollover. Pure reducers over one JSON state, engine injected.
- Phase 4: done 2026-09-12. `packages/frontoffice`: cap, tax, max/min, Bird rights, rookie scale,
  trade valuation and era salary matching, free-agent market.
- Phase 5: done 2026-09-12. `packages/progression` (age curves fitted from 2,786 real careers,
  survivorship-corrected), `packages/draftclass` (real classes, fictional classes, scouting fog),
  `packages/injury` (calibrated to the real 25% of games missed).
- Phase 6: done 2026-09-12. `apps/web` runs the real game via `apps/web/src/sim/real.ts`, verified
  in headless Chrome: 2003-04 Spurs, a simulated month, standings, roster, box scores, clean console.
- Phase 7: done 2026-09-12. The manager's own powers, all verified in headless Chrome:
  tactics and a depth chart that reach the engine, a trade desk (valuation, legality, the AI's
  answer, its own offers to you), an offseason you play yourself (lottery, a scouted draft board,
  a market bound by the cap), per-game logs, and a "vs reality" screen comparing your timeline to
  what actually happened. AI clubs also trade with each other during the season.
- Coaching, 2026-09-12: `packages/core/src/playbook.ts` is the manager's playbook — a starting five
  by position, four named offensive systems, and per-player instructions (usage, threes, the post,
  the glass, defensive effort). All of it is a pure transform of `Ratings` and `Tendencies` applied
  in `rotation.ts`; nothing touches the scoreboard. Neutral in, neutral out, so calibration is
  unchanged to the digit. `systemFit` scores a system with the engine's own shot arithmetic, so the
  screen and the box score cannot disagree.

## Commands

```
npm install                 # once
npm test                    # all packages, node:test via tsx (set HOOPS_DATA_DIR for the era cap test)
npm run typecheck           # tsc over packages/*/src, noEmit (apps/web has its own DOM tsconfig)
npm run pipeline -- all     # fetch (cached, offline-safe) → load db.sqlite → bundles → data/REPORT.md
npm run pipeline -- load    # 5.5 s for 29 seasons; bundles 0.8 s; report 0.5 s
npm run calibrate -- --seasons 1998,2004 --runs 100 --minutes real --engine naive   # harness → CALIBRATION.md (engine: naive | engine | path)
npm run dynasty -- --start 2003 --team SAS --seasons 20 --seed 1   # headless multi-season run
npm run dev                 # web app on :5173 (pass args as: npm run dev -w apps/web -- --port 5177)
npm run build               # typecheck + production build of apps/web
npm run ratings:anchors     # refit the rating anchors from the bundles
npm run progression:curves  # refit the age curves from history.json
```

## Architecture in one breath

`packages/data` builds `data/bundles/*.json` from free sources.
`packages/ratings` turns real stats into 0–100 ratings.
`packages/engine` sims one game from ratings, deterministically.
`packages/game` runs seasons and the front office as pure reducers over one JSON state.
`packages/calibrate` proves the engine against real seasons. `--minutes real` uses real minutes and availability (isolates engine error); `--minutes model` uses a depth-chart rotation. Pass criterion is pearson(mean sim wins, real wins) ≥ 0.8; per-run r is reported too.
`packages/engine/src/naive.ts` is the baseline every bake-off engine must beat. `packages/engine/src/index.ts` is the slot the winner fills.
`apps/web` shows it all, with the game in a Web Worker.

## Traps

- stats.nba.com needs browser headers and refuses fast bursts. Use `nbaGet` in `packages/data/src/nba/client.ts`; never call `fetch` directly. **curl cannot reach it** (TLS fingerprinting). Test with Node.
- In a worktree, set `HOOPS_DATA_DIR=/Users/mkm/Code/lab/hoops-dynasty/data` so the raw cache is shared. `HOOPS_OFFLINE=1` makes any uncached fetch throw.
- Only `packages/data` may fetch from basketball-reference.com, and only through `cachedFetch` (4 s per request is enforced there). Two processes hitting it at once double the rate: never run two pipeline fetches in parallel.
- Open CSVs use basketball-reference ids (`jokicni01`); stats.nba.com uses person ids (`203999`). `season` in the CSVs is the year the season ends.
- `commonteamroster` is a season-end snapshot, not opening night. Per-game team membership comes from the player game logs (`leaguegamelog` with PlayerOrTeam=P, one request per season, ~25k rows).
- `leaguedash*` list a traded player once under his final team with summed stats. Per-stint totals must be summed from game logs.
- `commonallplayers` needs a `Season` param even with IsOnlyCurrentSeason=0. `drafthistory` SEASON is a draft year string.
- `leaguegamelog` PlayIn is empty (HTTP 200, 0 rows) before 2019-20. Not a gap.
- Wayback: use the CDX index (`packages/data/src/open/wayback.ts`), not the availability API (it 429s). One request per 4 s.
- Regenerate Lane A's coverage table without fetching: `HOOPS_DATA_DIR=… HOOPS_OFFLINE=1 npx tsx packages/data/src/nba/coverage.ts`.
- basketball-reference: ≤1 request per 4 s, cache every page, never fetch twice. Cross-check only.
- Player IDs differ per source. Go through `id_map`. Match by name + season + team, override file for collisions.
- Franchises move and rename. Key on team-season, not team.
- 1998-99 has 50 games. 2011-12 has 66. 2019-20 is 65–75 plus a bubble. 2020-21 is 72.
- Era money and rules: `ERA[yearEnd]` from `packages/data/src/era/era.ts`; check `unverified` before trusting a number. Never fetch basketball-reference for cap history; the page is cached at `data/raw/bref/salary-cap-history.html`.
- Never call `Math.random`. Use the seeded rng from `packages/core`.
- `packages/game` never imports `@hoops/engine` or `@hoops/data` outside `src/cli.ts`. The engine,
  the prospect generator, free agency, development and the era table all arrive through `GameHooks`.
  `@hoops/injury` and `@hoops/progression` are the exception: pure functions over `@hoops/core` with
  no I/O, imported directly because the season loop cannot run availability or rank a depth chart
  without them.
- Anything you add to `GameState` must be optional, or old saves stop loading. `availability` is
  optional for that reason; read it through `availabilityOf`.
- The game generates its own schedule. A bundle's real fixture list is only used for the opening and
  closing dates (`newGame(..., { useRealSchedule: true })` if you ever need the real one).
- Reducers mutate a `structuredClone` of the state and write the rng state back. Anything you put in
  `GameState` must survive `JSON.stringify` — no Maps, Sets or Dates.
- `data/` is gitignored. Do not commit raw data.
- `apps/web` serves season bundles from `HOOPS_DATA_DIR/bundles` (default `<repo>/data/bundles`) through a
  small middleware in `apps/web/vite.config.ts`. They are never bundled into the build. In a worktree,
  symlink `data/bundles` to the main checkout's or set `HOOPS_DATA_DIR`.
- The web app talks to the sim only through `apps/web/src/sim/api.ts`. `stub.ts` is the temporary
  implementation on top of `simulateGame`; `packages/game` replaces it by changing one import in
  `apps/web/src/sim/worker.ts`.

## Conventions

- Plain TS, ESM, strict. No classes where a function will do.
- One test file next to each module. `node:test`.
- Short lines in docs. Lead with the outcome.
- Skills live in `.claude/skills/<name>/SKILL.md`. Write one for any job you did twice.

## Left to do

- **In-season signings.** Free agency only runs in the summer; you cannot sign a replacement when
  a player goes down in January.
- **Multi-team trades, cash, and trade exceptions.** The trade desk is two-sided only.
- **Staff, morale, board expectations, expansion.** Not built.
- **Minutes are still a share, not a promise, but the screen no longer lets you find out the hard
  way.** `rotation.ts` renormalises a rotation to 240, so asking for 46 out of a 218-minute plan
  yields about 50. The tactics screen now keeps the manager inside the budget instead: what is left
  to assign is the headline number, a stepper cannot take the team over 240, and "Balance to 240"
  scales his plan into it. The share model still bites when men are hurt — the fit ones absorb the
  absent ones' minutes, so a plan of 30 each realises nearer 36.
- **`apps/web`'s develop hook double-counts injuries.** It calls `seasonAvailability` to invent a
  season of absences for the lingering-penalty calculation, but the real absences now live in
  `GameState.availability`. It should read those.
- **Offers do not survive a reload mid-market.** They live in the Dynasty closure, not the save.
- **The comparison screen is per season.** No cumulative franchise arc, no playoff-seed or series
  comparison — wins, champion and MVP only.
