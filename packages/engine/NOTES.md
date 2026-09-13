# Engine lane — possession model

`packages/engine/src/possession.ts` is the bake-off entry, exported from `index.ts`.
`naive.ts` is untouched and still reachable at `@hoops/engine/naive`.

## Shape

A clock, not a formula. Possessions alternate until 48 minutes are gone, then 5-minute
overtimes while the score is tied. Each possession: pick the user by usage among the five
on the floor → turnover? → shot zone from his tendencies → shooting foul? → make/miss →
free throws → rebound battle → assist. An offensive rebound extends the same possession.

Two files:

- `anchors.ts` — solves the per-game constants from `EraContext` once, before the loop.
- `possession.ts` — the loop, the rotation and the play-by-play.

`simulateGame(input, seed)` builds the play-by-play. `simulateGameWith(input, seed, {pbp:false})`
skips the strings; the box score is bit-identical either way (tested).

## The anchoring rule

Every probability in the loop is an era anchor perturbed by a log-odds term built from
ratings. Nothing is invented. The anchors are solved, not guessed:

1. Bisect the shooting-foul level so `FTA/FGA = era.ftr`, weighting zones by *shot events*,
   not by recorded FGA — a fouled miss is no attempt, and rim shots draw far more fouls.
2. Back-solve each zone's unfouled make probability so recorded FG% = `era.zonePct`
   (recorded FGA on a fouled event only exist when the shot went in, which inflates FG%).
3. Expected shot events per possession as a geometric series in the rebound continuation.
4. Block level so blocks per 100 = `era.blkPer100`; the remainder of `era.pfPer100` becomes
   non-shooting fouls.
5. Field-goal ORB rate solved so the blend with missed free throws (recovered far less
   often) lands on `era.orbPct`.
6. One log-odds shift on every make probability closes points per possession on `era.ortg`.
7. Mean possession length so possessions land on `era.pace`, adjusted by both pace tactics.

**Reference ratings, not 50.** 50 is the pooled all-player anchor from `packages/ratings`,
but a league average is taken over the players who actually do the thing, and shots are
taken by good shooters. The opportunity-weighted league means are stable to about a point
over 1998–2026, so they live in `REFERENCE` (exported for the era-fidelity test):
rim 52.3, close 54.1, mid 54.6, three 55.6, ft 51.3, handling 51.0, iq 52.6, passing 52.0,
drawFoul 50.5, five-man aggregates 50.5, stamina 55.0. A league of players sitting at their
references reproduces the `EraContext` to within a band — that is `anchors.test.ts`.

**Convexity correction.** `oddsAdj` is not linear, so spreading ratings around the reference
moves the *mean* rate off the anchor. Each anchored probability gets a second-order
correction using the opportunity-weighted sd of the driving rating, measured from the two
rosters actually playing rather than assumed. Without it the league drifts as the gain rises.

## Two gains

- `GAIN = 1.3` on terms driven by one player's own rating. Held low enough that the best
  shooter in the league shoots like the best shooter in the league.
- `TEAM_GAIN = 3.5` on terms driven by a five-man aggregate (team defence, the glass, ball
  pressure). A five-man mean varies far less than one rating, so this can be much larger
  without producing superhuman individuals — and it is where team identity actually lives.
  This split is what makes the standings spread match without breaking the shooting bands.

## Game-to-game variance

Real NBA scores are *under-dispersed* against an independent-possession model and *positively
correlated* between the two teams (2016: r = 0.35, margin sd 13.3). Two mechanisms fix that:

- `PACE_SD = 0.05` — one shared pace multiplier per game. Both teams get the same number of
  possessions, so this is where the positive correlation comes from.
- `REVERT = 0.013` — a restoring force on the running margin (score effects: leads get
  answered, the leader coasts). It compresses noise faster than it compresses a real talent
  edge, so the standings spread survives.

Measured against 2016: margin sd 12.9 (real 13.3), home/away correlation 0.48 (real 0.35).

`HOME_K = 0.46` maps `era.homeWinPct` to a log-odds edge on every shot. Two identical teams
land on .590 in 2016 (era .589) and .587 in 1998 (era .595). `neutralSite` gives .500.

## Rotation

Greedy on minute debt, checked every 6 possessions. The debt is measured **in units of the
player's own stint length** (`need / min(rate, 1-rate)`), not raw seconds — a dead band in
seconds costs a 40-minute starter minutes he can never win back, which compressed every
rotation toward the middle. Mean minutes error is now about 1 minute per player-game.

Foul trouble sits a player a foul ahead of the period, less aggressively the bigger his role.
A player in foul trouble also commits fewer fouls (he stops contesting). Disqualification at
6. Garbage time flips the rotation toward the bench. Foul-outs land near 0.4/game in 2016
rules and 0.6/game in 1998 rules.

## Who gets the credit

The league totals are one job; sharing them out between the five men on the floor is another,
and a flat draw makes every leader board look like a rotation average.

- **Assists.** `tendencies.assist` is assists per possession the player *uses*, so a
  high-usage creator's number is deflated by his own shot volume — Dončić and a backup point
  guard can carry the same tendency while the box scores differ threefold. The draw weights
  `assist * usage`, which is assists per *team* possession, raised to `AST_EXP = 1.32`: the
  primary creator collects more than his rate alone implies, because he has the ball on the
  possessions that end in a catch-and-shoot. 2024's assist leader went from 8.1 to 10.4
  against a real 10.9, and Dončić from 4.5 to 9.2 against 9.8.
