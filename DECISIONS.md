# Decisions

Append-only. Newest at the bottom. Each entry: date, decision, reason.

## 2026-09-10 — Phase 0

- **Box score only, no live game.** Interview answer. Engine returns finished games. Bake-off judged on calibration and speed, not event streaming.
- **Opening-night drop-in.** Interview answer. Bundles hold rosters, contracts, cap as of game 1 of the chosen season.
- **Browser tab runtime.** Interview answer. Vite dev server, IndexedDB saves with JSON export. No Tauri.
- **Pipeline in TypeScript, not Python.** BRIEF A3 says TS end to end. `nba_api` is used as the endpoint catalogue, not as a dependency. stats.nba.com is plain HTTP either way.
- **npm workspaces, not pnpm.** pnpm is not installed and BRIEF A10 forbids touching anything outside the repo.
- **`node:sqlite` for the pipeline DB.** Built into Node 26. No native modules to compile.
- **Contract terms inferred from forward salary history.** No free bulk source for contract length and options. Rows flagged `inferred`. Deviation from "real contracts": partial, logged in REPORT.md per season.
- **`data/REPORT.md` is committed.** `data/` stays gitignored except this file. It is derived, not raw data.
- **Local commits are allowed.** Worktree lanes need commits to merge. Never push.

## 2026-09-10 — Phase 1

- **stats.nba.com is called from Node's fetch only.** curl hangs on Akamai's TLS fingerprinting; Node (undici) returns 200 with the browser headers in `packages/data/src/nba/client.ts`. All 13 endpoints the pipeline needs were proven with real rows on 1997-98, 2003-04, 2015-16, 2020-21 and 2025-26.
- **Two primary sources, each the other's cross-check.** stats.nba.com for rosters, bio, per-100, advanced, game logs, standings, draft. The basketball-reference-derived open CSVs in `sumitrodatta/bball-reference-datasets` (GitHub, updated 2026-04) for shooting zones, awards, All-NBA, career info, team summaries. BRIEF A4 allows open datasets on GitHub; we never hit basketball-reference's servers for bulk data.
- **Kaggle is out.** Downloads need an account. BRIEF A10 says don't sign up for anything. The `wyattowalsh/basketball` lead is dropped.
- **Salaries 1985–2020 from `sumitrodatta/nba-player-salaries`.** 2020-21 onward has no GitHub dataset found yet; Lane B is proving Wayback Machine snapshots of the basketball-reference contracts page (one request per season, cached). Outcome to be recorded here.
- **Calibration targets come from the data, not the era table.** League-average pace, ORtg, 3PAr, FTr, TOV%, ORB% per season are read from Team Summaries and cross-checked against stats.nba.com team advanced stats. The era table holds rules and money only.
- **Engine interface fixed before the bake-off** in `packages/core/src/types.ts`: `simulateGame(GameInput, seed) → GameResult`. Ratings (how well) and Tendencies (how often) are separate so generated players can drift both.
- **Raw cache is shared across worktrees** via `HOOPS_DATA_DIR=/Users/mkm/Code/lab/hoops-dynasty/data`. Lanes never duplicate fetches.

## 2026-09-11 — after the Phase 0 fresh-eyes review

- **Ratings sit on a fixed pooled anchor, not per-season z-scores.** The reviewer showed era-relative
  ratings break the fate slider, development curves, Hall of Fame and cross-era records. SPEC §5 updated.
  Era effects live in Tendencies and EraContext.
- **EraContext gained zone shot shares, zone FG%, and home win%.** The possession and play-by-play engines
  need zone baselines; home-court edge fell from ~.60 to ~.54 over the range and the standings check needs it.
- **`GameInput.seasonType` added** so engines can tighten playoff rotations.
- **Post-latest seasons freeze EraContext and rules at 2025-26; money grows 7%/yr by default.** Simplest
  rule that keeps 20-year runs playable. The 7% is a game setting.
- **Harness standings criterion is pearson(mean sim wins, real wins) ≥ 0.8.** A single real season is one
  noisy draw; expected wins measure whether ratings and engine rank teams right. Per-run r is shown too.
  Targets in BRIEF A7 are unchanged.
- **Harness real-minutes mode plays traded players for the right team** via per-stint records in the bundle.
- **Bundle gained `yearsWithTeam`, contract `kind` and per-year `guaranteed`, real box totals, and a
  per-season history summary.** Bird rights, rookie-scale and two-way typing, records and the side-by-side
  view all need them.
