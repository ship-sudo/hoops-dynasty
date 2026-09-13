// The playbook: a starting five by position, a named offensive system, and per-man instructions.
//
// Everything in this file is a *pure transform of `Ratings` and `Tendencies`*. Nothing here reaches
// the scoreboard directly. A system does not add points; it changes who shoots, from where, and how
// often, and the engine then does what it always did with those numbers. That is the whole design
// rule, and it is what makes a bad fit genuinely bad: an offence that feeds a big who cannot finish
// really does take worse shots, and the points per possession falls out of the shot mix.
//
// Three levers, three places they land:
//
//   * A **starting five by position.** A man asked to play a slot he is not built for loses the
//     ratings that slot needs — a point guard at centre stops rebounding and stops protecting the
//     rim, because he is six foot two. `outOfPosition` is that loss.
//   * An **offensive system.** It picks a hub and a ball-handler out of the roster, reshapes
//     everyone's shot mix and usage around them, and nudges the team tactics. `systemFit` says out
//     loud whether the roster can run it.
//   * **Per-player instructions.** Usage, threes, post-ups, the offensive glass, defensive effort.
//     The first three are `Tendencies`. The last two are `Ratings` plus a work rate, because
//     effort is energy: a man told to get after it defends better and tires faster.
//
// Neutral in, neutral out. `balanced` with no lineup and no instructions returns every input
// object untouched, so a save that never opens this screen plays exactly as it did before.

import type { Position, Ratings, Tactics, Tendencies } from './types.ts'

export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const satisfies readonly Position[]

