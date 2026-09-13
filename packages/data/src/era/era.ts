// Era table 1997-98 → 2025-26. Hand-curated. Every number is cited in SOURCES.md.
// Money is whole dollars. Keyed by the year the season ends.

import type {
  DraftRules,
  EraRules,
  ExpansionDraftRules,
  MaxSalary,
  PlayoffRules,
  RuleFlags,
  TaxRates,
  TradeMatching,
} from '@hoops/core'

const FIRST = 1998
const LAST = 2026

// ---------- money by season ----------

interface Money {
  cap: number
  tax: number | null
  apron1: number | null
  apron2: number | null
  min0: number
  min10: number
  /** [0–6 yrs, 7–9 yrs, 10+ yrs] */
  max: [number, number, number] | null
  /** #1 pick scale for the draft held at the end of this season. */
  pick1: number
  mle: number | null
  mleTax: number | null
  mleRoom: number | null
  bae: number | null
}

/** 2011 CBA apron: tax line plus $4M (2011-12 to 2016-17). */
const APRON_2011 = 4_000_000

const MONEY: Record<number, Money> = {
  1998: {
    cap: 26_900_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 242_000,
    min10: 272_500,
    max: null,
    pick1: 2_679_300,
    mle: null,
    mleTax: null,
    mleRoom: null,
    bae: 1_000_000,
  },
  1999: {
    cap: 30_000_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 287_500,
    min10: 1_000_000,
    max: [9_000_000, 11_000_000, 14_000_000],
    pick1: 2_813_300,
    mle: 1_750_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_000_000,
  },
  2000: {
    cap: 34_000_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 301_875,
    min10: 1_000_000,
    max: [9_000_000, 11_000_000, 14_000_000],
    pick1: 2_947_200,
    mle: 2_000_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_100_000,
  },
  2001: {
    cap: 35_500_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 316_969,
    min10: 1_000_000,
    max: [9_658_000, 11_589_000, 14_000_000],
    pick1: 3_081_200,
    mle: 2_250_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_200_000,
  },
  2002: {
    cap: 42_500_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 332_817,
    min10: 1_000_000,
    max: [10_625_000, 12_750_000, 14_875_000],
    pick1: 3_215_200,
    mle: 4_538_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_300_000,
  },
  2003: {
    cap: 40_271_000,
    tax: 52_880_000,
    apron1: null,
    apron2: null,
    min0: 349_458,
    min10: 1_030_000,
    max: [10_067_750, 12_081_300, 14_094_850],
    pick1: 3_349_100,
    mle: 4_546_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_400_000,
  },
  2004: {
    cap: 43_840_000,
    tax: 54_560_000,
    apron1: null,
    apron2: null,
    min0: 366_931,
    min10: 1_070_000,
    max: [10_960_000, 13_152_000, 15_344_000],
    pick1: 3_483_100,
    mle: 4_917_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_500_000,
  },
  2005: {
    cap: 43_870_000,
    tax: null,
    apron1: null,
    apron2: null,
    min0: 385_277,
    min10: 1_100_000,
    max: [10_968_000, 13_161_000, 15_355_000],
    pick1: 3_617_100,
    mle: 4_903_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_600_000,
  },
  2006: {
    cap: 49_500_000,
    tax: 61_700_000,
    apron1: null,
    apron2: null,
    min0: 398_762,
    min10: 1_138_500,
    max: [12_000_000, 14_400_000, 16_800_000],
    pick1: 3_751_000,
    mle: 5_000_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_670_000,
  },
  2007: {
    cap: 53_135_000,
    tax: 65_420_000,
    apron1: null,
    apron2: null,
    min0: 412_718,
    min10: 1_178_348,
    max: [12_455_000, 14_946_000, 17_437_000],
    pick1: 3_885_000,
    mle: 5_215_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_750_000,
  },
  2008: {
    cap: 55_630_000,
    tax: 67_865_000,
    apron1: null,
    apron2: null,
    min0: 427_163,
    min10: 1_219_590,
    max: [13_041_250, 15_649_500, 18_257_750],
    pick1: 4_019_000,
    mle: 5_356_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_830_000,
  },
  2009: {
    cap: 58_680_000,
    tax: 71_150_000,
    apron1: null,
    apron2: null,
    min0: 442_114,
    min10: 1_262_275,
    max: [13_758_000, 16_509_600, 19_261_200],
    pick1: 4_152_900,
    mle: 5_585_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_910_000,
  },
  2010: {
    cap: 57_700_000,
    tax: 69_920_000,
    apron1: null,
    apron2: null,
    min0: 457_588,
    min10: 1_306_455,
    max: [13_520_500, 16_224_600, 18_928_700],
    pick1: 4_286_900,
    mle: 5_854_000,
    mleTax: null,
    mleRoom: null,
    bae: 1_990_000,
  },
  2011: {
    cap: 58_044_000,
    tax: 70_307_000,
    apron1: null,
    apron2: null,
    min0: 473_604,
    min10: 1_352_181,
    max: [13_603_750, 16_324_500, 19_045_250],
    pick1: 4_286_900,
    mle: 5_765_000,
    mleTax: null,
    mleRoom: null,
    bae: 2_080_000,
  },
  2012: {
    cap: 58_044_000,
    tax: 70_307_000,
    apron1: 70_307_000 + APRON_2011,
    apron2: null,
    min0: 473_604,
    min10: 1_352_181,
    max: [12_922_194, 15_506_632, 18_091_071],
    pick1: 4_286_900,
    mle: 5_000_000,
    mleTax: 3_000_000,
    mleRoom: 2_500_000,
    bae: 1_900_000,
  },
  2013: {
    cap: 58_044_000,
    tax: 70_307_000,
    apron1: 70_307_000 + APRON_2011,
    apron2: null,
    min0: 473_604,
    min10: 1_352_181,
    max: [13_668_750, 16_402_500, 19_136_250],
    pick1: 4_436_900,
    mle: 5_000_000,
    mleTax: 3_090_000,
    mleRoom: 2_575_000,
    bae: 1_957_000,
  },
  2014: {
    cap: 58_679_000,
    tax: 71_748_000,
    apron1: 71_748_000 + APRON_2011,
    apron2: null,
    min0: 490_180,
    min10: 1_399_507,
    max: [13_701_250, 16_441_500, 19_181_750],
    pick1: 4_592_200,
    mle: 5_150_000,
    mleTax: 3_183_000,
    mleRoom: 2_652_000,
    bae: 2_016_000,
  },
  2015: {
    cap: 63_065_000,
    tax: 76_829_000,
    apron1: 76_829_000 + APRON_2011,
    apron2: null,
    min0: 507_336,
    min10: 1_448_490,
    max: [14_746_000, 17_695_200, 20_644_400],
    pick1: 4_753_000,
    mle: 5_305_000,
    mleTax: 3_278_000,
    mleRoom: 2_732_000,
    bae: 2_077_000,
  },
  2016: {
    cap: 70_000_000,
    tax: 84_740_000,
    apron1: 84_740_000 + APRON_2011,
    apron2: null,
    min0: 525_093,
    min10: 1_499_187,
    max: [16_407_500, 19_689_000, 22_970_500],
    pick1: 4_919_300,
    mle: 5_464_000,
    mleTax: 3_376_000,
    mleRoom: 2_814_000,
    bae: 2_139_000,
  },
  2017: {
    cap: 94_143_000,
    tax: 113_287_000,
    apron1: 113_287_000 + APRON_2011,
    apron2: null,
    min0: 543_471,
    min10: 1_551_659,
    max: [22_116_750, 26_540_100, 30_963_450],
    pick1: 5_855_200,
    mle: 5_628_000,
    mleTax: 3_477_000,
    mleRoom: 2_898_000,
    bae: 2_203_000,
  },
  2018: {
    cap: 99_093_000,
    tax: 119_266_000,
    apron1: 125_266_000,
    apron2: null,
    min0: 815_615,
    min10: 2_328_652,
    max: [24_773_250, 29_727_900, 34_682_550],
    pick1: 6_804_300,
    mle: 8_406_000,
    mleTax: 5_192_000,
    mleRoom: 4_328_000,
    bae: 3_290_000,
  },
  2019: {
    cap: 101_869_000,
    tax: 123_733_000,
    apron1: 129_817_000,
    apron2: null,
    min0: 838_464,
    min10: 2_393_887,
    max: [25_467_250, 30_560_700, 35_654_150],
    pick1: 8_131_200,
    mle: 8_641_000,
    mleTax: 5_337_000,
    mleRoom: 4_449_000,
    bae: 3_382_000,
  },
  2020: {
    cap: 109_140_000,
    tax: 132_627_000,
    apron1: 138_928_000,
    apron2: null,
    min0: 898_310,
    min10: 2_564_753,
    max: [27_285_000, 32_742_000, 38_199_000],
    pick1: 8_131_200,
    mle: 9_258_000,
    mleTax: 5_718_000,
    mleRoom: 4_767_000,
    bae: 3_623_000,
  },
  2021: {
    cap: 109_140_000,
    tax: 132_627_000,
    apron1: 138_928_000,
    apron2: null,
    min0: 898_310,
    min10: 2_564_753,
    max: [27_285_000, 32_742_000, 38_199_000],
    pick1: 8_375_100,
    mle: 9_258_000,
    mleTax: 5_718_000,
    mleRoom: 4_767_000,
    bae: 3_623_000,
  },
  2022: {
    cap: 112_414_000,
    tax: 136_606_000,
    apron1: 143_002_000,
    apron2: null,
    min0: 925_258,
    min10: 2_641_691,
    max: [28_103_500, 33_724_200, 39_344_900],
    pick1: 9_212_600,
    mle: 9_536_000,
    mleTax: 5_890_000,
    mleRoom: 4_910_000,
    bae: 3_732_000,
  },
  2023: {
    cap: 123_655_000,
    tax: 150_267_000,
    apron1: 156_983_000,
    apron2: null,
    min0: 1_017_781,
    min10: 2_905_851,
    max: [30_913_750, 37_096_500, 43_279_250],
    pick1: 10_133_900,
    mle: 10_490_000,
    mleTax: 6_479_000,
    mleRoom: 5_401_000,
    bae: 4_105_000,
  },
  2024: {
    cap: 136_021_000,
    tax: 165_294_000,
    apron1: 172_346_000,
    apron2: 182_794_000,
    min0: 1_119_563,
    min10: 3_196_448,
    max: [34_005_250, 40_806_300, 47_607_350],
    pick1: 10_474_200,
    mle: 12_405_000,
    mleTax: 5_000_000,
    mleRoom: 7_723_000,
    bae: 4_516_000,
  },
  2025: {
    cap: 140_588_000,
    tax: 170_814_000,
    apron1: 178_132_000,
    apron2: 188_931_000,
    min0: 1_157_153,
    min10: 3_303_771,
    max: [35_147_000, 42_176_400, 49_205_800],
    pick1: 11_521_600,
    mle: 12_822_000,
    mleTax: 5_168_000,
    mleRoom: 7_983_000,
    bae: 4_668_000,
  },
  2026: {
    cap: 154_647_000,
    tax: 187_895_000,
    apron1: 195_945_000,
    apron2: 207_824_000,
    min0: 1_272_870,
    min10: 3_634_153,
    max: [38_661_750, 46_394_100, 54_126_450],
    pick1: 12_290_000,
    mle: 14_104_000,
    mleTax: 5_685_000,
    mleRoom: 8_781_000,
    bae: 5_134_000,
  },
}