- **Fetcher hardened.** Suffix host matching, cross-process throttle for slow hosts (lock under
  `data/raw/.throttle`), a 24 h block marker on a basketball-reference 429, atomic cache writes, and cached
  4xx markers so offline re-runs are complete.
- **Schema:** `stint` joined the player_seasons key, player_games gained made-shot columns, awards accept
  coaches (recipient column), and a `coaches` table was added (commonteamroster returns coaches free).
- **Gaps accepted and logged:** future traded picks as of opening night (every team owns its own picks;
  no free source). Draft-and-stash rights (e.g. Ginóbili 1999→2002) are not in the bundle.
- **Deferred to their phases:** expansion draft rules go in the era table (Lane C); `EraRules` interface
  lives in `packages/core/src/era.ts` (Lane C); schedule generator is Phase 3; expansion flow is Phase 5.
- **Lanes were cut off by the session rate limit overnight** (2026-09-10 → 11). Lane A's fetch finished on
  its own; A and B were resumed with context intact; C was relaunched fresh.

## 2026-09-11 — Lane B outcome (open datasets, salaries)

- **Salaries 2020-21 → 2025-26 come from Wayback Machine snapshots of the basketball-reference contracts page**,
  one snapshot per opening night (2020-12-24, 2021-10-24, 2022-10-10, 2023-10-23, 2024-10-07, 2025-10-20).
  This is basketball-reference by proxy, so it departs from "cross-check only" for one table over six seasons.
  Reason: no open dataset covers those years; archive.org is a free public source and its rate rule (one request
  per 4 s) was kept. Six page fetches total. The page lists standard contracts only: 70–81% of players with a
  stint that season; two-way, 10-day and Exhibit 10 deals are missing and will be inferred as minimums.
- **archive.org's availability API returned 429; the CDX index is used instead** (one cached request).
- **Salaries 1985–2020 come from `sumitrodatta/nba-player-salaries`** (basketball-reference-derived CSV).
  Ids matched by season + team + normalised name: 84–98% per season; 916 of 11,690 rows go to the id override list.
  2013-14 is short at source (412 rows).
- **2026 awards and All-NBA are missing** from the open dataset (repo updated 2026-04-13, before the awards).
  Gap logged; the 2025-26 bundle will carry no awards until the source updates or a second source is proven.

## 2026-09-11 — Lane C outcome (era rules)

- **`EraRules` lives in `packages/core/src/era.ts`; the data lives in `packages/data/src/era/era.ts`.** The game
  and the worker import the type without touching node:sqlite.
- **Playoff seeding 1998–2004 corrected to `division_winners_top_2`.** BRIEF/SPEC drafts said top 3; each
  conference had two divisions then, so two division winners took seeds 1–2. Source: Wikipedia season pages.
- **Unverified values are flagged per season in `ERA[year].unverified`** and listed in
  `packages/data/src/era/SOURCES.md`: 1997-98 trade matching and BAE, expansion-draft minimum picks for the
  1995 precedent, 2002-03 and 2003-04 tax lines (rounded), 2020-21 minimum salaries (2019-20 reused), 2025-26
  tax bracket width. Everything else cites a page that was read.
- **Where sources disagreed the era table notes the choice** (2019-20 #1 pick scale, 2017 CBA roster minimum
  of 14, one expansion pick per team in 2004).

## 2026-09-11 — Phase 1 fresh-eyes review

- **Verified by the reviewer's own queries:** 1997-98 CHI 62-20 with Jordan; 2015-16 GSW 73-9, Curry 402 3PM; 2011-12
  66 games; 2003 draft #1 LeBron to CLE; 2004 MVP Garnett; 2016 cap $70.0M / tax $84.74M; LeBron 2025-26 $52.6M;
  Anthony 2010-11 two stints, opening-night DEN; 15 series every season; offline reload 5.9 s with identical counts;
  `git ls-files data` = REPORT.md only; two basketball-reference pages ever fetched.
- **Defects found, all loader-side, sent back to the loader lane:** the 20-man opening-night cap ranked by first-stint
  minutes and dropped one 500-minute player and fourteen 200-minute players; the 2024-25 contract snapshot predates
  most 2024 signings (48 rotation players without contracts); `yearsWithTeam` ignored pre-1998 seasons; 35–42 early
  players had weight 0 though the bio endpoint has it; rookie-scale kind missed years 2–4 of top picks; spot checks
  covered one table; contract.teamId held the season-end payer.
