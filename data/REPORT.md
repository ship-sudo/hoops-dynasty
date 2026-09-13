# Data pipeline report

Generated 2026-09-13T04:11:31.965Z from data/db.sqlite. Source: stats.nba.com cache (Lane A).
b-ref-derived tables (salaries, contracts, awards, shooting, id_map) and era rules fill in when Lanes B and C merge.

## Row counts per season

| season | games/team | team_seasons | player_seasons | games | player_games | playoff_series | rosters | coaches | salaries | contracts | awards | injuries |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1997-98 | 82 | 29 | 685 | 1260 | 25425 | 15 | 351 | 19 | 404 | 404 | 64 | 0 |
| 1998-99 | 50 | 29 | 663 | 791 | 16262 | 15 | 347 | 19 | 391 | 391 | 41 | 0 |
| 1999-00 | 82 | 29 | 651 | 1264 | 25773 | 15 | 344 | 203 | 431 | 431 | 65 | 0 |
| 2000-01 | 82 | 29 | 682 | 1260 | 25367 | 15 | 352 | 158 | 424 | 424 | 68 | 0 |
| 2001-02 | 82 | 29 | 656 | 1260 | 25278 | 15 | 367 | 161 | 423 | 423 | 67 | 0 |
| 2002-03 | 82 | 29 | 643 | 1277 | 25706 | 15 | 467 | 172 | 415 | 415 | 65 | 0 |
| 2003-04 | 82 | 29 | 706 | 1271 | 25548 | 15 | 416 | 166 | 418 | 418 | 64 | 0 |
| 2004-05 | 82 | 30 | 716 | 1314 | 26602 | 15 | 378 | 193 | 440 | 440 | 65 | 0 |
| 2005-06 | 82 | 30 | 707 | 1319 | 26637 | 15 | 413 | 190 | 445 | 445 | 66 | 0 |
| 2006-07 | 82 | 30 | 678 | 1309 | 26648 | 15 | 436 | 31 | 453 | 453 | 72 | 0 |
| 2007-08 | 82 | 30 | 733 | 1316 | 26651 | 15 | 430 | 203 | 443 | 443 | 66 | 0 |
| 2008-09 | 82 | 30 | 715 | 1315 | 26370 | 15 | 435 | 196 | 440 | 440 | 67 | 0 |
| 2009-10 | 82 | 30 | 713 | 1312 | 26487 | 15 | 431 | 198 | 433 | 433 | 68 | 0 |
| 2010-11 | 82 | 30 | 737 | 1311 | 26769 | 15 | 437 | 208 | 445 | 445 | 65 | 0 |
| 2011-12 | 66 | 30 | 719 | 1074 | 22502 | 15 | 442 | 205 | 445 | 445 | 67 | 0 |
| 2012-13 | 82 | 30 | 732 | 1315 | 27538 | 15 | 446 | 189 | 449 | 449 | 66 | 0 |
| 2013-14 | 82 | 30 | 753 | 1319 | 27524 | 15 | 448 | 203 | 385 | 385 | 65 | 0 |
| 2014-15 | 82 | 30 | 784 | 1311 | 27634 | 15 | 450 | 211 | 484 | 484 | 68 | 0 |
| 2015-16 | 82 | 30 | 743 | 1316 | 27978 | 15 | 451 | 169 | 475 | 475 | 66 | 0 |
| 2016-17 | 82 | 30 | 757 | 1309 | 27876 | 15 | 451 | 186 | 482 | 482 | 65 | 0 |
| 2017-18 | 82 | 30 | 815 | 1312 | 27836 | 15 | 502 | 174 | 480 | 480 | 68 | 0 |
| 2018-19 | 82 | 30 | 834 | 1312 | 27862 | 15 | 497 | 181 | 478 | 478 | 67 | 0 |
| 2019-20 | 72 | 30 | 808 | 1143 | 24087 | 15 | 510 | 227 | 475 | 475 | 65 | 0 |
| 2020-21 | 72 | 30 | 865 | 1171 | 24918 | 15 | 503 | 235 | 471 | 471 | 67 | 0 |
| 2021-22 | 82 | 30 | 934 | 1323 | 27931 | 15 | 506 | 260 | 459 | 459 | 67 | 0 |
| 2022-23 | 82 | 30 | 826 | 1320 | 27622 | 15 | 508 | 257 | 456 | 456 | 68 | 0 |
| 2023-24 | 82 | 30 | 871 | 1318 | 28086 | 15 | 532 | 238 | 439 | 439 | 67 | 0 |
| 2024-25 | 82 | 30 | 875 | 1320 | 28110 | 15 | 534 | 263 | 424 | 424 | 67 | 0 |
| 2025-26 | 82 | 30 | 891 | 1321 | 28572 | 15 | 530 | 283 | 476 | 476 | 28 | 0 |
| 2026-27 | 0 | 30 | 587 | 0 | 0 | 0 | 587 | 293 | 470 | 470 | 0 | 0 |