// ---------- per-season facts ----------

interface Facts {
  teams: number
  games: number
  notes: string
  unverified: string[]
}

const EXP_1995 = 'expansion_draft'

const FACTS: Record<number, Facts> = {
  1998: {
    teams: 29,
    games: 82,
    notes:
      'Last season of the 1995 CBA: no individual maximum salary, no mid-level exception, one $1M exception. ' +
      'Single veteran minimum ($272,500) for all service levels. 12 active players plus up to 3 on the injured list. ' +
      "Three-point line restored to 23'9\" (22' corners). Toronto and Vancouver were ineligible for the #1 pick in the 1998 lottery.",
    unverified: ['trade_matching', 'bae', EXP_1995],
  },
  1999: {
    teams: 29,
    games: 50,
    notes:
      'Lockout. 50-game season from Feb 5 1999. 1999 CBA: maximum salaries (25/30/35% of cap), mid-level exception, escrow and luxury tax (tax not levied until 2002-03).',
    unverified: [EXP_1995],
  },
  2000: {
    teams: 29,
    games: 82,
    notes: 'Tax and escrow provisions not yet in effect.',
    unverified: [EXP_1995],
  },
  2001: {
    teams: 29,
    games: 82,
    notes: 'Tax and escrow provisions not yet in effect.',
    unverified: [EXP_1995],
  },
  2002: {
    teams: 29,
    games: 82,
    notes:
      'Escrow began. Tax provisions in effect but not triggered (salaries under the 61.1% of BRI trigger), so no tax line. ' +
      'Zone defence legal, defensive three seconds, eight-second backcourt from this season.',
    unverified: [EXP_1995],
  },
  2003: {
    teams: 29,
    games: 82,
    notes:
      'First season the luxury tax was levied ($1 for $1, threshold set after the season from actual BRI). First round best-of-7 from the 2003 playoffs.',
    unverified: ['tax_line', EXP_1995],
  },
  2004: {
    teams: 29,
    games: 82,
    notes: 'Luxury tax levied ($1 for $1).',
    unverified: ['tax_line', EXP_1995],
  },
  2005: {
    teams: 30,
    games: 82,
    notes:
      'Charlotte Bobcats expansion: 30 teams, three divisions per conference, division winners seeded 1–3, 14-team lottery. ' +
      'Hand-checking curtailed from this season. Tax not triggered (salaries 60.4% of BRI), so no tax line. Last draft open to high-school seniors (2005).',
    unverified: [],
  },
  2006: {
    teams: 30,
    games: 82,
    notes:
      '2005 CBA: tax levied every season; 15-man rosters with an inactive list (min 13); draft age 19 and one year removed from high school from the 2006 draft.',
    unverified: [],
  },
  2007: {
    teams: 30,
    games: 82,
    notes: 'Top four seeds ordered by record (division winners still guaranteed a top-4 seed).',
    unverified: [],
  },
  2008: { teams: 30, games: 82, notes: '', unverified: [] },
  2009: {
    teams: 30,
    games: 82,
    notes: 'Seattle SuperSonics moved to Oklahoma City (Thunder).',
    unverified: [],
  },
  2010: { teams: 30, games: 82, notes: '', unverified: [] },
  2011: { teams: 30, games: 82, notes: 'Last season of the 2005 CBA.', unverified: [] },
  2012: {
    teams: 30,
    games: 66,
    notes:
      'Lockout. 66-game season from Dec 25 2011. 2011 CBA: tiered trade matching, apron at tax + $4M, taxpayer and room MLEs, 13-man minimum with 13 active.',
    unverified: [],
  },
  2013: { teams: 30, games: 82, notes: 'New Jersey Nets moved to Brooklyn.', unverified: [] },
  2014: {
    teams: 30,
    games: 82,
    notes: 'New Orleans Hornets renamed Pelicans. Incremental luxury tax rates begin.',
    unverified: [],
  },
  2015: {
    teams: 30,
    games: 82,
    notes:
      'Charlotte Bobcats renamed Hornets. Repeater tax begins (taxpayer in all three prior seasons).',
    unverified: [],
  },
  2016: {
    teams: 30,
    games: 82,
    notes: 'Repeater rule becomes three of the prior four seasons.',
    unverified: [],
  },
  2017: {
    teams: 30,
    games: 82,
    notes: 'Cap jump (new TV deal). Playoff seeding purely by record from the 2017 playoffs.',
    unverified: [],
  },
  2018: {
    teams: 30,
    games: 82,
    notes:
      '2017 CBA: 175% trade tier, apron at tax + $6M, two-way contracts (2 slots), 14-man minimum (13 for up to two weeks).',
    unverified: [],
  },
  2019: {
    teams: 30,
    games: 82,
    notes:
      'Shot clock resets to 14 after an offensive rebound. 2019 draft lottery reform: 14/14/14% for the worst three, four picks drawn.',
    unverified: [],
  },
  2020: {
    teams: 30,
    games: 82,
    notes:
      'COVID-19: suspended Mar 11 after 63–67 games per team. 22 teams played 8 seeding games in the Orlando bubble (71–75 total); 8 teams stopped at 63–67. ' +
      "Single play-in 8 v 9 if within 4 games (West only: Portland beat Memphis). Coach's challenge introduced.",
    unverified: [],
  },
  2021: {
    teams: 30,
    games: 72,
    notes:
      '72-game season from Dec 22 2020. Play-in tournament for seeds 7–10 (made permanent July 2022). Cap held flat at the 2019-20 figure; minimums unchanged.',
    unverified: ['min_salary_0yr', 'min_salary_10yr'],
  },
  2022: { teams: 30, games: 82, notes: '', unverified: [] },
  2023: { teams: 30, games: 82, notes: 'Last season of the 2017 CBA.', unverified: [] },
  2024: {
    teams: 30,
    games: 82,
    notes:
      '2023 CBA: second apron, 200%/+$7.5M trade tiers under the first apron, 110% for teams over either apron (this season only), three two-way slots, $5M tax brackets.',
    unverified: [],
  },
  2025: {
    teams: 30,
    games: 82,
    notes:
      'Teams over either apron may take back only 100% in trades; second-apron teams cannot aggregate salaries or send cash. Tax brackets now scale with the cap.',
    unverified: [],
  },
  2026: {
    teams: 30,
    games: 82,
    notes:
      'New tax rates: $1.00/$1.25/$3.50/$4.75 standard, $3.00/$3.25/$5.50/$6.75 repeater, +$0.50 per further bracket. Bracket width approx. $5.685M.',
    unverified: ['tax_rates'],
  },
}