- **Fixtures are trimmed slices of real responses (~190 KB).** Kept: they are test data of a few rows to a few hundred
  rows per file, not a redistributable dataset. BRIEF A4's rule is read as "no raw dumps in git". Revisit if they grow.
- **Salaries have no independent second source.** Both the CSV and the Wayback snapshots derive from basketball-reference.
  Payroll totals are checked against the cap and tax line instead. Stated in REPORT.md.

## 2026-09-11 — model switch

- **Fable's usage limit ran out mid-run; Matt switched the session to Opus 5.** All five Phase 2 lanes had died at
  launch without doing work, so they were relaunched fresh rather than resumed, and now inherit Opus 5.
  Sub-agents never get a model override: they follow whatever the session is on.
- Commits from here carry the Opus 5 co-author line. Earlier commits keep the Fable line. No work was redone.

## 2026-09-12 — Phase 5 groundwork (progression)

- **Age curves are fitted from the data, not invented.** `npm run progression:curves` walks all 2,786
  real careers in `history.json` and records the year-over-year rating change at each age, minutes
  weighted, plus the share of players at each age who never appeared again. Ages with thin samples
  borrow from their neighbours.
- **Survivorship is corrected in two places.** The fitted curves only see players who were still in
  the league the next season, so they understate decline. `develop()` amplifies losses past 29 and
  taxes high-rated thirty-somethings; `retireChance()` makes leaving strongly quality-selective,
  sharpening with age. Checked against the real league: a modelled cohort's surviving average tracks
  the real average by age to within ~1.5 rating points from 24 to 35 (it runs ~3 low at 37+, where
  the real sample is a few dozen of the most selected players alive).
- **The fate slider lives in `blendToFate()`.** 0 = a real player's real ratings that season, 100 =
  the model. Anything between blends, so history bends instead of snapping.
- **Development is a separate package (`packages/progression`)** rather than living inside
  `packages/game`, so the season loop can be built and tested without it.

## 2026-09-12 — integration

- **The web app owns the box-score cache, not the game state.** `packages/game` stores season totals;
  keeping every box would bloat the save. `apps/web/src/sim/real.ts` wraps the injected engine, pairs
  its results with the day's summaries (same order) and keeps the last 400.
- **Continue walks the offseason.** Between seasons there are no games but plenty of news, so one
  press steps through the lottery, draft, retirements and free agency and returns the story.
- **Rookies never reach the open market.** They sign rookie-scale deals with the team that drafted
  them (`rookieScale`/`rookieContract`). Before that, drafted players arrived contract-less and the
  free-agent market cut the weak ones the same summer.
- **Teams fill to `roster_max - 1`, and undrafted free agents backfill the league.** Two draft rounds
  do not replace everyone who retires; without a backfill the league drained to 260 players and teams
  dressed nine men. With it, twelve simulated seasons hold ~400 players on 11–14 man rosters.
- **Unsigned players linger.** A veteran nobody signs becomes a free agent rather than vanishing;
  only players over 35 and below replacement level leave for good.

## 2026-09-12 — offseason screens

- **One generic `manager` message carries every `ManagerActions` call.** The worker owns the Dynasty
  instance, so the offseason could not be reached without adding to `apps/web/src/sim/*`. Rather than
  a dozen typed messages — one per action, and a merge conflict for every lane building a manager
  screen — the protocol gained a single `{ kind: 'manager', method, args }` passthrough that the
  worker dispatches by name and `SimClient.manager<T>()` calls. Twelve lines across three files;
  the trade and tactics screens can use the same door.
- **`financeOf` takes the year.** The offseason cap sheet read $0 payroll: the market opens *after*
  the rollover has moved every contract on a year, but `financeOf` still asked for the season just
  played. It now takes `yearEnd`, and `offseasonView` passes next season's once the market is open.
  `finance(teamId)` in-season is unchanged.
- **The offseason screen holds its last view.** `finishOffseason()` starts the new season, so
  `offseason()` goes null on the next poll. The screen keeps the final state once it has written a
  summary, otherwise the "who you drafted, who you signed, who left" panel would vanish on render.
- **The summary is a roster diff, not a sim report.** The api has no "what happened to my squad"
  call, so the screen snapshots the roster before `finishOffseason()` and diffs names after.
  Drafted names are accumulated from `picks` as they land, because the rollover clears the board.