## Once-only tables

| table | rows |
| --- | --- |
| players | 5406 |
| draft_picks | 7738 |
| id_map | 2786 |

## Champions (derived from playoff game logs)

| season | champion | runner-up | finals |
| --- | --- | --- | --- |
| 1997-98 | CHI | UTA | 4-2 |
| 1998-99 | SAS | NYK | 4-1 |
| 1999-00 | LAL | IND | 4-2 |
| 2000-01 | LAL | PHI | 4-1 |
| 2001-02 | LAL | NJN | 4-0 |
| 2002-03 | SAS | NJN | 4-2 |
| 2003-04 | DET | LAL | 4-1 |
| 2004-05 | SAS | DET | 4-3 |
| 2005-06 | MIA | DAL | 4-2 |
| 2006-07 | SAS | CLE | 4-0 |
| 2007-08 | BOS | LAL | 4-2 |
| 2008-09 | LAL | ORL | 4-1 |
| 2009-10 | LAL | BOS | 4-3 |
| 2010-11 | DAL | MIA | 4-2 |
| 2011-12 | MIA | OKC | 4-1 |
| 2012-13 | MIA | SAS | 4-3 |
| 2013-14 | SAS | MIA | 4-1 |
| 2014-15 | GSW | CLE | 4-2 |
| 2015-16 | CLE | GSW | 4-3 |
| 2016-17 | GSW | CLE | 4-1 |
| 2017-18 | GSW | CLE | 4-0 |
| 2018-19 | TOR | GSW | 4-2 |
| 2019-20 | LAL | MIA | 4-2 |
| 2020-21 | MIL | PHX | 4-2 |
| 2021-22 | GSW | BOS | 4-2 |
| 2022-23 | DEN | MIA | 4-1 |
| 2023-24 | BOS | DAL | 4-1 |
| 2024-25 | OKC | IND | 4-3 |
| 2025-26 | NYK | SAS | 4-1 |

## Gaps