// ---------- rule blocks by CBA ----------

function tradeMatching(y: number): TradeMatching {
  if (y <= 2005) {
    // 1995 and 1999 CBAs: 115% + $100k for everyone.
    return {
      split_at: 'none',
      under: [{ up_to: null, pct: 115, plus: 100_000 }],
      over: null,
      over_apron_2: null,
    }
  }
  if (y <= 2011) {
    return {
      split_at: 'none',
      under: [{ up_to: null, pct: 125, plus: 100_000 }],
      over: null,
      over_apron_2: null,
    }
  }
  if (y <= 2017) {
    return {
      split_at: 'tax_line',
      under: [
        { up_to: 9_800_000, pct: 150, plus: 100_000 },
        { up_to: 19_600_000, pct: 100, plus: 5_000_000 },
        { up_to: null, pct: 125, plus: 100_000 },
      ],
      over: [{ up_to: null, pct: 125, plus: 100_000 }],
      over_apron_2: null,
    }
  }
  if (y <= 2023) {
    return {
      split_at: 'tax_line',
      under: [
        { up_to: 6_533_333, pct: 175, plus: 100_000 },
        { up_to: 19_600_000, pct: 100, plus: 5_000_000 },
        { up_to: null, pct: 125, plus: 100_000 },
      ],
      over: [{ up_to: null, pct: 125, plus: 100_000 }],
      over_apron_2: null,
    }
  }
  const under = [
    { up_to: 7_500_000, pct: 200, plus: 250_000 },
    { up_to: 29_000_000, pct: 100, plus: 7_500_000 },
    { up_to: null, pct: 125, plus: 250_000 },
  ]
  if (y === 2024) {
    return {
      split_at: 'apron_1',
      under,
      over: [{ up_to: null, pct: 110, plus: 0 }],
      over_apron_2: { pct: 110, plus: 0, can_aggregate: true, can_send_cash: true },
    }
  }
  return {
    split_at: 'apron_1',
    under,
    over: [{ up_to: null, pct: 100, plus: 0 }],
    over_apron_2: { pct: 100, plus: 0, can_aggregate: false, can_send_cash: false },
  }
}

