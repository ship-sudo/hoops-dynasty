# Hoops Dynasty — Brief

Football Manager for the NBA.
Drop into any season from **1997–98** to today, take over a real franchise
(or found a new one), and run it as a multi-decade dynasty.
The world is real at the moment you arrive. From then on, history is yours.

Part A is for Fable. Part B is for Matt.

---

# PART A — THE BRIEF (Fable reads this)

## A1. Who this is for and why

- One player: Matt. Personal project, runs locally, never published.
- He wants the feeling of Football Manager: dense tables, an inbox, hard
  front-office trade-offs, and years of consequences.
- He wants real NBA history as the starting board — real rosters,
  contracts, cap, drafts — and then a believable alternate history.

## A2. The finish line

The game is done when Matt can:

1. Pick any season 1997–98 → latest, and any franchise, or found an expansion team.
2. See that season's real rosters, contracts, cap and rules.
3. Sim or play through a full season: schedule, games, standings,
   playoffs (era-correct format), lottery, draft.
4. Run the front office: rotations, tactics, contracts, free agency,
   trades with a sane AI, re-signings, rookie deals.
5. Keep going for 20+ seasons with development, aging, retirements,
   new draft classes, awards, Hall of Fame and records.
6. Compare his timeline to what really happened.
7. Save, quit, and resume.

## A3. Core design decisions (already made — don't re-litigate)

- **Local-first web app, TypeScript end to end.** No server, no accounts.
- **The sim engine is a pure package with no UI.** Headless, deterministic
  with a seed, testable from the command line.
- **Real data up to the drop-in point. Simulation after it.**
- **Era-aware everything.** Cap and CBA rules, playoff format, lottery odds,
  pace, three-point rate, hand-check (2004–05), zone defence legal (2001–02),
  play-in (2020–21+), aprons (2023 CBA). Season length varies (1998–99 lockout = 50 games).
- **Two future-draft modes:**
  - *Historical:* real future draftees arrive in their real draft year, with
    hidden potential derived from their real careers — plus a
    **"fate" slider** (0 = careers track history, 100 = fully random).
  - *Fictional:* generated prospects.
- **Offline by default.** Any AI-written text (press, news) is optional and off by default;
  templates first.

## A4. Data — free sources only

Build a one-time pipeline that assembles a normalised local database
for every season 1997–98 → latest.

