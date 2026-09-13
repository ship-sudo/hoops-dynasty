// Cross-source id matching: stats.nba.com person ids to basketball-reference slugs. Pure.
//
// Order: manual overrides, then (normalised name, season, team), then (name, draft year), then a unique
// name. Anything left is reported as unmatched. b-ref rows arrive with Lane B; this module only needs
// the small shapes below, so the loader can feed it from either side's tables.

export interface SeasonTeam {
  yearEnd: number
  abbr: string
}

export interface NbaRef {
  nbaId: string
  name: string
  draftYear: number | null
  seasons: SeasonTeam[]
}

export interface BrefRef {
  brefId: string
  name: string
  draftYear: number | null
  seasons: SeasonTeam[] // abbr as basketball-reference spells it
}

export type MatchMethod =
  | 'manual'
  | 'name_season_team'
  | 'tokens_season_team'
  | 'surname_season_team'
  | 'name_draft'
  | 'name'

export interface IdMatch {
  nbaId: string
  brefId: string
  name: string
  method: MatchMethod
}

export interface IdMapResult {
  matches: IdMatch[]
  unmatched: BrefRef[]
}

/** Overrides: b-ref slug to NBA person id. Lives in build/id-overrides.json. */
export type IdOverrides = Record<string, string>

/** b-ref abbreviations that differ from stats.nba.com. Everything else is the same string. */
export const BREF_TO_NBA_ABBR: Record<string, string> = {
  CHO: 'CHA',
  BRK: 'BKN',
  PHO: 'PHX',
  WSB: 'WAS',
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])

/** Letters NFD cannot decompose to ASCII (Turkish \u0131, German \u00df, Cyrillic \u0451 in a Latin name). */
const LETTERS: Record<string, string> = {
  \u0131: 'i',
  \u00df: 'ss',
  \u00f8: 'o',
  \u0142: 'l',
  \u0111: 'd',
  \u00e6: 'ae',
  \u0153: 'oe',
  \u00f0: 'd',
  \u00fe: 'th',
  \u0435: 'e',
  \u0451: 'e',
}

/** Lowercase ASCII letters and spaces only; suffixes Jr/Sr/II/III/IV dropped; punctuation removed. */
export function normaliseName(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(
      /[\u0131\u00df\u00f8\u0142\u0111\u00e6\u0153\u00f0\u00fe\u0435\u0451]/g,
      (c) => LETTERS[c] ?? c,
    )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.'\u2019`-]/g, '')
    .replace(/[^a-z\s]/g, ' ')
  const tokens = ascii.split(/\s+/).filter((t) => t.length > 0)
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1] as string)) tokens.pop()
  return tokens.join(' ')
}

/** Tokens sorted, so 'Sun Yue' and 'Yue Sun' agree. */
export function tokenKey(name: string): string {
  return normaliseName(name).split(' ').sort().join(' ')
}

export function surname(name: string): string {
  const t = normaliseName(name).split(' ')
  return t[t.length - 1] ?? ''
}

export function nbaAbbr(brefAbbr: string, map: Record<string, string> = BREF_TO_NBA_ABBR): string {
  return map[brefAbbr] ?? brefAbbr
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

/** The one NBA id all keys point to, or null when they disagree or none hit. */
function unique(ids: (string | undefined)[]): string | null {
  const set = new Set(ids.filter((x): x is string => x !== undefined))
  return set.size === 1 ? ([...set][0] ?? null) : null
}

export function matchIds(
  nba: readonly NbaRef[],
  bref: readonly BrefRef[],
  overrides: IdOverrides = {},
  abbrMap: Record<string, string> = BREF_TO_NBA_ABBR,
): IdMapResult {
  const byNameSeasonTeam = new Map<string, NbaRef[]>()
  const byTokensSeasonTeam = new Map<string, NbaRef[]>()
  const bySurnameSeasonTeam = new Map<string, NbaRef[]>()
  const byNameDraft = new Map<string, NbaRef[]>()
  const byName = new Map<string, NbaRef[]>()
  for (const p of nba) {
    const n = normaliseName(p.name)
    push(byName, n, p)
    if (p.draftYear !== null) push(byNameDraft, `${n}|${p.draftYear}`, p)
    for (const s of p.seasons) {
      push(byNameSeasonTeam, `${n}|${s.yearEnd}|${s.abbr}`, p)
      push(byTokensSeasonTeam, `${tokenKey(p.name)}|${s.yearEnd}|${s.abbr}`, p)
      push(bySurnameSeasonTeam, `${surname(p.name)}|${s.yearEnd}|${s.abbr}`, p)
    }
  }
  const matches: IdMatch[] = []
  const unmatched: BrefRef[] = []
  const taken = new Set<string>()
  const add = (b: BrefRef, nbaId: string, method: MatchMethod) => {
    matches.push({ nbaId, brefId: b.brefId, name: b.name, method })
    taken.add(nbaId)
  }
  /** One NBA id that every season-team key of `b` agrees on (seasons with no hit are ignored). */
  const bySeasonTeam = (index: Map<string, NbaRef[]>, key: string, b: BrefRef): string | null => {
    const hits = b.seasons.map((s) =>
      unique(
        (index.get(`${key}|${s.yearEnd}|${nbaAbbr(s.abbr, abbrMap)}`) ?? []).map((p) => p.nbaId),
      ),
    )
    const id = unique(hits.map((h) => h ?? undefined))
    return id && hits.some((h) => h !== null) ? id : null
  }
  for (const b of bref) {
    const manual = overrides[b.brefId]
    if (manual) {
      add(b, manual, 'manual')
      continue
    }
    const n = normaliseName(b.name)
    const byFull = bySeasonTeam(byNameSeasonTeam, n, b)
    if (byFull) {
      add(b, byFull, 'name_season_team')
      continue
    }
    const byTokens = bySeasonTeam(byTokensSeasonTeam, tokenKey(b.name), b)
    if (byTokens) {
      add(b, byTokens, 'tokens_season_team')
      continue
    }
    const bySurname = bySeasonTeam(bySurnameSeasonTeam, surname(b.name), b)
    if (bySurname && !taken.has(bySurname)) {
      add(b, bySurname, 'surname_season_team')
      continue
    }
    if (b.draftYear !== null) {
      const d = unique((byNameDraft.get(`${n}|${b.draftYear}`) ?? []).map((p) => p.nbaId))
      if (d) {
        add(b, d, 'name_draft')
        continue
      }
    }
    const cands = (byName.get(n) ?? []).filter((p) => !taken.has(p.nbaId))
    if (cands.length === 1) {
      add(b, (cands[0] as NbaRef).nbaId, 'name')
      continue
    }
    unmatched.push(b)
  }
  return { matches, unmatched }
}