### Found while verifying, not fixed (not this lane)

- **The market ignores the cap.** A deliberate $95M/yr offer for a $13.2M asking price was accepted
  on a team with $13.2M of room. `runMarket` does not check the bidder can pay. The screen warns;
  the sim does not refuse.
- **Second-round picks do not reach the roster.** A pick at #56 landed in the draft and appeared in
  the offseason summary, but was not on the roster when the season opened. `signRookies` or the
  roster cap drops him.

## 2026-09-12 — the manager's powers

- **The UI reaches the sim through one door.** Three lanes each needed `ManagerActions` in the
  worker; the merged answer keeps both shapes — typed messages for the trade calls and a generic
  `{ kind: 'manager', method, args }` passthrough for everything else.
- **The cap binds the user.** His offers go through the same room / exception / Bird-rights test as
  the AI's, and a refusal comes back with the reason. Found by driving the market with a $95M bid
  on a team with $13.2M of room, which the sim had happily accepted.
- **Continue stops when the season does.** The lottery, draft and market are played through their
  own screens rather than happening while the user is not looking.
- **The finished draft board is snapshotted before the rollover clears it**, so the summary can
  still say who you took when your picks were made for you.

## 2026-09-12 — minutes, fatigue and injuries

Three play-testers found the same cluster of faults. The fixes, and why they are shaped this way.

- **Ranking a squad by a flat mean of nineteen ratings was the root of half the complaints.** It
  buries a specialist (Rodman 1998, the rebounding champion, was his own team's twelfth man at 2.9
  mpg), it pays a centre for perimeter defence, and because the rating anchors are pooled across
  all five positions it hands every guard a huge passing/steal z and every big a huge block/oreb z.
  `roleRating(ratings, tendencies, pos)` in `packages/progression` replaces it for ranking: six
  weighted aggregates, shooting weighted by the *value* of the zones a player actually shoots from,
  a volume term on usage, then standardised inside the position against the pooled 1998–2026
  distribution of 500-minute seasons. Against real minutes it correlates 0.34–0.44 where the flat
  mean managed 0.21–0.33, and its top fifteen in a season now reads like that season's All-NBA.
- **`overall()` itself is deliberately unchanged.** `packages/draftclass` and `packages/frontoffice`
  calibrate against its scale, and they are other lanes. `roleRating` is additive; those packages
  should move to it when their owners are ready.
- **The minutes ladder is not one ladder.** `SLOTS = [35,34,...]` meant nobody in any era passed
  35.0 mpg against real leaders of 41.5 (1998) and 37.9 (2024). Minutes now come from an eleven-man
  ladder tilted by how far each man sits above his team's mean, capped by an era ceiling that walks
  from 42.5 down to 37.5 across the range, and renormalised to 240.
- **The real-minutes hint sets the load, not just the order.** It was capped at 12 and halved, which
  threw away the best information there is on opening night. It now carries 75% of the first
  simulated season's depth score *and* 75% of the minutes, 30% the year after, and nothing later.
  `LeaguePlayer.hintYear` records which season the hint describes; without it there is no way to
  know how stale it is. Opening-night rotations now correlate 0.97–0.99 with real minutes per game.
- **Availability runs during the season, not once a summer.** `seasonAvailability` was called in the
  offseason hook and its answer discarded, so `condition: 1` was hardcoded into every game input and
  348 of ~380 players finished on exactly 82 games. `GameState.availability` now holds one record
  per player — games still to miss, the injury, condition, games since a return, games missed — and
  `playGame` settles it after every game for both rosters. It is optional on the type so saves
  written before this still load; read it through `availabilityOf`, never directly.
- **Fatigue is calibrated against the calendar, not guessed.** 82 games in ~165 days is a game every
  two days, so in `nextCondition` two days of recovery (0.10) exactly pays for a 36-minute night
  (0.10). A 36-minute starter holds condition all year; anyone asked for 44 slides to the floor.
  Condition then feeds both the engine's energy and the injury hazard, and the hazard's load term is
  uncapped and convex, so a 48-minute night is roughly three times as dangerous as a 30-minute one
  at the same fitness. Riding five men is no longer free: see the table in this commit's message.
- **The manager still gets the minutes he asks for.** The era ceiling binds the automatic coach, not
  a human who types 44. He gets 44, and he gets the bill.
