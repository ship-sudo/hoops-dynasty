# Hoops Dynasty

Football Manager for the NBA. Drop into any season from 1997-98 to the present with the real
rosters, the real contracts and that year's real salary cap, then run the franchise forward into a
history that is yours.

The simulation is deterministic: same seed, same season, every time. It runs entirely offline. No
model, no API key, no network call while you play.

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

**You also need the data.** `data/` is gitignored — it is 414 MB and none of it is ours to
redistribute. A fresh checkout has no bundles and the app will show an empty league until you build
them:

**Want to play in under a minute?** Build one season rather than thirty:

```bash
npm run pipeline -- all --from 2004 --to 2004    # measured cold: 37 seconds
npm run dev
```

Then pick 2003-04 in the game. Build the rest whenever you like — the cache is shared, so nothing
is refetched:

```bash
npm run pipeline -- all
```

That fetches from free sources, loads `data/db.sqlite`, writes `data/bundles/<year>.json` for each
season and a coverage report at `data/REPORT.md`. Reckon on 15–20 minutes for all 29 seasons, most
of it waiting on a 0.7-second gap between stats.nba.com requests. Everything is cached, so a second
run is about seven seconds.

If another checkout on this machine already has the data, point at it instead of refetching:

```bash
export HOOPS_DATA_DIR=/Users/mkm/Code/lab/hoops-dynasty/data
export HOOPS_OFFLINE=1     # optional: make any uncached fetch throw, so you notice
```

That is the right move in a git worktree. **Never run two pipeline fetches at once** — it doubles
the rate against a source that asked us not to.

Node 26. npm workspaces; there is no other package manager in play.

---

## The four gates

Everything must be green before anything merges:

```bash
npm test           # ~400 tests, node:test via tsx
npm run typecheck  # tsc over packages/*/src (apps/web has its own DOM tsconfig)
npm run build      # typecheck + production build of apps/web
npx biome check .  # lint and format
```

`npm test` does **not** typecheck — tsx strips types. A test file can pass while `tsc` is red, so
run both.

---

## The other things you can run

```bash
npm run dynasty -- --start 2003 --team SAS --seasons 20 --seed 1   # headless, no browser
npm run calibrate -- --seasons 1998,2004 --runs 100 --minutes real # engine vs real seasons
npm run ratings:anchors                                            # refit rating anchors
npm run progression:curves                                         # refit age curves
```

`calibrate` is the honesty check. It writes `CALIBRATION.md`. `--minutes real` uses real minutes
and availability, isolating engine error from rotation error; `--minutes model` runs our own depth
chart. It passes at pearson(sim wins, real wins) ≥ 0.8; we sit at 0.88–0.94.

Any change to the engine, the ratings or the rotation must be followed by a calibration run, and
the result goes in the commit message. A change that claims to be neutral should come back
byte-identical apart from the timestamp.

---

## How it fits together

```
packages/data          free sources → data/bundles/<year>.json
packages/ratings       real stats → era-fair 0–100 ratings
packages/engine        one game, possession by possession, deterministic
packages/game          seasons and the front office, pure reducers over one JSON state
packages/frontoffice   cap, tax, Bird rights, trade valuation, the market
packages/progression   age curves fitted from 2,786 real careers
packages/draftclass    real and invented draft classes, scouting fog
packages/injury        availability, calibrated to the real 25% of games missed
packages/calibrate     proves the engine against real seasons
apps/web               the game, with the simulation in a Web Worker
```

Two rules hold the shape:

**`packages/game` never imports the engine or the data layer.** The engine, prospects, free agency,
development and the era table all arrive through `GameHooks`. That is what lets calibration swap
engines and what keeps the season loop testable.

**The web app talks to the simulation only through `apps/web/src/sim/api.ts`.** The adapter behind
it is `apps/web/src/sim/real.ts`.

---

## Before you change anything

Read, in this order:

| File | What it is |
|---|---|
| `BRIEF.md` | what this is meant to be, and what "done" means |
| `SPEC.md` | how it is built |
| `DECISIONS.md` | why it is built that way, and what was tried and rejected |
| `AGENTS.md` | **the traps.** Read this one. It will save you a day. |
| `CALIBRATION.md` | the current accuracy numbers |
| `DESIGN-THEMES.md` | research into why people play these games for years |
| `PICK-LIST.md` | what we could build next, costed |

The three traps that bite hardest, in short:

- **Never call `Math.random`.** Use the seeded rng from `packages/core`, or determinism is gone and
  the same save stops reproducing.
- **Anything you add to `GameState` must be optional**, or every existing save stops loading. And it
  must survive `JSON.stringify` — no Maps, Sets or Dates.
- **Franchises move and rename.** Key on team-season, not team. Player ids differ per source; go
  through `id_map`.

---

## Conventions

Plain TypeScript, ESM, strict. No classes where a function will do. One test file next to each
module. Comments explain why, never what.

A claim about behaviour needs a measurement behind it. "Rebounding feels better" is not a result;
"the best rebounder went 11.4 → 14.6 a game across twelve simulated seasons, against a real 14.9"
is. Where you can, write the experiment down as a test so the next person can rerun it.