function maxSalary(m: Money): MaxSalary {
  if (!m.max) return { pct: null, dollars: null }
  return {
    pct: { yrs_0_6: 25, yrs_7_9: 30, yrs_10_plus: 35 },
    dollars: { yrs_0_6: m.max[0], yrs_7_9: m.max[1], yrs_10_plus: m.max[2] },
  }
}

function taxScheme(y: number): EraRules['luxury_tax_scheme'] {
  if (y <= 2002 || y === 2005) return 'none'
  if (y <= 2013) return 'flat_1_to_1'
  return 'incremental'
}

const STANDARD_2013 = [1.5, 1.75, 2.5, 3.25, 3.75]
const REPEATER_2013 = [2.5, 2.75, 3.5, 4.25, 4.75]

function taxRates(y: number): TaxRates | null {
  if (y < 2014) return null
  if (y === 2014)
    return {
      bracket: 5_000_000,
      standard: STANDARD_2013,
      repeater: null,
      step: 0.5,
      repeater_rule: null,
    }
  if (y === 2015) {
    return {
      bracket: 5_000_000,
      standard: STANDARD_2013,
      repeater: REPEATER_2013,
      step: 0.5,
      repeater_rule: 'all_3_prior',
    }
  }
  if (y <= 2024) {
    return {
      bracket: 5_000_000,
      standard: STANDARD_2013,
      repeater: REPEATER_2013,
      step: 0.5,
      repeater_rule: '3_of_4_prior',
    }
  }
  if (y === 2025) {
    return {
      bracket: 5_168_000,
      standard: STANDARD_2013,
      repeater: REPEATER_2013,
      step: 0.5,
      repeater_rule: '3_of_4_prior',
    }
  }
  return {
    bracket: 5_685_000,
    standard: [1.0, 1.25, 3.5, 4.75],
    repeater: [3.0, 3.25, 5.5, 6.75],
    step: 0.5,
    repeater_rule: '3_of_4_prior',
  }
}

