// Era rules: cap, CBA, draft, playoff and on-court rule settings for one season.
// Interface only. Data lives in packages/data/src/era/era.ts.
// Money is whole dollars. Percentages are plain numbers (25 = 25%).

/** One salary-matching tier. Incoming allowed = outgoing * pct / 100 + plus. */
export interface TradeTier {
  /** Upper bound of outgoing salary for this tier. null = no upper bound. */
  up_to: number | null
  pct: number
  plus: number
}

export interface TradeMatching {
  /** Payroll line that splits the two rule sets after the trade. 'none' = one rule for everyone. */
  split_at: 'none' | 'tax_line' | 'apron_1'
  /** Tiers for teams under split_at (or for everyone when split_at is 'none'). */
  under: TradeTier[]
  /** Tiers for teams over split_at. null when split_at is 'none'. */
  over: TradeTier[] | null
  /** Extra limits for teams over the second apron. null before 2023-24. */
  over_apron_2: {
    pct: number
    plus: number
    can_aggregate: boolean
    can_send_cash: boolean
  } | null
}

export interface MaxSalary {
  /** Percent of cap by years of service. null before the 1999 CBA (no individual max). */
  pct: { yrs_0_6: number; yrs_7_9: number; yrs_10_plus: number } | null
  /** Dollar maximums that season. null when not known or no max. */
  dollars: { yrs_0_6: number; yrs_7_9: number; yrs_10_plus: number } | null
}

export type LuxuryTaxScheme = 'none' | 'flat_1_to_1' | 'incremental'

export interface TaxRates {
  /** Width of each bracket above the tax line, dollars. */
  bracket: number
  /** Rate per dollar in bracket 1..n. Beyond the last, add `step` per further bracket. */
  standard: number[]
  /** Repeater rates, same shape. null when no repeater surcharge that season. */
  repeater: number[] | null
  step: number
  /** all_3_prior: taxpayer in all three prior seasons. 3_of_4_prior: three of the prior four. */
  repeater_rule: 'all_3_prior' | '3_of_4_prior' | null
}

export interface DraftRules {
  rounds: number
  lottery_teams: number
  /** Chance of the first pick, percent, worst record first. Sums to 100. */
  lottery_odds: number[]
  /** Picks decided by the lottery drawing. */
  picks_drawn: number
  /** Minimum age in the calendar year of the draft. null = none. */
  min_age: number | null
  /** US players must be one season removed from high school. */
  one_year_removed_from_hs: boolean
}

export interface PlayoffRules {
  teams: number
  first_round_games: 5 | 7
  /**
   * division_winners_top_2: two divisions per conference, winners seeded 1–2 (through 2003-04).
   * division_winners_top_3: three divisions, winners seeded 1–3 (2004-05, 2005-06).
   * division_winners_top_4: winners guaranteed a top-4 seed, ordered by record (2006-07 to 2015-16).
   * record: seeds by record only (2016-17 on).
   */
  seeding: 'division_winners_top_2' | 'division_winners_top_3' | 'division_winners_top_4' | 'record'
  /** bubble_8_v_9: 2020 only, played if 9th was within 4 games of 8th (9th had to win twice). */
  play_in: 'none' | 'bubble_8_v_9' | 'seeds_7_to_10'
}

export interface ExpansionDraftRules {
  /** Real draft whose rules apply: 1995 (Toronto/Vancouver) or 2004 (Charlotte). */
  precedent: 1995 | 2004
  protected_per_team: number
  /** Every team must expose at least this many. */
  min_unprotected_per_team: number
  max_picks_per_team: number
  /** Minimum players the expansion team must select. null = not known. */
  min_picks: number | null
}

export interface RuleFlags {
  hand_check_banned: boolean
  zone_defense_legal: boolean
  defensive_three_seconds: boolean
  eight_second_backcourt: boolean
  three_point_line_ft: { arc: number; corner: number }
  shot_clock_offensive_rebound_14: boolean
  coach_challenge: boolean
}

export interface EraRules {
  /** '1997-98' */
  season_id: string
  /** Year the season ends. 1998 = 1997-98. */
  season_end: number
  teams: number
  /** Scheduled regular-season games per team. */
  games: number

  cap: number
  /** null when no tax was levied that season. */
  tax_line: number | null
  /** 2011-12 on. null before. */
  apron_1: number | null
  /** 2023-24 on. null before. */
  apron_2: number | null

  /** Minimum salary, 0 years of service. */
  min_salary_0yr: number
  /** Minimum salary, 10+ years of service. */
  min_salary_10yr: number
  max_salary: MaxSalary
  /** 100% scale first-year salary for the #1 pick of the draft held at the end of this season. Teams pay 80–120%. */
  rookie_scale_pick1: number | null

  mle_non_taxpayer: number | null
  mle_taxpayer: number | null
  mle_room: number | null
  /** Bi-annual exception. '$1 million exception' before 2005-06. */
  bae: number | null

  trade_matching: TradeMatching
  bird_years: number
  early_bird_years: number

  /** Players under standard contract. Before 2005-06: 12 active plus up to 3 on the injured list. */
  roster_max: number
  roster_min: number
  /** Players who may dress for a game. */
  roster_active: number
  /** Extra two-way slots on top of roster_max. */
  two_way_slots: number

  luxury_tax_scheme: LuxuryTaxScheme
  /** null unless luxury_tax_scheme is 'incremental'. */
  tax_rates: TaxRates | null

  draft: DraftRules
  playoffs: PlayoffRules
  expansion_draft: ExpansionDraftRules
  rules: RuleFlags

  notes: string
  /** Top-level field names whose value could not be confirmed from a source. See SOURCES.md. */
  unverified: string[]
}
