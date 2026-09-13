/**
 * The save's own colour, and light or dark.
 *
 * Every accent in the interface is the user's club colour. Raw franchise colours cannot be used
 * as-is: Denver's navy is invisible on a dark ground and San Antonio's silver is invisible on a
 * light one. `legible` keeps the hue — that is the part a fan recognises — and moves lightness
 * and saturation into a band that reads against the theme's ground, so the tint is always the
 * club's and always visible.
 */

import { teamColors } from './teamColors.ts'

export type Theme = 'light' | 'dark'
export type ThemeChoice = Theme | 'system'

const KEY = 'hoops.theme'

/* ------------------------------------------------------------------ colour */

function toHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16) / 255
  const g = Number.parseInt(h.slice(2, 4), 16) / 255
  const b = Number.parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const hue =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6
  return [hue * 360, s, l]
}

function toHex(hDeg: number, s: number, l: number): string {
  const h = (((hDeg % 360) + 360) % 360) / 360
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t0: number) => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const ch = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return s === 0
    ? `#${ch(l)}${ch(l)}${ch(l)}`
    : `#${ch(f(h + 1 / 3))}${ch(f(h))}${ch(f(h - 1 / 3))}`
}

/**
 * The club's hue, pushed into the band that reads on this theme. A near-grey (Brooklyn, San
 * Antonio) keeps its neutrality rather than being given a hue it never had.
 */
export function legible(hex: string, theme: Theme): string {
  const [h, s0, l0] = toHsl(hex)
  // Silver and charcoal clubs (San Antonio, Brooklyn) stay silver: forcing saturation on them
  // turns the Spurs sky blue, which is not their colour and never was.
  const grey = s0 < 0.22
  const s = grey ? s0 : Math.min(0.92, Math.max(0.45, s0))
  const l =
    theme === 'dark' ? Math.min(0.68, Math.max(0.54, l0)) : Math.min(0.46, Math.max(0.34, l0))
  return toHex(h, grey ? Math.min(s, 0.16) : s, l)
}

/** Black or white text on top of a colour, by perceived brightness. */
function inkOn(hex: string): string {
  const h = hex.replace('#', '')
  const r = Number.parseInt(h.slice(0, 2), 16)
  const g = Number.parseInt(h.slice(2, 4), 16)
  const b = Number.parseInt(h.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? '#16150f' : '#ffffff'
}

/* ------------------------------------------------------------------- apply */

/** Paint the club's colour onto the document. `abbr` undefined means the menu's neutral orange. */
export function applyTeamAccent(abbr: string | undefined, theme: Theme): void {
  const root = document.documentElement
  if (!abbr) {
    root.style.removeProperty('--team-pri')
    root.style.removeProperty('--team-sec')
    root.style.removeProperty('--accent-ink')
    // Dark's default accent is set in CSS; light wants a deeper one to stay legible on paper.
    if (theme === 'light') root.style.setProperty('--team-pri', '#a8551c')
    return
  }
  const [pri, sec] = teamColors(abbr)
  const accent = legible(pri, theme)
  root.style.setProperty('--team-pri', accent)
  root.style.setProperty('--team-sec', legible(sec, theme))
  root.style.setProperty('--accent-ink', inkOn(accent))
}

export function readThemeChoice(): ThemeChoice {
  const v = localStorage.getItem(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function writeThemeChoice(c: ThemeChoice): void {
  if (c === 'system') localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, c)
}

export function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice
}