- **Retirement was inverted and is now the right way round.** Selection used to sharpen *with* age,
  so a 60-overall 24-year-old was 2.5x likelier to vanish than the same player at 34. Nobody gives
  up on a good young player; a good old one is a year or two from the end whatever he is doing. So
  selection is strongest when young and relaxes with age, the base rate carries the rise, and the
  quality term is asymmetric — protection above average is worth more than the punishment below it,
  or every fringe twenty-something would be gone in one summer.
- **A season that was played always records its trophies.** Awards were computed in exactly one
  place, the branch that notices the last regular-season game. Any other route into the books wrote
  `awards: null` into history. `summarise()` now computes them if the games exist and nothing else
  has.

### Found while fixing, not fixed (not this lane)

- **`apps/web`'s develop hook rolls a second, fictional season of injuries** to apply lingering
  penalties (`real.ts`, the `seasonAvailability` call). The real spells are now in the state; that
  hook should read them instead of inventing new ones, or a player is taxed twice.
- **`packages/engine/src/possession.test.ts:107` fails `biome check`** (`useIterableCallbackReturn`).
  Pre-existing on HEAD and in another lane, so left alone.

## 2026-09-12 — the league remembers (careers, records, hall of fame)

- **A career is a packed string, not a list of objects.** DESIGN-THEMES §1 says attachment to
  individual people is the whole game, and that needs a record that outlives retirement. Every
  reducer `structuredClone`s the save once per simulated day — about 5,000 times in a 30-season run
  — and clone cost tracks the *number of objects*: 15,000 small objects cost 13 ms a clone, the
  same data as strings costs 0.3 ms, and one string per player costs nothing measurable. So
  `GameState.careers` is `Record<playerId, string>`, one packed line per season inside it, decoded
  only when something asks a question. 30 seasons headless: 2.4 s against a 2.0 s baseline, with
  14,485 season lines in 1.1 MB of a 1.9 MB save.
- **Season and career records are derived; single-game records are kept.** A 61-point night cannot
  be recovered from totals, so `playGame` checks six categories against a small book as each game is
  played. Everything else — best season, career leaders, franchise lists — is recomputed from the
  career store, so the two can never drift apart.