function idx(p: Position): number {
  return POSITIONS.indexOf(p)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Ratings live on 0–100. Nothing an instruction does may push a man off the scale. */
function r100(v: number): number {
  return clamp(v, 1, 99)
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-player instructions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the coach tells one man. Every field is a nudge around zero, and zero everywhere means
 * "play your game" — the identity transform.
 */
export interface PlayerInstruction {
  /** How much of the offence he takes. -2 = get out of the way, +2 = it runs through you. */
  usage: number
  /** Shot selection. -2 = never shoot a three, +2 = let it fly. */
  threes: number
  /** Work the post. -1 = stay out of there, +1 = go to work on the block. */
  post: number
  /** The offensive glass. -1 = get back, +1 = crash it. */
  crash: number
  /** How hard he defends. -1 = save your legs, +1 = get after it. */
  effort: number
}

export const NEUTRAL_INSTRUCTION: PlayerInstruction = {
  usage: 0,
  threes: 0,
  post: 0,
  crash: 0,
  effort: 0,
}

export function isNeutralInstruction(i: PlayerInstruction | undefined | null): boolean {
  return (
    i == null ||
    (i.usage === 0 && i.threes === 0 && i.post === 0 && i.crash === 0 && i.effort === 0)
  )
}

/** Clean a value that came off a save file or a URL. */
export function normaliseInstruction(i: Partial<PlayerInstruction> | undefined): PlayerInstruction {
  return {
    usage: Math.round(clamp(i?.usage ?? 0, -2, 2)),
    threes: Math.round(clamp(i?.threes ?? 0, -2, 2)),
    post: Math.round(clamp(i?.post ?? 0, -1, 1)),
    crash: Math.round(clamp(i?.crash ?? 0, -1, 1)),
    effort: Math.round(clamp(i?.effort ?? 0, -1, 1)),
  }
}

function sameInstruction(a: PlayerInstruction, b: PlayerInstruction): boolean {
  return (
    a.usage === b.usage &&
    a.threes === b.threes &&
    a.post === b.post &&
    a.crash === b.crash &&
    a.effort === b.effort
  )
}

/**
 * Named roles a manager can stamp onto a man. Each one is just a `PlayerInstruction` — the engine
 * still only sees usage / threes / post / glass / effort, so applying a preset is the same path as
 * moving the five levers by hand. Neutral in, neutral out: "Play his own game" is the identity.
 */
export type InstructionPresetId =
  | 'own'
  | 'huntThrees'
  | 'spotUp'
  | 'postUp'
  | 'crashGlass'
  | 'lockD'
  | 'playmaker'

export interface InstructionPreset {
  id: InstructionPresetId
  name: string
  blurb: string
  instruction: PlayerInstruction
}

export const INSTRUCTION_PRESET_IDS = [
  'own',
  'huntThrees',
  'spotUp',
  'postUp',
  'crashGlass',
  'lockD',
  'playmaker',
] as const satisfies readonly InstructionPresetId[]

export const INSTRUCTION_PRESETS: Record<InstructionPresetId, InstructionPreset> = {
  own: {
    id: 'own',
    name: 'Play his own game',
    blurb: 'No instruction. He takes the shots he already takes.',
    instruction: { ...NEUTRAL_INSTRUCTION },
  },
  huntThrees: {
    id: 'huntThrees',
    name: 'Hunt threes',
    blurb: 'Let it fly. The mid-range and the post give way.',
    instruction: { usage: 0, threes: 2, post: -1, crash: 0, effort: 0 },
  },
  spotUp: {
    id: 'spotUp',
    name: 'Spot up',
    blurb: 'Space and wait. Fewer possessions, more of them from the arc.',
    instruction: { usage: -1, threes: 1, post: -1, crash: 0, effort: 0 },
  },
  postUp: {
    id: 'postUp',
    name: 'Post up',
    blurb: 'Go to work on the block. More close shots, fewer threes.',
    instruction: { usage: 1, threes: -1, post: 1, crash: 0, effort: 0 },
  },
  crashGlass: {
    id: 'crashGlass',
    name: 'Crash the glass',
    blurb: 'Hunt the offensive rebound. It costs him legs.',
    instruction: { usage: 0, threes: 0, post: 0, crash: 1, effort: 0 },
  },
  lockD: {
    id: 'lockD',
    name: 'Lock in on D',
    blurb: 'Get after it. He defends harder and tires faster.',
    instruction: { usage: -1, threes: 0, post: 0, crash: 0, effort: 1 },
  },
  playmaker: {
    id: 'playmaker',
    name: 'Playmaker',
    blurb: 'The offence runs through him. His shot mix stays his.',
    instruction: { usage: 1, threes: 0, post: 0, crash: 0, effort: 0 },
  },
}

/** Which named role this instruction is, or null if the manager mixed the levers himself. */
export function matchingPreset(
  i: PlayerInstruction | undefined | null,
): InstructionPresetId | null {
  const n = normaliseInstruction(i ?? undefined)
  for (const id of INSTRUCTION_PRESET_IDS) {
    if (sameInstruction(n, INSTRUCTION_PRESETS[id].instruction)) return id
  }
  return null
}

/** How well a named role fits this man. Higher is a better suggestion. */
export function presetFit(id: InstructionPresetId, p: RolePlayer): number {
  const r = p.ratings
  const t = p.tendencies
  switch (id) {
    case 'own':
      return 0
    case 'huntThrees':
      return r.three * 0.7 + t.shotThree * 50
    case 'spotUp':
      return r.three * 0.55 + (0.22 - t.usage) * 80 + t.shotThree * 20
    case 'postUp':
      return (
        r.close * 0.45 + r.rim * 0.25 + t.postUp * 40 + (p.pos === 'C' || p.pos === 'PF' ? 8 : 0)
      )
    case 'crashGlass':
      return r.oreb * 0.75 + r.dreb * 0.2 + (p.pos === 'C' || p.pos === 'PF' ? 6 : 0)
    case 'lockD':
      return Math.max(r.perimD, r.interiorD) * 0.55 + r.steal * 0.2 + r.block * 0.15
    case 'playmaker':
      return r.passing * 0.5 + r.handling * 0.25 + t.assist * 40 + (p.pos === 'PG' ? 8 : 0)
  }
}

/** The 3–4 roles that actually suit him. "Play his own game" is always offered separately. */
export function suggestPresets(p: RolePlayer, n = 4): InstructionPreset[] {
  const ids = INSTRUCTION_PRESET_IDS.filter((id) => id !== 'own')
  ids.sort((a, b) => presetFit(b, p) - presetFit(a, p) || (a < b ? -1 : 1))
  return ids.slice(0, Math.max(1, n)).map((id) => INSTRUCTION_PRESETS[id])
}

/** Rescale a shot mix by a per-zone multiplier and renormalise it back to 1. */
export function remix(t: Tendencies, m: readonly [number, number, number, number]): Tendencies {
  const a = Math.max(0, t.shotRim) * m[0]
  const b = Math.max(0, t.shotClose) * m[1]
  const c = Math.max(0, t.shotMid) * m[2]
  const d = Math.max(0, t.shotThree) * m[3]
  const s = a + b + c + d
  if (!(s > 0)) return t
  return { ...t, shotRim: a / s, shotClose: b / s, shotMid: c / s, shotThree: d / s }
}

/**
 * The three instructions that are `Tendencies`. Shooting more threes is a real change of shot mix,
 * not a bonus: the shots come off the other zones, and whether that helps depends entirely on
 * whether the man can shoot. The engine works it out; this function has no opinion.
 */
export function instructedTendencies(t: Tendencies, ins: PlayerInstruction): Tendencies {
  let out = t
  if (ins.threes > 0) {
    // Part multiplier, part flat shift. A pure multiplier is useless at the bottom of the roster:
    // a centre who takes 6% of his shots from three would still take 8% after being told to let
    // it fly, which is not what the coach said and not what the manager wants to see happen. The
    // flat term is what makes "go and shoot threes" mean something to a man who never shoots any —
    // and it is exactly the case where it will cost you, which is the point.
    const w3 = clamp(t.shotThree * (1 + 0.18 * ins.threes) + 0.05 * ins.threes, 0, 0.85)
    // The mid-range gives way first. It is the shot a coach is really trading away.
    const mid = Math.max(0, t.shotMid) * (1 - 0.2 * ins.threes)
    const rest = Math.max(0, t.shotRim) + Math.max(0, t.shotClose) + mid
    const room = 1 - w3
    const k = rest > 0 ? room / rest : 0
    out = {
      ...out,
      shotRim: Math.max(0, t.shotRim) * k,
      shotClose: Math.max(0, t.shotClose) * k,
      shotMid: mid * k,
      shotThree: w3,
    }
  } else if (ins.threes < 0) {
    out = remix(out, [1, 1, 1 - 0.1 * ins.threes, 1 + 0.34 * ins.threes])
  }
  if (ins.post !== 0) {
    out = remix(out, [
      1 + 0.12 * ins.post,
      1 + 0.4 * ins.post,
      1 - 0.1 * ins.post,
      1 - 0.28 * ins.post,
    ])
    out = { ...out, postUp: clamp(out.postUp + 0.3 * ins.post, 0, 1) }
  }
  if (ins.usage !== 0) {
    out = { ...out, usage: clamp(out.usage * (1 + 0.16 * ins.usage), 0.05, 0.42) }
  }
  return out
}

/**
 * The two instructions that are `Ratings`. Defensive effort is the honest one: a man who gets after
 * it really does stay in front and get his hands in more often. It is paid for in `workRate`.
 */
export function instructedRatings(r: Ratings, ins: PlayerInstruction): Ratings {
  if (ins.crash === 0 && ins.effort === 0) return r
  return {
    ...r,
    oreb: r100(r.oreb + 7 * ins.crash),
    perimD: r100(r.perimD + 4.5 * ins.effort),
    interiorD: r100(r.interiorD + 4 * ins.effort),
    steal: r100(r.steal + 3 * ins.effort),
  }
}

/**
 * Stamina drain multiplier. Effort and crashing the glass are both a decision to run further, and
 * the engine bills for that: a man told to do both wears down a quarter faster than he otherwise
 * would, which is a real cost in the fourth. 1 is the default and changes nothing.
 */
export function instructedWorkRate(ins: PlayerInstruction): number {
  return clamp(1 + 0.28 * ins.effort + 0.15 * ins.crash, 0.6, 1.6)
}

/** How much of a night's rest a step of the pace tactic costs. See `nightlyLoad`. */
export const TEMPO_LOAD = 0.18

/**
 * What a night's minutes are *billed* as, between games. The engine's own fatigue term handles the
 * fourth quarter; this is the other half — a man who defends like that and runs like that every
 * night does not recover like a man who does not, and the season's injury hazard reads the same
 * number. Thirty-six minutes at 1.28 are charged as forty-six.
 *
 * 1 at every default, so a team nobody has instructed recovers exactly as it did before.
 */
export function nightlyLoad(workRate: number | undefined, pace: number): number {
  return clamp((workRate ?? 1) * (1 + TEMPO_LOAD * pace), 0.5, 2)
}

// ─────────────────────────────────────────────────────────────────────────────
// A starting five by position
// ─────────────────────────────────────────────────────────────────────────────

/** How far out of position a man is, signed. Positive means he is playing bigger than he is. */
export function positionGap(natural: Position, slot: Position): number {
  return idx(slot) - idx(natural)
}

/**
 * What it costs. Playing a man up a slot asks him to rebound, bang and protect the rim against
 * somebody bigger; playing him down asks him to stay in front of somebody quicker and bring the
 * ball up against pressure. Both are ratings the engine already reads, so the cost shows up as
 * fewer rebounds and worse defence rather than as a number subtracted from the score.
 *
 * A man in his own slot is returned untouched — this must be exactly the identity, or a squad
 * nobody has touched would play differently from the day before.
 */
export function outOfPosition(r: Ratings, natural: Position, slot: Position): Ratings {
  const d = positionGap(natural, slot)
  if (d === 0) return r
  if (d > 0) {
    // Undersized: he is giving away inches and pounds to the man he has to box out and guard.
    return {
      ...r,
      dreb: r100(r.dreb - 5.5 * d),
      oreb: r100(r.oreb - 5 * d),
      interiorD: r100(r.interiorD - 6 * d),
      block: r100(r.block - 6 * d),
      strength: r100(r.strength - 5 * d),
      close: r100(r.close - 2.5 * d),
    }
  }
  // Oversized: he is chasing somebody quicker, and handling it against ball pressure.
  const e = -d
  return {
    ...r,
    perimD: r100(r.perimD - 6 * e),
    steal: r100(r.steal - 4 * e),
    speed: r100(r.speed - 5 * e),
    handling: r100(r.handling - 4.5 * e),
  }
}

/** Plain words for the screen. Empty when he is where he belongs. */
export function positionNote(natural: Position, slot: Position): string {
  const d = positionGap(natural, slot)
  if (d === 0) return ''
  const size = Math.abs(d)
  const word = size === 1 ? 'a slot' : size === 2 ? 'two slots' : `${size} slots`
  return d > 0
    ? `${natural} playing ${slot} — ${word} up. He gives away the glass and the rim.`
    : `${natural} playing ${slot} — ${word} down. He cannot stay in front out there.`
}

/** 0 when he fits, rising with how badly he does not. Used to sort the honesty banner. */
export function positionSeverity(natural: Position, slot: Position): number {
  return Math.abs(positionGap(natural, slot))
}

// ─────────────────────────────────────────────────────────────────────────────
// Offensive systems
// ─────────────────────────────────────────────────────────────────────────────

export type OffenseSystemId = 'balanced' | 'insideOut' | 'motion' | 'pickRoll' | 'early'

export const OFFENSE_SYSTEM_IDS = [
  'balanced',
  'insideOut',
  'motion',
  'pickRoll',
  'early',
] as const satisfies readonly OffenseSystemId[]

/** Which job a man is doing in the system. The system picks these off the roster itself. */
export type SystemRole = 'hub' | 'handler' | 'other'

export interface OffenseSystemSpec {
  id: OffenseSystemId
  name: string
  /** One line on what the offence is. */
  blurb: string
  /** What it buys you. */
  strength: string
  /** What it costs you. Every system has one. */
  cost: string
  /** The personnel it wants. */
  suits: string
  /** Nudges to the team knobs. Added to whatever the manager set, then clamped to -1..1. */
  tactics: Partial<Pick<Tactics, 'pace' | 'threes' | 'crashGlass'>>
}

export const OFFENSE_SYSTEMS: Record<OffenseSystemId, OffenseSystemSpec> = {
  balanced: {
    id: 'balanced',
    name: 'Read and react',
    blurb: 'No system. Everybody plays the way he plays and the best available shot goes up.',
    strength: 'Nothing to expose. Every man does what he is already good at.',
    cost: 'Nothing to exploit either — you beat people with talent, not with shape.',
    suits: 'Any roster, and the safe answer when you are not sure.',
    tactics: {},
  },
  insideOut: {
    id: 'insideOut',
    name: 'Inside-out',
    blurb:
      'Throw it to the post, let him go to work, and shoot what the double team gives up. Slow, physical, second chances.',
    strength:
      'The best shots on the floor and a steady diet of free throws, plus an offensive glass nobody has boxed out for.',
    cost: 'Few threes and a slow clock. If the post cannot score, the whole thing stalls on him.',
    suits: 'A big who can genuinely finish and bang — close range, strength, and a whistle.',
    tactics: { pace: -1, threes: -1, crashGlass: 1 },
  },
  motion: {
    id: 'motion',
    name: 'Motion',
    blurb:
      'Nobody holds it. Five men cut, screen and pass until the defence breaks somewhere, and whoever is open shoots.',
    strength:
      'You cannot game-plan one man out of it. Shot quality is high everywhere and the ball does not stick.',
    cost: 'Your best player takes fewer shots. On a top-heavy roster that is points you are giving away, and you will see them go.',
    suits:
      'Five men who can all score a bit. It is the worst place to hide anybody, and the wrong home for a one-man team.',
    tactics: {},
  },
  pickRoll: {
    id: 'pickRoll',
    name: 'Pick and roll',
    blurb:
      'One handler, one screener, every possession. Get to the rim or kick it out — nothing in between.',
    strength: 'A diet of the two best shots in basketball: layups and threes. Very little else.',
    cost: 'It all runs through one man. If he cannot handle it, you turn it over; when he sits, the offence goes with him.',
    suits: 'A guard who can handle and pass, and a big who finishes what the guard starts.',
    tactics: {},
  },
  early: {
    id: 'early',
    name: 'Push the tempo',
    blurb:
      'Rebound and go. Shoot the first good look inside seven seconds and do not worry about the offensive glass.',
    strength: 'More possessions, more shots, more threes, and defences that never get set.',
    cost: 'Your men tire — running costs legs, and the fourth quarter is where you find out. The other side gets the ball back just as often as you do.',
    suits: 'Depth, stamina, shooters and legs. It is a cruel system for a short, old rotation.',
    tactics: { pace: 1, threes: 1, crashGlass: -1 },
  },
}

/** The subset of a player a system needs to see. */
export interface RolePlayer {
  playerId: string
  /** Only used to write the fit notes. Ids read badly in a sentence. */
  name?: string
  pos: Position
  ratings: Ratings
  tendencies: Tendencies
}

export interface SystemRoles {
  /** The man the post-up offence runs through, if there is one. */
  hubId: string | null
  /** The primary ball-handler. */
  handlerId: string | null
}

function hubScore(p: RolePlayer): number {
  const r = p.ratings
  return (
    r.close * 0.4 +
    r.rim * 0.25 +
    r.strength * 0.15 +
    r.drawFoul * 0.1 +
    p.tendencies.postUp * 30 +
    (p.pos === 'C' ? 8 : p.pos === 'PF' ? 5 : 0)
  )
}

function handlerScore(p: RolePlayer): number {
  const r = p.ratings
  return (
    r.passing * 0.4 +
    r.handling * 0.32 +
    r.iq * 0.18 +
    p.tendencies.assist * 40 +
    (p.pos === 'PG' ? 8 : p.pos === 'SG' ? 4 : 0)
  )
}

/** Who runs it. Ties break on player id so the choice is deterministic. */
export function assignRoles(players: readonly RolePlayer[]): SystemRoles {
  let hub: RolePlayer | null = null
  let hubV = Number.NEGATIVE_INFINITY
  let handler: RolePlayer | null = null
  let handlerV = Number.NEGATIVE_INFINITY
  for (const p of players) {
    const h = hubScore(p)
    if (h > hubV || (h === hubV && hub != null && p.playerId < hub.playerId)) {
      hubV = h
      hub = p
    }
    const g = handlerScore(p)
    if (g > handlerV || (g === handlerV && handler != null && p.playerId < handler.playerId)) {
      handlerV = g
      handler = p
    }
  }
  return { hubId: hub?.playerId ?? null, handlerId: handler?.playerId ?? null }
}

export function roleOf(playerId: string, roles: SystemRoles): SystemRole {
  if (playerId === roles.hubId) return 'hub'
  if (playerId === roles.handlerId) return 'handler'
  return 'other'
}

/** The mean usage a system flattens toward, when it flattens. */
const LEAGUE_USAGE = 0.2

/**
 * What a system does to one man's tendencies, given the job it has handed him. This is the whole
 * mechanism: shot mix and usage move, and nothing else does.
 */
export function systemTendencies(id: OffenseSystemId, t: Tendencies, role: SystemRole): Tendencies {
  switch (id) {
    case 'balanced':
      return t
    case 'insideOut': {
      if (role === 'hub') {
        const out = remix(t, [1.15, 1.6, 0.9, 0.45])
        return {
          ...out,
          postUp: clamp(out.postUp + 0.35, 0, 1),
          usage: clamp(out.usage * 1.45, 0.05, 0.42),
        }
      }
      // Everyone else spaces and waits for the kick-out.
      const out = remix(t, [0.95, 0.9, 1, 1.12])
      return {
        ...out,
        usage: clamp(out.usage * 0.88, 0.05, 0.42),
        assist: clamp(out.assist * 1.08, 0, 1),
      }
    }
    case 'motion': {
      // Usage is dragged 45% of the way back to the league mean. That is the trade: the offence
      // becomes unguardable in the abstract and your best player shoots less.
      // Motion is about *who* shoots, not from where: the location shift is almost nothing, and
      // the whole system is the usage flattening above. That is deliberate. Every system that
      // trades mid-range for threes gains in this engine no matter who is on the floor, which
      // would have made "does it fit?" meaningless.
      const usage = clamp(t.usage + (LEAGUE_USAGE - t.usage) * 0.6, 0.05, 0.42)
      const out = remix(t, [1, 1, 0.96, 1.04])
      return { ...out, usage, assist: clamp(out.assist * 1.25, 0, 1) }
    }
    case 'pickRoll': {
      if (role === 'handler') {
        const out = remix(t, [1.15, 0.95, 0.78, 1.15])
        return {
          ...out,
          usage: clamp(out.usage * 1.32, 0.05, 0.42),
          assist: clamp(out.assist * 1.35, 0, 1),
        }
      }
      if (role === 'hub') {
        const out = remix(t, [1.5, 1.2, 0.5, 0.4])
        return { ...out, usage: clamp(out.usage * 1.05, 0.05, 0.42) }
      }
      const out = remix(t, [1.05, 0.95, 0.7, 1.2])
      return { ...out, usage: clamp(out.usage * 0.86, 0.05, 0.42) }
    }
    case 'early': {
      const out = remix(t, [1.1, 0.95, 0.7, 1.22])
      // Everybody handles it in transition, so usage flattens a little.
      const usage = clamp(out.usage + (LEAGUE_USAGE - out.usage) * 0.15, 0.05, 0.42)
      return { ...out, usage }
    }
  }
}

/** The team knobs the system asks for, on top of whatever the manager set. */
export function systemTactics(id: OffenseSystemId, base: Tactics): Tactics {
  const spec = OFFENSE_SYSTEMS[id]
  const k = (v: number): -1 | 0 | 1 => (v > 0 ? 1 : v < 0 ? -1 : 0)
  return {
    ...base,
    pace: k(base.pace + (spec.tactics.pace ?? 0)),
    threes: k(base.threes + (spec.tactics.threes ?? 0)),
    crashGlass: k(base.crashGlass + (spec.tactics.crashGlass ?? 0)),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Does the roster fit the system?
// ─────────────────────────────────────────────────────────────────────────────

export type FitVerdict = 'strong' | 'workable' | 'poor'

export interface SystemFit {
  id: OffenseSystemId
  /** 0–100, with 50 the roster that is neither helped nor hurt. */
  score: number
  verdict: FitVerdict
  /** Plain sentences saying why, good and bad. */
  lines: string[]
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function verdictOf(score: number): FitVerdict {
  return score >= 60 ? 'strong' : score >= 44 ? 'workable' : 'poor'
}

// ── the shot arithmetic, mirrored from the engine ────────────────────────────
// These four constants and this formula are a copy of what `packages/engine` does to decide
// whether a shot goes in. Core cannot import the engine — it is the other way round — so they are
// duplicated here, deliberately and with this comment on them. The point is that the screen's
// verdict and the engine's result come out of the *same* arithmetic: if the fit panel says an
// offence takes worse shots with these men, the box score will agree, because it is the same sum.
const FIT_GAIN = 1.3
const FIT_SHOT_K = [0.5, 0.48, 0.48, 0.46] as const
const FIT_REF_ZONE = [52.3, 54.1, 54.6, 55.6] as const
/** A modern-ish league's make rate by zone. The comparison is relative, so the era barely matters. */
const FIT_BASE_PCT = [0.62, 0.4, 0.4, 0.355] as const
const FIT_VALUE = [2, 2, 2, 3] as const

function oddsAdj(p: number, z: number): number {
  if (z === 0) return p
  const e = Math.exp(z)
  return (p * e) / (1 - p + p * e)
}

/** Expected points per shot attempt for one man, given the shot mix he has been handed. */
export function pointsPerShot(r: Ratings, t: Tendencies): number {
  const share = [t.shotRim, t.shotClose, t.shotMid, t.shotThree]
  const rate = [r.rim, r.close, r.mid, r.three]
  let pts = 0
  let w = 0
  for (let z = 0; z < 4; z++) {
    const s = Math.max(0, share[z] ?? 0)
    if (s <= 0) continue
    const p = oddsAdj(
      FIT_BASE_PCT[z] as number,
      FIT_GAIN *
        (FIT_SHOT_K[z] as number) *
        ((rate[z] as number) - (FIT_REF_ZONE[z] as number)) *
        0.02,
    )
    pts += s * p * (FIT_VALUE[z] as number)
    w += s
  }
  // Trips to the line, which is most of what an inside diet is worth. Rim and post attempts draw
  // fouls; threes barely do.
  const foulish = Math.max(0, share[0] ?? 0) * 1.65 + Math.max(0, share[1] ?? 0) * 1.15
  pts += foulish * 0.09 * (0.6 + r.drawFoul * 0.008) * (r.ft * 0.012 + 0.16)
  return w > 0 ? pts / w : 0
}

/** What this roster would score per shot under a system, weighted by who takes the shots. */
function teamPointsPerShot(id: OffenseSystemId, players: readonly RolePlayer[]): number {
  const roles = id === 'balanced' ? { hubId: null, handlerId: null } : assignRoles(players)
  let pts = 0
  let w = 0
  for (const p of players) {
    const t =
      id === 'balanced'
        ? p.tendencies
        : systemTendencies(id, p.tendencies, roleOf(p.playerId, roles))
    const weight = Math.max(0.02, t.usage)
    pts += weight * pointsPerShot(p.ratings, t)
    w += weight
  }
  return w > 0 ? pts / w : 0
}

/**
 * Honest personnel arithmetic. This does not change a single number the engine reads — it is the
 * screen telling the truth in advance about what the engine is about to do to you.
 */
export function systemFit(id: OffenseSystemId, players: readonly RolePlayer[]): SystemFit {
  const roles = assignRoles(players)
  const hub = players.find((p) => p.playerId === roles.hubId) ?? null
  const handler = players.find((p) => p.playerId === roles.handlerId) ?? null
  const lines: string[] = []

  if (id === 'balanced' || players.length === 0) {
    return {
      id,
      score: 50,
      verdict: 'workable',
      lines: ['Nothing is asked of anybody he does not already do.'],
    }
  }

  // The heart of it: what these men would score per shot under this offence, against what they
  // score under no offence at all. Everything else is a correction to that number.
  const delta = teamPointsPerShot(id, players) - teamPointsPerShot('balanced', players)
  let score = 50 + delta * 520

  if (id === 'insideOut') {
    if (hub) {
      const strong = hub.ratings.close * 0.4 + hub.ratings.rim * 0.3 + hub.ratings.drawFoul * 0.3
      lines.push(
        strong >= 62
          ? `${nameless(hub)} can carry it: he finishes inside and he gets to the line.`
          : strong >= 50
            ? `${nameless(hub)} is the hub by default. He is adequate on the block, not dominant.`
            : `${nameless(hub)} is the best post option you have, and he is not one. This offence feeds him anyway.`,
      )
    }
    const spacing = mean(players.map((p) => p.ratings.three))
    lines.push(
      spacing < 48
        ? 'There is no shooting around him, so the double team is free.'
        : spacing > 56
          ? 'The shooting around him makes the double team expensive.'
          : 'The shooting around him is ordinary.',
    )
  } else if (id === 'motion') {
    // Ball movement is worth something the shot mix cannot see: fewer contested shots and a
    // cleaner read. Passing and IQ are where that lives.
    const brain = mean(players.map((p) => p.ratings.passing * 0.55 + p.ratings.iq * 0.45))
    score += (brain - 52) * 0.55
    const usages = players.map((p) => p.tendencies.usage).sort((a, b) => b - a)
    const top = usages[0] ?? LEAGUE_USAGE
    const rest = mean(usages.slice(1))
    if (rest > 0 && top / rest > 1.55) {
      lines.push(
        'Your offence runs through one man, and this takes the ball out of his hands — that is the cost, and it is already in the number.',
      )
    }
    lines.push(
      brain >= 58
        ? 'Five men who can pass and read. Nobody has to be hidden.'
        : brain >= 48
          ? 'Passable. Some of this five will be asked to make reads they do not make.'
          : 'These are not passers. Ball movement with these hands is a turnover with extra steps.',
    )
  } else if (id === 'pickRoll') {
    if (handler) {
      // Everything goes through one man, so his hands matter more than his shot mix says.
      const hands = handler.ratings.handling * 0.6 + handler.ratings.iq * 0.4
      score += (hands - 51) * 0.5
      lines.push(
        hands >= 58
          ? `${nameless(handler)} can run it — he handles it and he sees the floor.`
          : hands >= 48
            ? `${nameless(handler)} will run it. He is safe enough with it.`
            : `${nameless(handler)} is your handler and he is not safe with it. Expect turnovers.`,
      )
    }
    if (hub) {
      lines.push(
        hub.ratings.rim >= 58
          ? `${nameless(hub)} finishes the roll.`
          : `${nameless(hub)} does not finish at the rim, which is half of what this offence generates.`,
      )
    }
  } else if (id === 'early') {
    // Running is paid for in legs. Stamina, and how many bodies you have to spread it over.
    const legs = mean(players.map((p) => p.ratings.stamina))
    score += (legs - 55) * 0.5
    const depth = players.length
    if (depth < 9) {
      score -= (9 - depth) * 3.5
      lines.push(
        `Only ${depth} men in the rotation. Running with a short bench is how you lose fourth quarters.`,
      )
    }
    lines.push(
      legs >= 58
        ? 'Legs and lungs. This group can keep it up in April.'
        : legs >= 50
          ? 'They can run it. They will feel it in April.'
          : 'This group cannot run. You will be tired while you take worse shots.',
    )
  }

  return { id, score: Math.round(clamp(score, 0, 100)), verdict: verdictOf(score), lines }
}

function nameless(p: RolePlayer): string {
  return p.name ?? p.playerId
}

/** Rank every system for a roster, best fit first. The screen leads with the honest answer. */
export function rankSystems(players: readonly RolePlayer[]): SystemFit[] {
  return OFFENSE_SYSTEM_IDS.map((id) => systemFit(id, players)).sort((a, b) => b.score - a.score)
}

// ─────────────────────────────────────────────────────────────────────────────
// Named five-man units
// ─────────────────────────────────────────────────────────────────────────────
//
// Real coaches do not hand out a minutes number and hope. They put a group on the
// floor, sit them together, and change the group when the game changes: the
// starting five open, the bench unit takes the middle of the quarter, a closing
// five (often not the starters — small-ball, a stopper, a sixth-man) finishes a
// tight fourth, and the stars sit down in a blowout.
//
// This file only decides *which* unit. Who fills a slot, and next-man-up when
// somebody is hurt, lives in `packages/game/src/rotation.ts`. The engine calls
// `unitForSituation` when `TeamGameInput.units` is present; when it is not, the
// greedy minute-share path is untouched.

export const LINEUP_UNIT_IDS = ['starters', 'bench', 'closing'] as const
export type LineupUnitId = (typeof LINEUP_UNIT_IDS)[number]

/** Five men by slot. Empty slots are filled from the depth chart. */
export type LineupSlots = Partial<Record<Position, string>>

/** Named lineups on a team. Optional on a save: missing means the old minutes share. */
export type NamedLineups = Partial<Record<LineupUnitId, LineupSlots>>

/** Pace and shot mix for one named five. Missing on a unit means it plays like the team. */
export type UnitStyle = Pick<Tactics, 'pace' | 'threes'>
export type NamedUnitStyles = Partial<Record<LineupUnitId, UnitStyle>>

/** What the engine actually puts on the floor, including garbage time. */
export type RotationUnitId = LineupUnitId | 'blowout'

/** Where we are in a game, enough to pick a unit. Clock is seconds left in the period. */
export interface RotationSituation {
  /** 1–4 regulation, 5+ overtime. */
  period: number
  /** Seconds remaining in this period. */
  clock: number
  /** This team's lead. Negative if trailing. */
  margin: number
  /**
   * Mean condition of the named starters, 0–1. Absent or 1 means fresh.
   * A back-to-back leaves this around 0.7–0.85 via `PlayerAvailability.condition`.
   */
  starterCondition?: number
}

/** Last six minutes: the NBA's closing window, not the whole fourth. */
const CLOSING_CLOCK = 360
/** First TV timeout is around 6:00. That is when the starting five usually sits. */
const OPENING_STINT = 360
/** Last two minutes of Q1/Q3: starters close the quarter. */
const LATE_QUARTER = 120
/** Start of Q2: the second unit opens the quarter. */
const Q2_BENCH = 480
/** A game that is no longer a game. Coaches rest stars around 18; earlier if they are gassed. */
const BLOWOUT_FRESH = 18
const BLOWOUT_TIRED = 14
/** Close enough that the closing five, not the bench, should be out there. */
const CLOSE_GAME = 8
/** Below this, starters are treated as tired (back-to-back, heavy load). */
const TIRED = 0.8

/**
 * Which unit a coach puts on the floor. Deterministic: the same score and clock
 * always pick the same group. No rng.
 *
 * Pattern is the NBA's regimented one (see Reddit rotation charts, Carlisle/Kerr):
 * starters open Q1/Q3, bench around the first TV timeout, starters close the
 * quarter; Q2 opens with the second unit; a tight fourth from 6:00 is the
 * closing five; a blowout sits the stars.
 */
export function unitForSituation(s: RotationSituation): RotationUnitId {
  const abs = Math.abs(s.margin)
  const tired = (s.starterCondition ?? 1) < TIRED
  const blowoutCut = tired ? BLOWOUT_TIRED : BLOWOUT_FRESH

  if (s.period >= 4 && abs >= blowoutCut) return 'blowout'
  if (s.period === 3 && abs >= blowoutCut && s.clock <= Q2_BENCH) return 'blowout'

  if (s.period >= 4 && abs <= CLOSE_GAME && (s.period > 4 || s.clock <= CLOSING_CLOCK)) {
    return 'closing'
  }

  if (s.period === 1 || s.period === 3) {
    if (s.clock > OPENING_STINT) return 'starters'
    if (s.clock > LATE_QUARTER) return 'bench'
    return 'starters'
  }

  if (s.period === 2) {
    if (s.clock > Q2_BENCH) return 'bench'
    return 'starters'
  }

  // Q4 before the closing window: rest tired stars when it is not a game, else starters.
  if (s.period === 4 && tired && abs > CLOSE_GAME && s.clock > CLOSING_CLOCK) return 'bench'
  return 'starters'
}

/** Drop empty slots and empty units so a cleared plan stores as nothing. */
export function normaliseLineups(raw: NamedLineups | undefined | null): NamedLineups | undefined {
  if (raw == null) return undefined
  const out: NamedLineups = {}
  for (const id of LINEUP_UNIT_IDS) {
    const slots = raw[id]
    if (!slots) continue
    const cleaned: LineupSlots = {}
    for (const pos of POSITIONS) {
      const pid = slots[pos]
      if (pid) cleaned[pos] = pid
    }
    if (POSITIONS.some((p) => cleaned[p])) out[id] = cleaned
  }
  return LINEUP_UNIT_IDS.some((id) => out[id]) ? out : undefined
}

function asStep(n: number | undefined): -1 | 0 | 1 {
  if (n == null || n === 0) return 0
  return n > 0 ? 1 : -1
}

/** Drop empty units so a cleared plan stores as nothing. */
export function normaliseUnitTactics(
  raw: NamedUnitStyles | undefined | null,
): NamedUnitStyles | undefined {
  if (raw == null) return undefined
  const out: NamedUnitStyles = {}
  for (const id of LINEUP_UNIT_IDS) {
    const s = raw[id]
    if (!s) continue
    out[id] = { pace: asStep(s.pace), threes: asStep(s.threes) }
  }
  return LINEUP_UNIT_IDS.some((id) => out[id]) ? out : undefined
}

/** True when at least one unit has all five slots named. That is opt-in. */
export function hasNamedLineups(lineups: NamedLineups | undefined | null): boolean {
  if (!lineups) return false
  return LINEUP_UNIT_IDS.some((id) => POSITIONS.every((p) => !!lineups[id]?.[p]))
}