**Rules**
- Use **free public APIs and open datasets on GitHub/Kaggle**. No paid APIs. No API keys unless free.
- Leads to verify (don't assume they work — prove it):
  - `swar/nba_api` (stats.nba.com client): box scores, player/team stats, draft history, rosters.
  - Open NBA datasets on GitHub/Kaggle (e.g. the `wyattowalsh/basketball` SQLite build).
  - Open salary datasets for historical contracts; salary-cap history by year.
- **basketball-reference.com is a cross-check only**, never the bulk source.
  Their rule: ≤20 requests/minute or you're blocked for up to a day.
  If you touch it: ≤1 request every 4 seconds, cache every page, never fetch twice.
- Cache everything raw under `data/raw/`. Pipeline must be re-runnable offline.
- `data/` is gitignored. Never commit or redistribute raw data.

**Needed per season:** teams, rosters, player bio (age, height, weight, position),
per-100 + advanced stats, team stats, schedule/results, playoff results,
draft (with pick numbers), contracts/salaries, salary cap/tax/aprons,
awards (MVP, ROY, DPOY, All-NBA), injuries if a free source exists.

**Done when:** a `data/REPORT.md` shows row counts per season per table,
every gap listed with the reason, and 10 random spot-checks matched against
a second source.

## A5. Ratings — turn real stats into player ratings

- Derive ratings (shooting by zone, finishing, playmaking, rebounding,
  defence, athleticism, IQ, durability…) from each player's real per-100
  and advanced stats for that season, adjusted for era.
- Also derive **potential** and **development curve** for historical draftees.
- Keep the mapping readable — a documented function, not a black box.

## A6. The engine — how to build it

Build it **three different ways in three parallel worktrees**:
1. Possession-level probability model.
2. Play-by-play event simulation.
3. Box-score/stat-driven model.

Judge them against the calibration harness (A7). Pick the winner.
Port the best ideas from the losers. Record the decision in `DECISIONS.md`.

## A7. Calibration harness — the definition of "realistic"

A command that, for any real season:
- Loads that season's real rosters and ratings.
- Simulates it 100 times.
- Reports vs reality:
  - League averages: pace, ORtg, 3PA rate, FT rate, TOV%, ORB% — within target bands.
  - Team win% correlation with the real standings (target: r ≥ 0.8 across seasons).
  - Player stat distributions (top scorers, usage, minutes) look real.
  - Better ratings must monotonically win more.
- Runs on at least: 1998, 2004, 2010, 2016, latest.
- Writes `CALIBRATION.md` with every stat outside its band.

Rule: **fix the engine, not the targets.**

## A8. Game systems (after the engine passes)

- **Season loop:** era-correct schedule, standings, tiebreakers, playoffs, play-in, lottery, draft.
- **Front office:** cap and contracts by era, rookie scale, max deals, Bird rights,
  free agency with player preferences, trades with an AI that values players
  sensibly (no fleecing the AI), two-way deals where era-correct.
- **Dynasty:** development, aging, retirement, injuries, morale, chemistry, roles,
  owner goals and job security, finances (revenue, payroll, luxury tax),
  staff (coaches, scouts, trainers) with ratings, scouting fog on prospects.
- **History:** awards, All-NBA, Hall of Fame, franchise and league records,
  "what really happened" side-by-side view.
- **Expansion:** found a new franchise, expansion draft by era rules.

## A9. The UI (last)

- FM-style: dense sortable tables, inbox/news feed, roster, depth chart,
  tactics, finances, player cards with rating history, box scores, league history.
- Fast: a full season sims in seconds (engine in a Web Worker).
- Desktop-first; usable on a laptop screen.

## A10. How to work

You are operating autonomously. The user is not watching in real time.
For reversible actions that follow from this brief, proceed without asking.

- **Interview first.** Before Phase 1, ask Matt up to 5 questions — only ones
  whose answers change the architecture. One at a time.
- **Delegate.** Split independent work into lanes. Spawn sub-agents in parallel,
  each in its own worktree. You plan, dispatch, review, merge.
- **Verify with fresh eyes.** At the end of each phase, spawn a fresh-context
  sub-agent whose only job is to find flaws against this brief.
- **Ground every progress claim** in a tool result from this session.
  If something isn't verified, say so.
- **Log deviations.** Any time you depart from this brief, write it in
  `DECISIONS.md` with the reason.
- **Do the simplest thing that works.** No speculative abstractions,
  no feature flags, no compatibility shims.
- **Edit surgically.** Don't rewrite whole files when a small edit will do.
- **Don't touch:** anything outside this repo. Don't publish, deploy,
  push to a remote, spend money, or sign up for anything.
- **Pause only** for: something irreversible, a real scope change,
  or input only Matt can give. Then ask and end the turn.
- **Leave rails behind.** Keep `AGENTS.md` current (commands, architecture,
  traps) and write skills for repeated jobs (e.g. `calibrate`, `add-season`),
  so cheaper models can continue the work later.
- Plain words, short lines. Lead with the outcome. No mannered prose.

## A11. Phases and "done when"

| Phase | Build | Done when |
|---|---|---|
| 0 | Interview → `SPEC.md`, `AGENTS.md`, `DECISIONS.md` | Matt approves the spec |
| 1 | Data pipeline 1997–98 → latest | `data/REPORT.md` complete, gaps explained |
| 2 | Ratings + 3-way engine bake-off + calibration harness | Winner passes `CALIBRATION.md` on 5 seasons |
| 3 | Season loop (schedule → playoffs → lottery → draft) | 20 seasons sim headless without a crash; records look sane |
| 4 | Front office (cap, contracts, FA, trades AI) | Fresh-eyes agent can't find a cap-rule bug or a fleecable trade in 50 tries |
| 5 | Dynasty (development, fate slider, board, finances, staff, history) | A 30-season run produces believable careers and a "vs reality" report |
| 6 | UI | Matt can drop into 2003, take over a team, and play a season end to end |
| 7 | Hardening | Fresh-context full review; all findings fixed or logged |

---

# PART B — HOW TO RUN IT (Matt)

## Setup (once)

```sh
cd ~/Code/lab/hoops-dynasty
git init && git add BRIEF.md && git commit -m "brief"
```

## Session 1 — spec (plan mode, high effort)

```sh
claude --model fable --effort xhigh --permission-mode plan
```
```
Read BRIEF.md. Do Phase 0 only. Interview me first.
```

## Session 2 — data + engine (the big burn)

```sh
claude --model fable --effort high
```
```
/goal Phase 1 and Phase 2 of BRIEF.md are done by their "done when" criteria, or stop after 60 turns
```
Or, if `/goal` isn't available:
```
Read BRIEF.md. Execute Phase 1, then Phase 2. Use parallel sub-agents in worktrees.
```

Overnight version (own worktree, runs in the background):
```sh
claude --bg -n "hoops-p1p2" --model fable "Read BRIEF.md. Execute Phase 1, then Phase 2."
claude agents        # check on it
```

## Next week (cheaper models)

Once Fable has left `SPEC.md`, `AGENTS.md`, the calibration harness and skills:
```sh
claude --model opus
```
```
Read BRIEF.md and AGENTS.md. Execute Phase 3. Run the calibrate skill before finishing.
```

## Checks

- `/usage` — Fable bar.
- Morning after a long run: `/code-review high`.
- Read `DECISIONS.md` and `CALIBRATION.md` first — they tell you what really happened.