/** 1000 combinations: 250, 200, 157, 120, 89, 64, 44, 29, 18, 11, 7, 6, 5. */
const ODDS_13 = [25.0, 20.0, 15.7, 12.0, 8.9, 6.4, 4.4, 2.9, 1.8, 1.1, 0.7, 0.6, 0.5]
/** 1000 combinations: 250, 199, 156, 119, 88, 63, 43, 28, 17, 11, 8, 7, 6, 5. */
const ODDS_14 = [25.0, 19.9, 15.6, 11.9, 8.8, 6.3, 4.3, 2.8, 1.7, 1.1, 0.8, 0.7, 0.6, 0.5]
/** 2019 reform: 140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5. */
const ODDS_2019 = [14, 14, 14, 12.5, 10.5, 9, 7.5, 6, 4.5, 3, 2, 1.5, 1, 0.5]

function draft(y: number): DraftRules {
  const teams = y <= 2004 ? 13 : 14
  const odds = y <= 2004 ? ODDS_13 : y <= 2018 ? ODDS_14 : ODDS_2019
  return {
    rounds: 2,
    lottery_teams: teams,
    lottery_odds: odds,
    picks_drawn: y <= 2018 ? 3 : 4,
    min_age: y <= 2005 ? null : 19,
    one_year_removed_from_hs: y > 2005,
  }
}

