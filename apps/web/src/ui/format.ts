export const pct3 = (v: number | null | undefined): string =>
  v == null ? '—' : v.toFixed(3).replace(/^0/, '')

export const pct1 = (v: number | null | undefined): string =>
  v == null ? '—' : `${(v * 100).toFixed(1)}%`

/** A whole-number percentage, for things nobody reads to a decimal (cap used, shot mix). */
export const pct0 = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v * 100)}%`

export const n1 = (v: number | null | undefined): string => (v == null ? '—' : v.toFixed(1))
export const n0 = (v: number | null | undefined): string =>
  v == null ? '—' : Math.round(v).toString()

/**
 * Money, always in the same shape: `$12.4M` above a million, `$750K` below it, `$0` at nothing.
 * One decimal at most, everywhere in the game.
 */
export function money(v: number | null | undefined): string {
  if (v == null) return '—'
  const neg = v < 0
  const abs = Math.abs(v)
  const body =
    abs >= 1_000_000
      ? `$${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `$${Math.round(abs / 1_000)}K`
        : `$${Math.round(abs)}`
  return neg ? `−${body}` : body
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** ISO date → 'Tue 28 Oct 2003'. Parsed as UTC so it never shifts by a day. */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** A date with no weekday, for places where the day of the week is noise: '17 Feb 1963'. */
export function plainDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Per-game average that reads as '—' before any games are played. */
export const per = (total: number, gp: number): string => (gp > 0 ? (total / gp).toFixed(1) : '—')

export const height = (inches: number): string => `${Math.floor(inches / 12)}'${inches % 12}"`

export const streakText = (s: number): string => (s === 0 ? '—' : s > 0 ? `W${s}` : `L${-s}`)

/** 1 → '1st', 4 → '4th', 22 → '22nd'. For league placings, which are always read as ordinals. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

/**
 * A signed number to one decimal: '+3.1', '−1.4', '0.0'. Rounds before it decides the sign, so a
 * differential of −0.02 reads '0.0' and never the nonsense '−0.0'.
 */
export function signed1(v: number): string {
  const r = Math.round(v * 10) / 10
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `−${Math.abs(r).toFixed(1)}` : '0.0'
}

/** 'YYYY' season year-end → '2015-16'. */
export const seasonLabel = (yearEnd: number): string =>
  `${yearEnd - 1}-${String(yearEnd % 100).padStart(2, '0')}`
