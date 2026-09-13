/** Primary / secondary per franchise abbreviation. Covers every abbr the 1998–2026 bundles use. */
const COLORS: Record<string, [string, string]> = {
  ATL: ['#e03a3e', '#26282a'],
  BKN: ['#2f3033', '#c4cdd3'],
  BOS: ['#007a33', '#ba9653'],
  CHA: ['#1d1160', '#00788c'],
  CHH: ['#00778b', '#280071'],
  CHI: ['#ce1141', '#1d1d1d'],
  CLE: ['#860038', '#fdbb30'],
  DAL: ['#00538c', '#b8c4ca'],
  DEN: ['#0e2240', '#fec524'],
  DET: ['#c8102e', '#1d42ba'],
  GSW: ['#1d428a', '#ffc72c'],
  HOU: ['#ce1141', '#9ea2a2'],
  IND: ['#002d62', '#fdbb30'],
  LAC: ['#c8102e', '#1d428a'],
  LAL: ['#552583', '#fdb927'],
  MEM: ['#5d76a9', '#12173f'],
  MIA: ['#98002e', '#f9a01b'],
  MIL: ['#00471b', '#eee1c6'],
  MIN: ['#0c2340', '#236192'],
  NJN: ['#002a60', '#c30f3c'],
  NOH: ['#0c2340', '#b4975a'],
  NOK: ['#0c2340', '#b4975a'],
  NOP: ['#0c2340', '#c8102e'],
  NYK: ['#006bb6', '#f58426'],
  OKC: ['#007ac1', '#ef3b24'],
  ORL: ['#0077c0', '#c4ced4'],
  PHI: ['#006bb6', '#ed174c'],
  PHX: ['#1d1160', '#e56020'],
  POR: ['#e03a3e', '#25282a'],
  SAC: ['#5a2d81', '#63727a'],
  SAS: ['#c4ced4', '#1d1d1d'],
  SEA: ['#00653a', '#ffc200'],
  TOR: ['#ce1141', '#26282a'],
  UTA: ['#002b5c', '#f9a01b'],
  VAN: ['#00a982', '#12264d'],
  WAS: ['#002b5c', '#e31837'],
}

const FALLBACK: [string, string] = ['#5b6472', '#c4ced4']

export function teamColors(abbr: string): [string, string] {
  return COLORS[abbr] ?? FALLBACK
}
