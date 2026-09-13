// Minimal parser for basketball-reference stats tables.
// bref tables are regular: <table id=...>, header <th data-stat=...>, rows of
// <th|td data-stat=... class=... csk=... data-append-csv=...>text</th|td>.
// Shared by cap.ts, contracts-current.ts and wayback.ts. No DOM library.

export interface BrefCell {
  stat: string
  text: string
  cls: string
  /** Sort key attribute; numeric for salary cells. */
  csk: string | null
  /** bref player slug, e.g. jokicni01. */
  appendCsv: string | null
  href: string | null
}

export interface BrefTable {
  /** data-stat → column label, from the header rows. */
  headers: Record<string, string>
  rows: BrefCell[][]
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).trim()
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag)
  if (!m) return null
  return m[1] ?? m[2] ?? ''
}

/** Extract the <table> element with the given id, or null. */
export function findTable(html: string, id: string): string | null {
  const re = new RegExp(`<table[^>]*\\sid=["']${id}["'][^>]*>`)
  const m = re.exec(html)
  if (!m) return null
  const start = m.index
  const end = html.indexOf('</table>', start)
  if (end < 0) return null
  return html.slice(start, end + 8)
}

const CELL_RE = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g
const ROW_RE = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/g

function parseRow(inner: string): BrefCell[] {
  const cells: BrefCell[] = []
  for (const m of inner.matchAll(CELL_RE)) {
    const tag = m[2] as string
    const body = m[3] as string
    cells.push({
      stat: attr(tag, 'data-stat') ?? '',
      text: stripTags(body),
      cls: attr(tag, 'class') ?? '',
      csk: attr(tag, 'csk'),
      appendCsv: attr(tag, 'data-append-csv'),
      href: attr(body, 'href'),
    })
  }
  return cells
}

/** Parse a bref table by id. Header rows (all <th>) feed `headers`; rows with a <td> are data. */
export function parseBrefTable(html: string, id: string): BrefTable {
  const table = findTable(html, id)
  if (!table) throw new Error(`table #${id} not found`)
  const headers: Record<string, string> = {}
  const rows: BrefCell[][] = []
  for (const m of table.matchAll(ROW_RE)) {
    const inner = m[2] as string
    const cells = parseRow(inner)
    if (cells.length === 0) continue
    const allTh = !/<td\b/.test(inner)
    if (allTh) {
      for (const c of cells) if (c.stat) headers[c.stat] = c.text
      continue
    }
    rows.push(cells)
  }
  return { headers, rows }
}

export function cell(row: BrefCell[], stat: string): BrefCell | undefined {
  return row.find((c) => c.stat === stat)
}

/** '$62,587,158' → 62587158. Empty → null. */
export function parseDollars(s: string | null | undefined): number | null {
  if (!s) return null
  const digits = s.replace(/[^0-9.-]/g, '')
  if (digits === '' || digits === '-') return null
  return Number(digits)
}

/** '1984-85' → 1985. '1999-00' → 2000. */
export function seasonEndFromLabel(label: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label.trim())
  if (!m) return null
  const start = Number(m[1])
  return start + 1
}

/** Player slug from data-append-csv or a /players/x/slug.html link. */
export function playerSlug(c: BrefCell | undefined): string | null {
  if (!c) return null
  if (c.appendCsv) return c.appendCsv
  const m = c.href ? /\/players\/[a-z]\/([a-z0-9]+)\.html/.exec(c.href) : null
  return m ? (m[1] as string) : null
}