function playoffs(y: number): PlayoffRules {
  const seeding: PlayoffRules['seeding'] =
    y <= 2004
      ? 'division_winners_top_2'
      : y <= 2006
        ? 'division_winners_top_3'
        : y <= 2016
          ? 'division_winners_top_4'
          : 'record'
  return {
    teams: 16,
    first_round_games: y <= 2002 ? 5 : 7,
    seeding,
    play_in: y < 2020 ? 'none' : y === 2020 ? 'bubble_8_v_9' : 'seeds_7_to_10',
  }
}

function expansionDraft(y: number): ExpansionDraftRules {
  if (y <= 2004) {
    return {
      precedent: 1995,
      protected_per_team: 8,
      min_unprotected_per_team: 1,
      max_picks_per_team: 1,
      min_picks: null,
    }
  }
  return {
    precedent: 2004,
    protected_per_team: 8,
    min_unprotected_per_team: 1,
    max_picks_per_team: 1,
    min_picks: 14,
  }
}

function rules(y: number): RuleFlags {
  return {
    hand_check_banned: y >= 2005,
    zone_defense_legal: y >= 2002,
    defensive_three_seconds: y >= 2002,
    eight_second_backcourt: y >= 2002,
    three_point_line_ft: { arc: 23.75, corner: 22 },
    shot_clock_offensive_rebound_14: y >= 2019,
    coach_challenge: y >= 2020,
  }
}

