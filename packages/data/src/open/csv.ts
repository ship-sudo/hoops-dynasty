// Small RFC-4180 CSV parser. Handles quotes, embedded commas/newlines, CRLF.

/** Parse CSV text into rows of strings. Empty trailing line is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i] as string
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
        } else {
          quoted = false
          i++
        }
      } else {
        cell += c
        i++
      }
    } else if (c === '"') {
      quoted = true
      i++
    } else if (c === ',') {
      row.push(cell)
      cell = ''
      i++
    } else if (c === '\r') {
      i++
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += c
      i++
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** Parse CSV with a header row into objects keyed by column name. */
export function parseCsvObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text)
  const header = rows[0]
  if (!header) return []
  const out: Record<string, string>[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[]
    const obj: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) obj[header[c] as string] = row[c] ?? ''
    out.push(obj)
  }
  return out
}

/** 'NA' or '' → null, else Number. Throws on junk so bad columns surface early. */
export function num(v: string | undefined): number | null {
  if (v === undefined || v === '' || v === 'NA') return null
  const n = Number(v)
  if (Number.isNaN(n)) throw new Error(`not a number: ${JSON.stringify(v)}`)
  return n
}

/** 'TRUE'/'FALSE' → boolean, 'NA'/'' → null. */
export function bool(v: string | undefined): boolean | null {
  if (v === undefined || v === '' || v === 'NA') return null
  if (v === 'TRUE' || v === 'True' || v === 'true') return true
  if (v === 'FALSE' || v === 'False' || v === 'false') return false
  throw new Error(`not a boolean: ${JSON.stringify(v)}`)
}

/** 'NA' or '' → null, else the string. */
export function str(v: string | undefined): string | null {
  if (v === undefined || v === '' || v === 'NA') return null
  return v
}