- **Rebounds.** `exp(REB_K * dv(rating))` with `REB_K = 1.22`, not a linear weight. A linear
  weight tops out near 3x between a 99 and a 26, where the real per-minute ratio is nearer 4x,
  so every rebounding champion leaked boards to the bench. Top-10 rpg now tracks the real
  top-10 to within 3% in all four checked seasons.
- **Team rebounds and team turnovers.** The box score is a *player* box score. A miss that
  caroms out of bounds is a team rebound, a shot-clock violation is a team turnover, and
  neither reaches a player's line — which is why the real player rebound totals add up to
  86–88% of the misses and why real player turnovers sit under the team rate. `TEAM_REB_SHARE`
  and `TEAM_TOV_SHARE` model that. Both come out of a draw the engine was already making, so
  the random stream, and therefore every game result, is untouched: they move the bookkeeping
  and nothing else. Team defensive rebounds fell from 34.1 to 29.3 in 1998 (real 28.5) and
  from 38.0 to 32.9 in 2016 (real 33.3); turnovers from 15.5 to 14.8 in 1998 (real 14.8).
  `era.tovPct` counts team turnovers, so the recorded TOV% now sits deliberately below it —
  `anchors.test.ts` accounts for the gap.
- **A drifting reference.** `drawFoul` is the one reference rating that really moves: the
  shot-event-weighted league mean climbs from 50.3 in 1998 to 52.4 in 2024 as the whistle
  follows the primary option, and at `GAIN * 0.75` that alone lifted the modern free-throw
  rate by 4%. `FOUL_RECENTRE = 0.6` takes most of the mean measured from the two rosters back
  out of the anchor, shrunk toward the constant because two rosters are a noisy estimate of a
  league. 2024 FTA went from 22.9 to 22.4 against a real 21.7.

## Usage

`USAGE_EXP = 1.18`: the chance of ending a possession goes as usage^1.18, not usage. A
primary option shoulders more on the floor than his season rate implies. Without it the
top-10 scorers in modern seasons came in 2-3 points per game short.

## Calibration

`npm run calibrate -- --seasons 1998,2004,2016 --runs 20 --minutes real --engine engine`

| season | win r (expected) | win r (per run) | wins sd real / sim | out of band |
|---|---|---|---|---|
| 1998 | 0.940 | 0.903 | 15.5 / 14.7 | 0 |
| 2004 | 0.910 | 0.868 | 11.2 / 13.3 | 0 |
| 2016 | 0.875 | 0.841 | 13.9 / 13.9 | 0 |

Every league band (pace, ORtg, 3PAr, FTr, TOV%, ORB%, FG3%, FG2%, FT%), the player
distributions (top-10 ppg, mpg, fga/g) and the monotonicity check pass on all three.
2024 spot-check, 10 runs: win r 0.928, 0 out of band.

Against the real *player* lines, per team-game (real | sim, 6 runs, `--minutes real`):

| season | AST | ORB | DRB | TOV | FTA | 3PA |
|---|---|---|---|---|---|---|
| 1998 | 22.0 \| 22.0 | 13.1 \| 13.2 | 28.5 \| 29.3 | 14.8 \| 14.8 | 26.3 \| 27.0 | 12.7 \| 13.2 |
| 2004 | 21.3 \| 21.3 | 12.1 \| 11.8 | 30.1 \| 30.6 | 14.2 \| 14.3 | 24.2 \| 24.6 | 14.9 \| 15.3 |
| 2016 | 22.3 \| 22.0 | 10.4 \| 10.2 | 33.3 \| 32.9 | 13.8 \| 14.3 | 23.4 \| 23.9 | 24.1 \| 24.2 |
| 2024 | 26.6 \| 26.4 | 10.5 \| 10.0 | 32.9 \| 32.9 | 12.9 \| 13.2 | 21.7 \| 22.4 | 35.1 \| 35.2 |

Top-10 leader means, real | sim: apg 8.64\|9.13, 7.54\|7.89, 8.68\|8.34, 8.84\|8.86;
rpg 11.67\|11.62, 11.52\|11.47, 11.66\|11.36, 11.85\|11.77.

Also clean at 8-10 runs: 2001, 2006, 2010, 2012, 2019, 2023, 2025, 2026.
Two seasons still miss: **1999** (50-game lockout, win r 0.79 and FG2% 1.3 pts low) and
**2021** (72 games, win r 0.77). Both are short, disrupted seasons where the real standings
carry more noise than 82 games do; the league rates are in band in both.

Speed: 1,230 games with the play-by-play on in ~130 ms; 20 runs of a full season in 2.6 s.

## Deliberately left out

- **End-game tactics.** No intentional fouling, no three to tie, no timeouts. Overtime
  happens in ~4% of games against a real ~6%, because the trailing team never extends
  the game on purpose.
- **Penalty situation.** Every free throw comes from a shooting foul; team fouls and the
  bonus are not tracked. `era.ftr` and `era.pfPer100` are both reproduced, so the totals
  are right even though the mechanism is simplified.
- **Positions and matchups.** Defence is a five-man aggregate; there is no individual
  assignment, no help rotation, no post-up game. `postUp` is unused.
- **Offensive fouls.** A charge is not also a personal foul. A charged turnover always goes to
  the possession user; the only turnover nobody is charged with is the team turnover above,
  which is drawn at a fixed rate rather than from a shot clock the engine does not keep.
- **Height and weight.** `heightIn` and `weightLb` are carried through and ignored; the
  rebounding and rim-protection ratings already encode size.
- **Three-point distance.** One three-point zone; no corner threes.