| seasons | table | reason |
| --- | --- | --- |
| all | contracts | 1997-98 to 2019-20 contracts are inferred from forward salary history (years while the next salary stays within ±20%, max 5); source 'inferred'. Options unknown. |
| all | contracts | kind from the era table: minimum at or under the 10-year minimum, two_way under 75% of the 0-year minimum (2017-18+), rookie_scale within 4 seasons of a first-round pick and under 1.25 × the #1-pick scale; years of service are not used, so a 0-year player paid between the two minimums reads as standard |
| all | contracts | every contract year is marked guaranteed; partial guarantees are not in any free source |
| all | draft_picks | future traded picks unknown; every team owns its own picks |
| all | games | play-in team logs are empty before 2019-20 because the play-in did not exist (not a gap) |
| all | injuries | no free bulk source proven |
| all | player_seasons | per100_json, advanced_json, shooting_json and pbp_json are season-level lines copied onto every stint |
| all | player_seasons | 587 NBA player-seasons have no bref row (unmatched id or missing from the dataset): gs, shooting_json, pbp_json stay null |
| all | players | from_year/to_year come from commonallplayers (career span, not just 1998+) |
| all | players | 265 players with games but no birth date (never on a season-end roster); bundle age falls back to the leaguedash bio age |
| all | salaries | 913 salary rows dropped: no NBA id (bref CSV has names only; see open/COVERAGE.md) |
| all | salaries | 490 duplicate player-season salary rows collapsed to the larger amount |
| all | salaries | 2020-21 onward lists standard contracts only (two-way, Exhibit 10, 10-day absent) |
| 1997-98, 1998-99 | coaches | 17 teams without a head coach row |
| 1997-98 to 2008-09 | rosters | how_acquired null for every row (stats.nba.com) |
| 2000-01, 2001-02 | coaches | 12 teams without a head coach row |
| 2002-03, 2012-13 | bundle | 2 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2002-03 | coaches | 6 teams without a head coach row |
| 2002-03 | rosters | 18 roster rows for players who played that season but never for that team |
| 2003-04, 2012-13, 2017-18 | rosters | 2 roster rows for players who played that season but never for that team |
| 2005-06, 2020-21, 2022-23 | rosters | 5 roster rows for players who played that season but never for that team |
| 2006-07, 2014-15 | rosters | 1 roster rows for players who played that season but never for that team |
| 2008-09, 2018-19, 2025-26 | rosters | 4 roster rows for players who played that season but never for that team |
| 2009-10, 2010-11, 2011-12, 2015-16 | rosters | 3 roster rows for players who played that season but never for that team |
| 2012-13, 2014-15, 2015-16, 2023-24 | coaches | 2 teams without a head coach row |
| 2013-14 | rosters | 9 roster rows for players who played that season but never for that team |
| 2014-15 | bundle | 1 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2016-17, 2019-20, 2022-23 | bundle | 3 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2017-18 | bundle | 9 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2018-19 | bundle | 4 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2018-19, 2021-22, 2024-25 | coaches | 1 teams without a head coach row |
| 2019-20 | games | bubble: home/away after 2020-07-30 is nominal (neutral site); games per team 64-75 |
| 2019-20 to 2025-26 | player_games | play-in games: team logs only, no player logs cached |
| 2019-20 | rosters | 11 roster rows for players who played that season but never for that team |
| 2019-20 | seasons | games per team: schedule 72 (kept) vs era table 82 |
| 2020-21 | bundle | 8 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2021-22 | bundle | 36 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2021-22, 2024-25 | rosters | 6 roster rows for players who played that season but never for that team |
| 2023-24 | bundle | 17 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2024-25 | bundle | 13 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2024-25, 2025-26 | games | 5 neutral-site games (both logs '@'): lower team id set as nominal home |
| 2025-26, 2026-27 | awards | no MVP/ROY/DPOY/All-NBA rows: the source dataset stops before this season |
| 2025-26 | bundle | 22 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2025-26 | coaches | 3 teams without a head coach row |
| 2026-27 | bundle | 20 first-stint players beyond the 20-man opening-night cap dropped from the bundle |
| 2026-27 | contracts | 5 current-page rows dropped: no NBA id (bref map or roster name) |
| 2026-27 | contracts | preseason 2027: salaries from the current contracts page (y1=2026-27) |
| 2026-27 | player_seasons | preseason: no game logs; 587 empty stints from the current roster |
| 2026-27 | team_seasons | preseason: no standings; 30 clubs copied from 2026 (0-0, last year's box as the era prior) |

## Spot checks

10 random regular-season player-seasons (seeded rng, seed 1, gp ≥ 10). leaguedash totals against the sum of that player's leaguegamelog rows and against the basketball-reference Player Totals row (via id_map). Game logs match 10/10; bref totals match 10/10. Minutes are integers per game in the logs and in bref, so they may differ by rounding; counting stats must be equal.

| season | player | source | gp | min | pts | fga | fgm | fg3m | fta | ftm | oreb | dreb | ast | tov | match |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1999-00 | Othella Harrington | leaguedash totals | 82 | 2675.2 | 1076 | 830 | 420 | 0 | 298 | 236 | 196 | 367 | 97 | 217 |  |
|  |  | sum of game logs | 82 | 2678 | 1076 | 830 | 420 | 0 | 298 | 236 | 196 | 367 | 97 | 217 | yes |
|  |  | bref totals | 82 | 2677 | 1076 | 830 | 420 | 0 | 298 | 236 | 196 | 367 | 97 | 217 | yes |
| 2012-13 | Dion Waiters | leaguedash totals | 61 | 1756.3 | 894 | 815 | 336 | 63 | 213 | 159 | 22 | 127 | 183 | 121 |  |
|  |  | sum of game logs | 61 | 1757 | 894 | 815 | 336 | 63 | 213 | 159 | 22 | 127 | 183 | 121 | yes |
|  |  | bref totals | 61 | 1756 | 894 | 815 | 336 | 63 | 213 | 159 | 22 | 127 | 183 | 121 | yes |
| 2023-24 | Keita Bates-Diop | leaguedash totals | 53 | 664.6 | 197 | 166 | 72 | 21 | 42 | 32 | 31 | 79 | 38 | 15 |  |
|  |  | sum of game logs | 53 | 670 | 197 | 166 | 72 | 21 | 42 | 32 | 31 | 79 | 38 | 15 | yes |
|  |  | bref totals | 53 | 665 | 197 | 166 | 72 | 21 | 42 | 32 | 31 | 79 | 38 | 15 | yes |
| 2012-13 | Chuck Hayes | leaguedash totals | 74 | 1208.9 | 198 | 190 | 84 | 0 | 48 | 30 | 113 | 186 | 112 | 44 |  |
|  |  | sum of game logs | 74 | 1211 | 198 | 190 | 84 | 0 | 48 | 30 | 113 | 186 | 112 | 44 | yes |
|  |  | bref totals | 74 | 1209 | 198 | 190 | 84 | 0 | 48 | 30 | 113 | 186 | 112 | 44 | yes |
| 2010-11 | DaJuan Summers | leaguedash totals | 22 | 198.8 | 74 | 69 | 28 | 9 | 20 | 9 | 2 | 10 | 2 | 13 |  |
|  |  | sum of game logs | 22 | 198 | 74 | 69 | 28 | 9 | 20 | 9 | 2 | 10 | 2 | 13 | yes |
|  |  | bref totals | 22 | 199 | 74 | 69 | 28 | 9 | 20 | 9 | 2 | 10 | 2 | 13 | yes |
| 2012-13 | Evan Fournier | leaguedash totals | 38 | 428.3 | 202 | 152 | 75 | 22 | 39 | 30 | 6 | 29 | 44 | 32 |  |
|  |  | sum of game logs | 38 | 428 | 202 | 152 | 75 | 22 | 39 | 30 | 6 | 29 | 44 | 32 | yes |
|  |  | bref totals | 38 | 428 | 202 | 152 | 75 | 22 | 39 | 30 | 6 | 29 | 44 | 32 | yes |
| 2019-20 | Goga Bitadze | leaguedash totals | 54 | 471.3 | 172 | 150 | 70 | 8 | 33 | 24 | 25 | 81 | 23 | 28 |  |
|  |  | sum of game logs | 54 | 472 | 172 | 150 | 70 | 8 | 33 | 24 | 25 | 81 | 23 | 28 | yes |
|  |  | bref totals | 54 | 471 | 172 | 150 | 70 | 8 | 33 | 24 | 25 | 81 | 23 | 28 | yes |
| 2017-18 | Malachi Richardson | leaguedash totals | 26 | 323.3 | 89 | 90 | 30 | 12 | 22 | 17 | 5 | 29 | 13 | 10 |  |
|  |  | sum of game logs | 26 | 323 | 89 | 90 | 30 | 12 | 22 | 17 | 5 | 29 | 13 | 10 | yes |
|  |  | bref totals | 26 | 324 | 89 | 90 | 30 | 12 | 22 | 17 | 5 | 29 | 13 | 10 | yes |
| 2001-02 | Bryce Drew | leaguedash totals | 61 | 771.7 | 210 | 182 | 78 | 31 | 29 | 23 | 14 | 58 | 101 | 33 |  |
|  |  | sum of game logs | 61 | 775 | 210 | 182 | 78 | 31 | 29 | 23 | 14 | 58 | 101 | 33 | yes |
|  |  | bref totals | 61 | 774 | 210 | 182 | 78 | 31 | 29 | 23 | 14 | 58 | 101 | 33 | yes |
| 2020-21 | Immanuel Quickley | leaguedash totals | 64 | 1243.5 | 731 | 580 | 229 | 118 | 174 | 155 | 25 | 112 | 127 | 58 |  |
|  |  | sum of game logs | 64 | 1243 | 731 | 580 | 229 | 118 | 174 | 155 | 25 | 112 | 127 | 58 | yes |
|  |  | bref totals | 64 | 1243 | 731 | 580 | 229 | 118 | 174 | 155 | 25 | 112 | 127 | 58 | yes |

Per-100 lines, stats.nba.com against bref: 9/10 within 7% on every column. The two sites estimate possessions differently, so exact equality is not expected.

| season | player | source | pts | fga | ast | trb | tov | within 7% |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1999-00 | Othella Harrington | stats.nba.com per 100 | 20.9 | 16.1 | 1.9 | 10.9 | 4.2 |  |
|  |  | bref per 100 | 21.2 | 16.4 | 1.9 | 11.1 | 4.3 | yes |
| 2012-13 | Dion Waiters | stats.nba.com per 100 | 26.1 | 23.8 | 5.4 | 4.3 | 3.5 |  |
|  |  | bref per 100 | 26.5 | 24.1 | 5.4 | 4.4 | 3.6 | yes |
| 2023-24 | Keita Bates-Diop | stats.nba.com per 100 | 14.4 | 12.2 | 2.8 | 8.1 | 1.1 |  |
|  |  | bref per 100 | 14.5 | 12.2 | 2.8 | 8.1 | 1.1 | yes |
| 2012-13 | Chuck Hayes | stats.nba.com per 100 | 8.4 | 8 | 4.7 | 12.7 | 1.9 |  |
|  |  | bref per 100 | 8.4 | 8.1 | 4.7 | 12.7 | 1.9 | yes |
| 2010-11 | DaJuan Summers | stats.nba.com per 100 | 19.2 | 17.9 | 0.5 | 3.1 | 3.4 |  |
|  |  | bref per 100 | 20 | 18.7 | 0.5 | 3.2 | 3.5 | yes |
| 2012-13 | Evan Fournier | stats.nba.com per 100 | 22.7 | 17.1 | 5 | 4 | 3.6 |  |
|  |  | bref per 100 | 23.8 | 17.9 | 5.2 | 4.1 | 3.8 | yes |
| 2019-20 | Goga Bitadze | stats.nba.com per 100 | 16.6 | 14.4 | 2.2 | 10.2 | 2.7 |  |
|  |  | bref per 100 | 17.7 | 15.5 | 2.4 | 10.9 | 2.9 | NO |
| 2017-18 | Malachi Richardson | stats.nba.com per 100 | 13.4 | 13.6 | 2 | 5.2 | 1.5 |  |
|  |  | bref per 100 | 13.9 | 14 | 2 | 5.3 | 1.6 | yes |
| 2001-02 | Bryce Drew | stats.nba.com per 100 | 14.1 | 12.3 | 6.8 | 4.8 | 2.2 |  |
|  |  | bref per 100 | 14.5 | 12.6 | 7 | 5 | 2.3 | yes |
| 2020-21 | Immanuel Quickley | stats.nba.com per 100 | 29 | 23 | 5 | 5.4 | 2.3 |  |
|  |  | bref per 100 | 29.4 | 23.3 | 5.1 | 5.5 | 2.3 | yes |

## Opening-night rule

A player's opening-night team is the team of his first stint that season (first game log by date). A player with zero games but on a season-end roster (commonteamroster) joins that roster team with real = null. Teams are capped at 20: most first-stint minutes stay, roster-only players rank last, the rest are dropped.

Known error: stats.nba.com has no opening-night roster, so this is a proxy. Mid-season free-agent signings and 10-day contracts appear from opening night. A player traded before playing a game appears on the receiving team. Players cut in preseason who never played are missing. Bit players beyond the cap of 20 (two-way and 10-day churn, common from 2017-18) are dropped.