- **Retirement is detected by diffing the roster across the develop hook.** `packages/game` does not
  own retirement (`apps/web`'s progression hook does, and that is another lane), and the hook hands
  back a shorter roster without saying who left. `rolloverBegin` holds the roll of names, calls the
  hook, and diffs. That keeps the memory in this package without reaching into anyone else's.
- **Only ten farewells a summer, and only for men of substance.** Forty players retire in a summer.
  The bar is 500 games, 8,000 points, any award — or 300 games for a one-club man, because that is
  the thing the research says people cherish most, and it is said out loud in the letter.
- **The hall of fame is a three-year ballot, at most three a year.** Accolades dominate the score
  (an MVP is worth 20, an All-NBA first team 8, 1,500 career points 1), because that is how halls of
  fame actually behave. The case is written in sentences at induction and stored with him.
- **The history screens read the save, not a new seam method.** `apps/web/src/sim/api.ts` is another
  lane's file. The app already takes a full save after every simulated day for the autosave, so the
  store keeps that state and the Dynasty and career screens read the league's memory off it. No
  extra work per day, and no new method on the worker protocol.

## 2026-09-12 — the playbook: a starting five, a system, instructions

- **Everything a coach sets is a transform of `Ratings` and `Tendencies`, never a number added to
  the score.** `packages/core/src/playbook.ts` holds the lot as pure functions. A system changes
  who shoots and from where; an instruction changes one man's diet; being out of position takes
  away the ratings that slot needs. The engine then does exactly what it always did. This is what
  makes a misfit genuinely bad rather than cosmetically bad: an offence that feeds a big who cannot
  finish really does take worse shots, and the points per possession falls out of the shot mix.
- **Neutral in, neutral out, and it is tested.** `balanced` with no lineup and no instructions
  returns every input object untouched, `outOfPosition` is the identity in a man's own slot, and no
  `workRate` is sent when nobody has been instructed. A calibration run over 1998/2004/2016 is
  byte-identical to the previous CALIBRATION.md apart from its timestamp.
- **The fit panel runs the engine's own shot arithmetic.** `systemFit` scores a system by the
  expected points per shot this roster would produce under it, using the same GAIN, SHOT_K and
  REF_ZONE constants the possession loop uses (duplicated into core with a comment saying so —
  core cannot import the engine). So the screen's verdict and the box score cannot disagree. On
  four synthetic rosters the top-rated system beats the default every time and the bottom-rated
  never does.
- **Motion deliberately does *not* trade mid-range for threes.** Every system that does gains in
  this engine whatever the personnel, because a bad three is still worth more than an average
  mid-range jumper — which is true, and which made "does it fit?" meaningless. Motion's whole
  mechanism is flattening usage toward the league mean, so it pays on a team whose most-used man is
  not its most efficient and costs on a team where he is. That is the only version of the system
  that can be honest about its own trade-off.
- **Three engine terms, all zero at the default.** `PlayerGameInput.workRate` multiplies stamina
  drain; the pace tactic drains the team that called it; and the *defence's* `crashGlass` now
  improves the offence's shot quality, because a team that crashes is a team that is not back.
  Before that last one, `crashGlass: 1` bought second chances and cost nothing at all.
- **A season-long instruction has to cost something across the season, not just in the fourth
  quarter.** `play.ts` bills the night's minutes by the work rate before `nextCondition` and the
  injury roll see them, so a squad told to get after it and crash ends the year more tired and
  misses more games. Without that, "everybody try hard" was free.
- **The position penalty applies only to slots the manager filled.** The automatic coach does not
  assign positions at all, so there is nothing for it to be out of; naming a five is taking
  responsibility for the fit. It also keeps an untouched save playing exactly as it did.
- **The minutes budget is enforced in the screen, not explained away.** The sim renormalises
  explicit minutes to 240, which is a fair model and reads as a bug when the header says 279. What
  is left to assign is now the largest number on the page, a stepper cannot push the team over, and
  "Balance to 240" scales the shape the manager set into the budget (clamp-and-renormalise, the
  same fixed point `fitTo240` runs) as distinct from "Reset to automatic", which throws it away.
- **The instruction editor sits under the rotation table, not inside it.** A CSS grid in a
  colspanned `<td>` inherits the table's max-content sizing and the columns blow apart. Found by
  reading a screenshot, not by reasoning about it.

## 2026-09-12 — player roles and morale (PICK-LIST A1)

The most-missed mechanic in twenty years of 2K franchise modes, and the only one in the research
that is a *refusal*. So it is built as a constraint, not a feature: there is nothing to click, and
the only answers to it are decisions the manager already makes — minutes, contracts, trades.

- **A role is the better of what a man is and what he is paid.** `roleRating` puts him on a 0–99
  scale (70+ star, 58+ starter, 46+ rotation); his salary as a share of the cap puts him on the
  same ladder (20%+ star, 10.5%+ starter, 4.5%+ rotation). He expects whichever is higher, because
  a club that pays a man like a franchise player has told him what he is, and a minimum-salary
  veteran who is genuinely good still expects to play.
- **Morale is a target plus inertia, never a hidden roll.** Seven named terms — minutes against
  what the role expects, share of the scoring, crowding, the team's record, his own form, tenure,
  a recent trade, a contract year — add to a target; the stored number walks 6% of the way to it
  after each game his team plays. So a slide is visible a month before it matters, and the player
  card can show the arithmetic. `why()` reads back the term that dominates, and follows the mood:
  what is keeping a happy man happy, what is eating an unhappy one.
- **Stacking costs you through crowding.** `ROLE_ROOM` says two men can be the man, five starters
  can start, nine can be in the rotation. Rank inside your rung past that room is −14 a place, to
  −34. That single line is the whole "you cannot just stack your team": five stars on one roster
  means three of them are told, every night, that they are not what they were told they were.
- **The room reaches the engine through two inputs it already had, and nothing else.** No thumb on
  the scoreboard, no rating touched — an unhappy man is as good as he ever was.
  - `condition` is energy: the engine seeds it, drains it, and cannot recover a man above it, and
    every shot carries `FAT_K * (energy - FAT_REF)`. x0.86 at the floor, x1.05 at the ceiling.
  - `tendencies.usage` is how often he finishes a possession *relative to the other four on the
    floor*, so a man who has stopped asking for the ball hands those shots to whoever is next to
    him. x0.80 to x1.05.
- **Condition alone was not enough, and the reason is worth recording.** It sits inside a loop: a
  flat squad plays fewer hard minutes, so fatigue gives back what the mood took. Measured on a
  stacked 2003-04 roster over a full season, a 5% effort penalty left the mean condition arriving
  at the engine unchanged to three decimal places (0.8179 against 0.8196) — the system was
  self-cancelling. Engagement does not come back, and it is also the most recognisable thing an
  unhappy player does.
- **A trade is detected, not signalled.** The morale record carries the club it belongs to; when
  that stops matching the player's team he has moved, and the unsettling applies for twenty games.
  Nothing in the trade code has to know this system exists.
- **The summer is where it really bites.** An unhappy man asks the club that made him unhappy for
  up to 30% over his market price — and nobody else: at any other club he asks the going rate.
  Below morale 28 he stops being an incumbent at all, which costs that club its Bird rights and
  the loyalty edge every other bidder has to beat.
- **The rumour mill stopped guessing.** "X is unhappy with his role" used to be inferred from a
  rating against minutes, so the paper could report a grievance the game did not hold. It now
  quotes the stored number and its reason.
- **Two condition multipliers now compose, deliberately.** The head coach's man management
  (`staff.ts`, ×0.97–1.03 on the whole squad, another lane's) and a player's own morale
  (`play.ts`, ×0.86–1.05 on him alone). A coach who keeps a room fresh is not the same thing as a
  man who is getting the minutes he was promised.

### The super-team experiment (`experiments/superteam.ts`, 50 paired seeds, 2003-04, real engine)

Five best players in the league on one club with seven minimum-salary bodies, against twelve honest
starters whose total ability matches to within 0.7 points over twelve men. Both play the same
league, the same schedule, the same seeds, once with the dressing room switched off and once with
it on (`setMoraleEffects`, a harness seam the game never touches).

| mean wins      | morale off | morale on | change          |
|----------------|-----------:|----------:|-----------------|
| super-team     |       65.1 |      63.0 | **−2.10 ± 1.48** |
| balanced       |       58.5 |      58.5 |  0.00 ± 1.44    |

Stacking was worth **+6.6 wins** over an equally talented balanced roster; with the dressing room in
it is worth **+4.5**. The super-team pays for it and the balanced roster pays nothing, which is the
shape the mechanic should have: morale is a tax on how you assembled the squad, not a tax on
everybody.

It pays again in July. The stacked locker room finishes at 45 against 55, with Bryant at 22,
McGrady at 30 and Cassell at 34 — Bryant past the walk-away line, so he will not re-sign at any
price, and the other two cost a 12–17% premium if they do.

An earlier 20-seed run of this experiment reported −5.1 wins. That was a draw, not a finding: the
paired standard error at n=20 is about 1.2 wins and the run happened to land three of those out.
The table above is n=50 with the interval stated, which is the number to quote.

Re-signing prices, 2003-04 Spurs (`experiments/resign.ts`): a man at morale 20 asks $12.88M where
the market says $10.96M; at 5 he asks $13.70M, and will not sign anyway.

## The playoffs belong on the front page (2026-09-12)

Home's "Next up" panel answered a live playoff run with **"No games left on your schedule."**
Correctly, from its own point of view: `nextGame()` searched `calendar.schedule`, and playoff
games are never on it — they are minted a round at a time as the bracket resolves. So a manager
at 3–1 up in the conference semi-finals was told he had nothing to play.

The fix is not a new source of truth. `nextFixture` in `real.ts` looks in three places in turn —
the schedule, the live play-in game, the undecided series — and the first one that answers is the
fixture the next `simDay` will play. It returns the gameId the sim will mint, so the box score is
findable afterwards; a test plays the game and looks it up to prove the two agree.

Home court is read from the sim, not re-derived. `homePatternFor` was split out of `homePattern`
so a screen can ask "am I at home in game five" without holding a `GameState`. One rule, one
place: a preview cannot be contradicted by the game it previews.

`GamePreview.playoff` is optional and `postseason()` is a new view. Nothing existing changed
shape, and no save gained a field.

**The wording is the feature.** `postseason.ts` holds every sentence and nothing else, so the Home
panel and the Playoffs screen cannot disagree about what tonight is worth: "Spurs trail 1–3",
"Spurs must win to stay alive.", "Pacers knocked you out. They beat you 4–1 in the Eastern
Conference Semi-finals." Missing the playoffs now reports a record — "You finished 21–61, 15th in
the Eastern Conference, and missed the playoffs" — rather than an absence. Silence was the bug.
