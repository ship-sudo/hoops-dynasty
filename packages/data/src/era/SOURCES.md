# Era table sources

All pages read 2026-09-11 unless noted. Larry Coon's CBA FAQ (cbafaq.com) is the
primary source for money and CBA rules; the site's cert has expired and the front
page is a retirement note, but the per-CBA archives are still served over `curl -k`.
No request was made to basketball-reference.com; the cap cross-check uses the
cached page `data/raw/bref/salary-cap-history.html` (fetched by another lane).

## Cap

- Cached basketball-reference page `data/raw/bref/salary-cap-history.html` (table `salary_cap_history`), every season 1997-98 → 2025-26. The test parses this table. 2026-27 is not on that page; the cap is from the NBA release below.
- Cross-checks: cbafaq salarycap99/05/11/17 cap tables; pr.nba.com press releases 2012-13 → 2018-19, 2022-23, 2025-26; HoopsRumors 2023-24, 2024-25. All agree.

## Tax line, aprons

- 1999 CBA seasons: http://www.cbafaq.com/salarycap99.htm — tax not triggered 2001-02 and 2004-05; levied 2002-03 ("$52.9 million") and 2003-04 ("$54.6 million"), figures rounded there.
- 2002-03 $52.88M and 2003-04 $54.56M from the NBA table in https://en.wikipedia.org/wiki/Luxury_tax_(sports) (also rounded, to $10k).
- 2005-06 → 2010-11: http://www.cbafaq.com/salarycap05.htm tax table.
- 2011-12 → 2016-17: http://www.cbafaq.com/salarycap11.htm tax table; apron defined as tax + $4M in the same FAQ (apron_1 for these seasons is derived from that rule).
- 2017-18 → 2022-23: http://www.cbafaq.com/salarycap17.htm "Tax Level | Apron" table.
- 2012-13 → 2018-19, 2022-23, 2025-26: https://pr.nba.com/nba-salary-cap-2012-13-season (and the same pattern per season). The 2025-26 release lists tax, first and second apron.
- 2023-24, 2024-25: https://www.hoopsrumors.com/2023/06/salary-cap-tax-line-set-for-2023-24-nba-season.html and https://www.hoopsrumors.com/2024/06/salary-cap-tax-line-set-for-2024-25-nba-season.html.
- 2026-27: https://www.nba.com/news/nba-salary-cap-2026-27-season (cap $164.961M, tax $200.428M, first apron $209.015M, second apron $221.686M, MLEs). Cross-check https://www.hoopsrumors.com/2026/06/salary-cap-tax-line-set-for-2026-27-nba-season.html (same figures, plus maxes, BAE $5,477,000).

## Minimum salaries

- 1997-98: Patricia Bender's salary list https://www.eskimo.com/~pbender/misc/salaries98.txt ("The league minimum is $242,000 for rookies and $272,500 for veterans"). Single veteran tier under the 1995 CBA; used for min_salary_10yr.
- 1998-99 → 2004-05: cbafaq salarycap99.htm minimum table.
- 2005-06 → 2010-11: cbafaq salarycap05.htm.
- 2011-12 → 2016-17: cbafaq salarycap11.htm.
- 2017-18 → 2019-20: http://www.cbafaq.com/minimums.htm, cross-checked with HoopsRumors 2018/19 and 2019/20 posts.
- 2020-21: derived (see Unverified).
- 2021-22 → 2025-26: https://www.hoopsrumors.com/2021/08/nba-minimum-salaries-for-2021-22.html, .../2022/07/...-2022-23.html, .../2023/07/...-2023-24.html, .../2024/06/...-2024-25.html, .../2025/06/...-2025-26.html. 2022-23 also in cbafaq salarycap17.htm.
- 2026-27: https://www.hoopsrumors.com/2026/07/nba-minimum-salaries-for-2026-27.html ($1,357,763 / $3,876,529).

## Maximum salaries

- No individual max before the 1999 CBA: cbafaq salarycap99.htm CBA history table ("1999 … Added maximum salaries"); https://en.wikipedia.org/wiki/1998–99_NBA_lockout.
- 25/30/35% and dollar values: cbafaq salarycap99.htm (1998-99 → 2004-05), salarycap05.htm (2005-06 → 2010-11), salarycap11.htm (2011-12 → 2016-17), salarycap17.htm (2017-18 → 2022-23); HoopsRumors cap posts for 2023-24 and 2024-25; https://www.hoopsrumors.com/2025/06/nba-maximum-salaries-for-2025-26.html; 2026-27 maxes on the HoopsRumors cap post above.
- Note: 2005 and 2011 CBAs computed the max from a lower BRI share, so the dollar figures are below a literal 25/30/35% of cap (cbafaq salarycap11.htm note).

## Rookie scale (#1 pick, 100%)