function roster(
  y: number,
): Pick<EraRules, 'roster_max' | 'roster_min' | 'roster_active' | 'two_way_slots'> {
  if (y <= 2005) return { roster_max: 15, roster_min: 12, roster_active: 12, two_way_slots: 0 }
  if (y <= 2011) return { roster_max: 15, roster_min: 13, roster_active: 12, two_way_slots: 0 }
  if (y <= 2017) return { roster_max: 15, roster_min: 13, roster_active: 13, two_way_slots: 0 }
  if (y <= 2023) return { roster_max: 15, roster_min: 14, roster_active: 13, two_way_slots: 2 }
  return { roster_max: 15, roster_min: 14, roster_active: 13, two_way_slots: 3 }
}

function seasonId(y: number): string {
  return `${y - 1}-${String(y % 100).padStart(2, '0')}`
}

function build(y: number): EraRules {
  const m = MONEY[y]
  const f = FACTS[y]
  if (!m || !f) throw new Error(`no era data for ${y}`)
  return {
    season_id: seasonId(y),
    season_end: y,
    teams: f.teams,
    games: f.games,
    cap: m.cap,
    tax_line: m.tax,
    apron_1: m.apron1,
    apron_2: m.apron2,
    min_salary_0yr: m.min0,
    min_salary_10yr: m.min10,
    max_salary: maxSalary(m),
    rookie_scale_pick1: m.pick1,
    mle_non_taxpayer: m.mle,
    mle_taxpayer: m.mleTax,
    mle_room: m.mleRoom,
    bae: m.bae,
    trade_matching: tradeMatching(y),
    bird_years: 3,
    early_bird_years: 2,
    ...roster(y),
    luxury_tax_scheme: taxScheme(y),
    tax_rates: taxRates(y),
    draft: draft(y),
    playoffs: playoffs(y),
    expansion_draft: expansionDraft(y),
    rules: rules(y),
    notes: f.notes,
    unverified: f.unverified,
  }
}

export const ERA: Record<number, EraRules> = {}
for (let y = FIRST; y <= LAST; y++) ERA[y] = build(y)

export const ERA_FIRST = FIRST
export const ERA_LAST = LAST
