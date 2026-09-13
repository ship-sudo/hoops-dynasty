---
name: calibrate
description: Run the calibration harness against real seasons and read CALIBRATION.md. Use after any engine or ratings change, and before finishing Phase 2+ work.
---

# calibrate

Proves the engine against real seasons (BRIEF A7). Fix the engine, not the targets.

## Run

```sh
export HOOPS_DATA_DIR=/Users/mkm/Code/lab/hoops-dynasty/data   # only needed inside a worktree
npm run calibrate -- --seasons 1998,2004,2010,2016,2026 --runs 100 --minutes real
```

Flags:
- `--engine engine` (default: `packages/engine`, the current winner) · `naive` (the baseline) · a file path exporting `simulateGame`.
- `--minutes real` uses real minutes and availability per stint (isolates engine error). `--minutes model` uses the depth-chart rotation.
- `--runs 20` for a quick look while iterating. Final numbers use 100.
- `--out CALIBRATION.md`.

Bundles must exist first: `npm run pipeline -- bundles`.

## Read

`CALIBRATION.md` opens with "Out of band": every stat outside its tolerance, per season. Empty means pass.
Then a summary table (win correlation expected and per run, standings spread) and one table per season.

Pass = no out-of-band lines on all five seasons and monotonicity ok. Tolerances live in `packages/calibrate/src/metrics.ts` (`TOL`). Do not loosen them.

## Traps

- A low win correlation with `--minutes real` is an engine or ratings problem. With `--minutes model` it may be the rotation model.
- The naive engine must always lose to the real engine on every band. If it doesn't, the real engine has regressed.
- Same seed, same result. If a run is not reproducible, someone called `Math.random`.