- 1998 → 2004 drafts: http://www.cbafaq.com/scale99.htm (pick 1 rows). The page's Olowokandi example shows $3,125,160 for 1998-99; that is a digit transposition of 120% × $2,679,300 = $3,215,160 (its later years match the table).
- 2005 → 2010 drafts: cbafaq salarycap05.htm rookie table. 2011 → 2016: salarycap11.htm. 2017 → 2019: http://www.cbafaq.com/scale17.htm.
- 1997 draft and 2019 → 2026 drafts: https://www.salaryswish.com/rookie-scale/<season end year> (1998, 2020–2027). Cross-checked against cbafaq for 1999, 2006, 2012, 2018, 2019: all match.
- 2027 draft #1 (100%): cap-scaled from 2026 ($12,290,000 × 164,961,000 / 154,647,000). Unverified. 2026 first-round 120% figures: https://www.hoopsrumors.com/2026/07/rookie-scale-salaries-for-2026-nba-first-round-picks.html.

## Exceptions (MLE, taxpayer MLE, room MLE, BAE)

- 1998-99 → 2004-05: cbafaq salarycap99.htm (mid-level $1.75M/$2.0M/$2.25M then average salary; "$1 million exception" $1.0M rising $100k a year).
- 1997-98: the $1M exception "carries over from the previous CBA" (Wayback 2000 copy of the 1999 FAQ); no MLE existed.
- 2005-06 → 2010-11: cbafaq salarycap05.htm MLE and bi-annual tables.
- 2011-12 → 2016-17: cbafaq salarycap11.htm (non-taxpayer, taxpayer, room, bi-annual tables); pr.nba.com releases 2012-13 → 2016-17 agree.
- 2017-18 → 2022-23: cbafaq salarycap17.htm tables; pr.nba.com 2017-18, 2018-19, 2022-23 agree.
- 2023-24, 2024-25: HoopsRumors cap posts above. 2025-26: pr.nba.com release (MLEs) and https://www.hoopsrumors.com/2025/06/salary-cap-tax-line-set-for-2025-26-nba-season.html (bi-annual $5,134,000).

## Trade matching

- 1999 CBA: 115% + $100,000 (cbafaq salarycap99.htm, assigned player exception).
- 2005 CBA: 125% + $100,000 (cbafaq salarycap05.htm).
- 2011 CBA: 150% + $100k to $9.8M, +$5M to $19.6M, 125% + $100k above; taxpayers 125% + $100k, judged post-trade (cbafaq salarycap11.htm Q84).
- 2017 CBA: 175% + $100k to $6,533,333, +$5M to $19.6M, 125% + $100k above (cbafaq salarycap17.htm).
- 2023 CBA: https://www.hoopsrumors.com/2023/09/salary-matching-rules-for-trades-during-2023-24-season.html and https://www.hoopsrumors.com/2023/04/running-list-of-changes-in-nbas-new-collective-bargaining-agreement.html (200% + $250k to $7.5M, +$7.5M to $29M, 125% + $250k above; 110% over either apron in 2023-24, 100% from 2024-25; second apron: no aggregation, no cash from 2024-25).

## Bird rights, roster, two-way

