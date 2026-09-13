// ISO date strings (YYYY-MM-DD) are the calendar. No Date objects live in the save.

const DAY_MS = 86_400_000

export function toDay(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS)
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(iso: string, n: number): string {
  return fromDay(toDay(iso) + n)
}

export function daysBetween(a: string, b: string): number {
  return toDay(b) - toDay(a)
}

export function addYears(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4)) + n
  return `${String(y).padStart(4, '0')}${iso.slice(4)}`
}