- Bird 3 seasons, Early Bird 2: exception tables in cbafaq salarycap99/05/11/17.
- 1999 CBA roster: 12 players, up to 3 on injured reserve (5-game minimum), two weeks to get back to 12 (cbafaq salarycap99.htm Q62–64).
- 2005 CBA: 12 active (11 for two weeks), inactive list 1–3, so 13–15 (cbafaq salarycap05.htm Q67).
- 2011 CBA: max 15, 12 or 13 active, 13 total allowed without a time limit (cbafaq salarycap11.htm Q79 table).
- 2017 CBA: max 15 plus two two-way slots; 13 total only with a two-week limit, so minimum 14 (cbafaq salarycap17.htm Q79 table).
- Two-way: 2 slots from 2017-18, 3 from 2023-24 (https://en.wikipedia.org/wiki/Two-way_contract; HoopsRumors running list of 2023 CBA changes).

## Luxury tax scheme and rates

- Not levied before 2002-03; levied 2002-03 and 2003-04; not triggered 2004-05 (cbafaq salarycap99.htm); every season from 2005-06 (salarycap05.htm).
- $1 for $1 through 2012-13 and incremental from 2013-14: https://pr.nba.com/nba-salary-cap-2013-14-season; bracket table in cbafaq salarycap11.htm and salarycap17.htm.
- Repeater: 2014-15 all three prior seasons, 2015-16 onward three of four (https://en.wikipedia.org/wiki/Luxury_tax_(sports)).
- 2023 CBA: brackets $5M in 2023-24, scaling with the cap after ($5,168,000 in 2024-25); new rates from 2025-26: https://www.hoopsrumors.com/2024/11/hoops-rumors-glossary-luxury-tax-penalties-4.html and https://cbaguide.com/thresholds/luxurytax/.

## Draft lottery and eligibility

- Odds and picks drawn: https://en.wikipedia.org/wiki/NBA_draft_lottery (2019 system table; history of 1994 odds and the 2019 change; winners table with combinations per year).
- 13-team table 1996–2004: https://en.wikipedia.org/wiki/2003_NBA_draft lottery table (250/200 tied at 225, 157, 120, 89, 64, 44, 29, 18/11 tied at 15/14, 7, 6, 5).
- 14-team table 2005–2018: https://en.wikipedia.org/wiki/2018_NBA_draft lottery table.
- 1998: Raptors and Grizzlies ineligible for the #1 pick (Wikipedia NBA draft lottery article).
- Age rule from the 2006 draft: https://en.wikipedia.org/wiki/Eligibility_for_the_NBA_draft.

## Playoffs and play-in

- Format history, first round best-of-7 from 2003, seeding rules 2004-05/2005-06 (top 3) and 2006-07 (top 4 by record), 2016-17 by record: https://en.wikipedia.org/wiki/NBA_playoffs. Note the brief's "top 3 for 1998–2004" is corrected to top 2: two divisions per conference, winners seeded 1–2, best other team 3rd.
- Play-in: https://en.wikipedia.org/wiki/NBA_play-in_tournament (2020 8-v-9 within four games; 7–10 from 2020-21; permanent July 2022).
- 2019-20 stoppage and bubble: https://en.wikipedia.org/wiki/2019–20_NBA_season (63–67 games before suspension, 8 seeding games for 22 teams).
- Season lengths: https://en.wikipedia.org/wiki/1998–99_NBA_lockout (50), https://en.wikipedia.org/wiki/2011_NBA_lockout (66), https://en.wikipedia.org/wiki/2020–21_NBA_season (72).

## Expansion draft

- 1995: each of 27 teams protected 8; Toronto took 14 and Vancouver 13, one from each team (https://en.wikipedia.org/wiki/1995_NBA_expansion_draft; ESPN https://www.espn.com/nba/story/_/id/41300098/what-nba-expansion-draft-look-future).
- 2004: protect 8, at least one exposed, minimum 14 picks, one per team, 19 taken (ESPN article above; https://en.wikipedia.org/wiki/2004_NBA_expansion_draft; FanSided guide https://fansided.com/nba/how-would-an-nba-expansion-draft-work-if-the-league-adds-teams-in-las-vegas-and-seattle).

## Rule flags

- Official NBA rules history (Wayback copy of nba.com/analysis/rules_history.html, 2016 snapshot): 1997-98 three-point line restored; 2001-02 illegal defence eliminated, defensive three seconds, ten → eight seconds; 2004-05 hand-checking curtailed.
- 2001-02 also in https://en.wikipedia.org/wiki/2001–02_NBA_season.
- Three-point distances: https://en.wikipedia.org/wiki/Three-point_field_goal.
- 14-second reset 2018-19: https://en.wikipedia.org/wiki/2018–19_NBA_season (citing the NBA.com release) and https://en.wikipedia.org/wiki/Shot_clock.
- Coach's challenge 2019-20: https://pr.nba.com/nba-board-of-governors-approves-coachs-challenge-and-use-of-nba-replay-center-to-initiate-instant-replay/.

## Relocations and renames

- https://en.wikipedia.org/wiki/2004–05_NBA_season (Bobcats), 2008–09 (Seattle → Oklahoma City), 2012–13 (Brooklyn), 2013–14 (Pelicans), 2014–15 (Hornets).

## Where sources disagreed

- 2019-20 #1 pick scale: cbafaq scale17.htm says $8,133,200; salaryswish says $8,131,200 (120% = Zion Williamson's $9,757,440). Used $8,131,200.
- cbafaq scale99.htm's worked example ($3,125,160) conflicts with its own table; table used (see above).
- 2004 expansion draft picks per team: ESPN, Wikipedia and FanSided say one per team; grokipedia says two. Used one.
- 2017 CBA minimum roster: cbafaq's roster-charge note says "at least 13"; its Q79 table gives 13 a two-week limit and HoopsRumors says 14. Used 14.
- 2002-03 / 2003-04 tax lines: cbafaq rounds to $52.9M / $54.6M; Wikipedia to $52.88M / $54.56M. Used Wikipedia's.

## Unverified

Field names listed in each season's `unverified`, with the value used.

- 1998 `trade_matching`: 115% + $100,000 assumed to match the 1999 CBA; the 1995 CBA text was not readable (scanned PDF).
- 1998 `bae`: $1,000,000. The 1999 FAQ says the $1M exception carried over from the previous CBA; the 1997-98 amount is not stated.
- 1998–2004 `expansion_draft`: `min_picks` null. No source read states a minimum for the 1995 draft.
- 2003 `tax_line`: 52,880,000 and 2004 `tax_line`: 54,560,000 — rounded figures only.
- 2021 `min_salary_0yr` 898,310 and `min_salary_10yr` 2,564,753: the 2017 CBA scales minimums by the cap change and the cap was held flat, so 2019-20 values are reused; no page read lists 2020-21 directly.
- 2026 `tax_rates`: bracket width 5,685,000 is the cap-scaled $5M bracket rounded to $1k (HoopsRumors quotes "approximately $5,685,000"); rates confirmed.
- 2027 `tax_rates` bracket 6,064,000: same $5M bracket scaled by the 2026-27 cap vs 2023-24. Rates carried from 2025-26.
- 2027 `rookie_scale_pick1`: see Rookie scale above.
