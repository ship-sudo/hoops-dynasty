/**
 * The coach's screen: who starts and where, how the team plays, what each man is told to do, and
 * how the forty-eight minutes are spent.
 *
 * Everything here writes straight through `setPlan`, so the next game played uses it.
 *
 * Two rules this screen holds to.
 *
 *   * **The budget is real.** A basketball game is 240 man-minutes. The sim treats explicit
 *     minutes as shares and renormalises to 240 whatever you type, which is a defensible model and
 *     reads as a bug: the old screen let a plan add up to 279 and just turned the total red. Now
 *     the number of minutes left to assign is the largest thing on the page, a stepper cannot take
 *     the team over, and "Balance to 240" scales the shape you set into the budget without
 *     throwing your plan away.
 *   * **Nothing here is a bonus.** A system and an instruction change a man's `Tendencies` — how
 *     much of the offence he takes, and from where — and, for effort and the glass, his `Ratings`
 *     and how fast he tires. The engine then does what it always did. That is why the fit panel
 *     can tell you in advance that an offence will not work: it is running the same shot
 *     arithmetic the engine is about to run.
 */
import type {
  LineupUnitId,
  NamedLineups,
  OffenseSystemId,
  PlayerInstruction,
  Position,
  Ratings,
  Tactics as TacticsSettings,
  Tendencies,
} from '@hoops/core'
import {
  assignRoles,
  INSTRUCTION_PRESETS,
  type InstructionPreset,
  instructedRatings,
  instructedTendencies,
  isNeutralInstruction,
  LINEUP_UNIT_IDS,
  matchingPreset,
  NEUTRAL_INSTRUCTION,
  normaliseInstruction,
  OFFENSE_SYSTEMS,
  outOfPosition,
  POSITIONS,
  positionGap,
  positionNote,
  type RolePlayer,
  rankSystems,
  roleOf,
  suggestPresets,
  systemFit,
  systemTendencies,
} from '@hoops/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RatingCard, RosterRow, TeamPlan } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Modal, Panel, RatingBar } from '../ui/bits.tsx'
import { height, n1 } from '../ui/format.ts'
import './tactics.css'

/** The automatic ladder, mirrored from packages/game/src/rotation.ts. It sums to exactly 240. */
const LADDER = [36, 34, 32, 30, 28, 22, 18, 15, 12, 8, 5]
/** Regular-season auto: nine men. Playoffs shrink. r/nba consensus is 8–9 / 7–8. */
const AUTO_RS = [34, 32, 30, 28, 26, 24, 22, 18, 16]
const AUTO_PO = [38, 36, 34, 32, 28, 24, 20, 16]
/** Discrete minutes a manager can assign. Current values not on the list stay selectable. */
const MINUTE_STEPS = [0, 8, 12, 16, 18, 20, 22, 24, 28, 32, 36, 40]

const TEAM_MINUTES = 240
const HEAVY = 42
/** Below this many men with minutes, the bench is thin enough to say so. */
const THIN_ROTATION = 8

const DEFAULT_TACTICS: TacticsSettings = {
  pace: 0,
  threes: 0,
  crashGlass: 0,
  pressure: 0,
  zone: false,
}

const UNIT_LABEL: Record<LineupUnitId, string> = {
  starters: 'Starters',
  bench: 'Bench',
  closing: 'Closing',
}

// The card carries the rating a person should read — a flat mean of the raw nineteen says an
// All-Star is a 55.
const overallOf = (r: RosterRow) => r.card.overall

/** Best remaining body for each slot. Naturals first, then the next-closest position. */
function pickFive(
  pool: RosterRow[],
  taken: Set<string>,
): Partial<Record<Position, string>> {
  const next: Partial<Record<Position, string>> = {}
  for (const gap of [0, 1, 2, 3, 4]) {
    for (const pos of POSITIONS) {
      if (next[pos]) continue
      const man = pool.find(
        (r) => !taken.has(r.player.playerId) && Math.abs(positionGap(r.player.pos, pos)) === gap,
      )
      if (!man) continue
      next[pos] = man.player.playerId
      taken.add(man.player.playerId)
    }
  }
  return next
}

type Knob = Exclude<keyof TacticsSettings, 'zone'>

const KNOBS: { key: Knob; label: string; low: string; high: string; blurb: string }[] = [
  {
    key: 'pace',
    label: 'Pace',
    low: 'Slow it down',
    high: 'Push it',
    blurb:
      'How many possessions you want. Pushing gets you more shots and more of theirs, and it costs legs: a running team tires faster and recovers less between games.',
  },
  {
    key: 'threes',
    label: 'Shot selection',
    low: 'Work inside',
    high: 'Let them fly',
    blurb:
      'Shifts the whole team’s shot mix towards or away from the arc. Only pays if the men taking them can shoot.',
  },
  {
    key: 'crashGlass',
    label: 'Offensive glass',
    low: 'Get back',
    high: 'Crash it',
    blurb:
      'Crashing wins second chances and concedes transition — the other side shoots better on the next trip. Getting back trades the putbacks for a set defence.',
  },
  {
    key: 'pressure',
    label: 'Defensive pressure',
    low: 'Sit back',
    high: 'Get after it',
    blurb:
      'Aggression on the ball: more turnovers forced, more fouls given away and more trips to the line for them.',
  },
]

/** The five levers a manager pulls on one man. */
type Lever = keyof PlayerInstruction

const LEVERS: {
  key: Lever
  label: string
  values: number[]
  labels: string[]
  blurb: string
}[] = [
  {
    key: 'usage',
    label: 'Share of the offence',
    values: [-2, -1, 0, 1, 2],
    labels: ['Defer', 'Less', 'Normal', 'More', 'Focal point'],
    blurb:
      'How often a possession ends with him. A focal point takes about a third more than he does now.',
  },
  {
    key: 'threes',
    label: 'Threes',
    values: [-2, -1, 0, 1, 2],
    labels: ['Never', 'Fewer', 'Normal', 'More', 'Let it fly'],
    blurb:
      'Moves his shot mix towards the arc, mid-range first. It is a change of diet, not a bonus: it pays only if he can shoot.',
  },
  {
    key: 'post',
    label: 'The post',
    values: [-1, 0, 1],
    labels: ['Stay outside', 'Normal', 'Go to work'],
    blurb: 'Puts him on the block. More shots close in, more fouls drawn, fewer threes.',
  },
  {
    key: 'crash',
    label: 'Offensive glass',
    values: [-1, 0, 1],
    labels: ['Get back', 'Normal', 'Crash it'],
    blurb: 'Chasing the ball off the rim wins second chances and costs him legs.',
  },
  {
    key: 'effort',
    label: 'Defensive effort',
    values: [-1, 0, 1],
    labels: ['Save his legs', 'Normal', 'Get after it'],
    blurb:
      'He stays in front and gets his hands in more — and tires faster, in this game and over the season.',
  },
]

/** The chips a row shows when it is closed. A glance has to be enough. */
function chipsFor(i: PlayerInstruction): { text: string; tone: string }[] {
  const out: { text: string; tone: string }[] = []
  if (i.usage !== 0)
    out.push({
      text: i.usage > 0 ? `USG ${'+'.repeat(i.usage)}` : `USG ${'−'.repeat(-i.usage)}`,
      tone: 'quiet',
    })
  if (i.threes > 0) out.push({ text: `3PT ${'+'.repeat(i.threes)}`, tone: 'arc' })
  if (i.threes < 0) out.push({ text: `3PT ${'−'.repeat(-i.threes)}`, tone: 'quiet' })
  if (i.post > 0) out.push({ text: 'POST', tone: 'block' })
  if (i.post < 0) out.push({ text: 'NO POST', tone: 'quiet' })
  if (i.crash > 0) out.push({ text: 'CRASH', tone: 'glass' })
  if (i.crash < 0) out.push({ text: 'GET BACK', tone: 'quiet' })
  if (i.effort > 0) out.push({ text: 'LOCK UP', tone: 'lock' })
  if (i.effort < 0) out.push({ text: 'EASE OFF', tone: 'quiet' })
  return out
}

const CAT_LABELS: Record<keyof RatingCard['categories'], string> = {
  inside: 'Inside',
  outside: 'Outside',
  playmaking: 'Playmaking',
  perimeterDefence: 'Perim D',
  interiorDefence: 'Rim D',
  rebounding: 'Boards',
  athleticism: 'Athleticism',
  basketballIq: 'IQ',
}

function standouts(card: RatingCard): { label: string; value: number }[] {
  return (Object.keys(card.categories) as (keyof RatingCard['categories'])[])
    .map((k) => ({ label: CAT_LABELS[k], value: card.categories[k] }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6)
}

function rateTone(v: number): string {
  return v >= 70 ? 'win' : v <= 38 ? 'loss' : ''
}

const SHOOTING: { key: keyof Ratings; label: string }[] = [
  { key: 'rim', label: 'Rim' },
  { key: 'close', label: 'Close' },
  { key: 'mid', label: 'Mid' },
  { key: 'three', label: '3PT' },
  { key: 'ft', label: 'FT' },
]

/**
 * The number on the row the manager is deciding. Same ratings `instructedTendencies` /
 * `instructedRatings` read; `buildTeamInput` puts the result on GameInput (see
 * packages/game/src/playbook.test.ts — "an instruction reaches the input").
 */
function leverHints(
  key: Lever,
  r: Ratings,
  t: Tendencies,
): { k: string; v: string; tone: string }[] {
  const n = (x: number): { v: string; tone: string } => ({
    v: String(Math.round(x)),
    tone: rateTone(x),
  })
  switch (key) {
    case 'usage':
      return [
        { k: 'USG', v: `${Math.round(t.usage * 100)}%`, tone: '' },
        { k: 'Pass', ...n(r.passing) },
      ]
    case 'threes':
      return [{ k: '3PT', ...n(r.three) }]
    case 'post':
      return [
        { k: 'Rim', ...n(r.rim) },
        { k: 'Close', ...n(r.close) },
      ]
    case 'crash':
      return [
        { k: 'OReb', ...n(r.oreb) },
        { k: 'DReb', ...n(r.dreb) },
      ]
    case 'effort':
      return [
        { k: 'Perim', ...n(r.perimD) },
        { k: 'Int', ...n(r.interiorD) },
        { k: 'Stl', ...n(r.steal) },
      ]
  }
}

function instructionLabel(i: PlayerInstruction): string {
  const m = matchingPreset(i)
  if (!m || m === 'own') return chipsFor(i).length ? 'custom' : 'plays his own game'
  return INSTRUCTION_PRESETS[m].name
}

function rolePresets(p: RolePlayer, current: PlayerInstruction): InstructionPreset[] {
  const suggested = suggestPresets(p, 4)
  const match = matchingPreset(current)
  if (match && match !== 'own' && !suggested.some((s) => s.id === match)) {
    return [INSTRUCTION_PRESETS[match], ...suggested.slice(0, 3)]
  }
  return suggested
}

function minuteChoices(current: number, ceiling: number): number[] {
  const cur = Math.max(0, Math.round(current))
  const set = new Set<number>(MINUTE_STEPS.filter((m) => m <= ceiling || m === cur))
  set.add(cur)
  return [...set].sort((a, b) => a - b)
}

function MinutesSelect({
  name,
  value,
  ceiling,
  disabled,
  onChange,
}: {
  name: string
  value: number
  ceiling: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const cur = Math.max(0, Math.round(value))
  return (
    <select
      className="tc-minsel"
      value={cur}
      disabled={disabled}
      aria-label={`Minutes for ${name}`}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    >
      {minuteChoices(cur, ceiling).map((m) => (
        <option key={m} value={m} disabled={m > ceiling && m !== cur}>
          {m}
        </option>
      ))}
    </select>
  )
}

function Segmented({
  value,
  onChange,
  values,
  labels,
  name,
}: {
  value: number
  onChange: (v: number) => void
  values: number[]
  labels: string[]
  name: string
}) {
  return (
    <fieldset className="segmented" aria-label={name}>
      {values.map((v, i) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className="ghost"
          title={labels[i]}
        >
          {labels[i]}
        </button>
      ))}
    </fieldset>
  )
}

const ZONES = ['rim', 'close', 'mid', 'three'] as const

/** His shot mix, as a bar. Four zones, warm inside and cool outside. */
function ShotMix({ t }: { t: Tendencies }) {
  const z: number[] = [t.shotRim, t.shotClose, t.shotMid, t.shotThree]
  const pct = (i: number) => Math.round(Math.max(0, z[i] ?? 0) * 100)
  return (
    <span
      className="tc-mix"
      title={`rim ${pct(0)}% · close ${pct(1)}% · mid ${pct(2)}% · three ${pct(3)}%`}
    >
      {ZONES.map((zone, i) => (
        <i key={zone} className={`z${i}`} style={{ width: `${pct(i)}%` }} />
      ))}
    </span>
  )
}

/**
 * Compact overlay on a click — identity, standouts, a shooting strip, minutes, named roles.
 * Pattern: Aboard "Edit skills" / TheyDo persona sliders — the deciding number sits on the row.
 */
function PlayerPop({
  row,
  minutes,
  ceiling,
  benched,
  instruction,
  planned,
  onMinutes,
  onLever,
  onPreset,
  onClose,
}: {
  row: RosterRow
  minutes: number
  ceiling: number
  benched: boolean
  instruction: PlayerInstruction
  planned: { tendencies: Tendencies; ratings: Ratings }
  onMinutes: (v: number) => void
  onLever: (k: Lever, v: number) => void
  onPreset: (p: InstructionPreset) => void
  onClose: () => void
}) {
  const p = row.player
  const match = matchingPreset(instruction)
  const role: RolePlayer = {
    playerId: p.playerId,
    name: p.name,
    pos: p.pos,
    ratings: p.ratings,
    tendencies: p.tendencies,
  }
  const presets = rolePresets(role, instruction)
  return (
    <Modal
      narrow
      title={
        <span>
          {p.name}{' '}
          <span className="dim">
            · {p.pos} · {p.age} · {height(p.heightIn)}, {p.weightLb} lb
          </span>
        </span>
      }
      onClose={onClose}
    >
      <div className="tc-pop">
        <div className="facts">
          <span>
            <b>{row.card.overall}</b> ovr
          </span>
          <span>{instructionLabel(instruction)}</span>
          <span className="mins">
            min
            <MinutesSelect
              name={p.name}
              value={minutes}
              ceiling={ceiling}
              disabled={benched}
              onChange={onMinutes}
            />
          </span>
        </div>
        <p className="good">{row.card.strengths.join(' · ')}</p>
        <div className="ratings">
          {standouts(row.card).map((s) => (
            <RatingBar key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
        <div className="tc-shoot" aria-label="Shooting ratings">
          <span className="lbl">Shooting</span>
          {SHOOTING.map(({ key, label }) => (
            <span key={key}>
              {label} <b className={rateTone(p.ratings[key])}>{Math.round(p.ratings[key])}</b>
            </span>
          ))}
        </div>
        <div className="roles">
          <button
            type="button"
            className="tc-preset"
            aria-pressed={match === 'own' || isNeutralInstruction(instruction)}
            onClick={() => onPreset(INSTRUCTION_PRESETS.own)}
          >
            Play his own game
          </button>
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="tc-preset"
              aria-pressed={match === preset.id}
              title={preset.blurb}
              onClick={() => onPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <div className="tc-editor">
          {LEVERS.map((l) => (
            <div className="lever" key={l.key}>
              <div>
                <strong>{l.label}</strong>
                <span className="now">
                  <span className="tc-hints">
                    {leverHints(l.key, p.ratings, p.tendencies).map((h) => (
                      <span key={h.k}>
                        {h.k} <b className={h.tone}>{h.v}</b>
                      </span>
                    ))}
                  </span>
                  {l.labels[l.values.indexOf(instruction[l.key])] ?? 'Normal'}
                </span>
              </div>
              <Segmented
                name={`${l.label} for ${p.name}`}
                values={l.values}
                labels={l.labels}
                value={instruction[l.key]}
                onChange={(v) => onLever(l.key, v)}
              />
            </div>
          ))}
          <div className="lever diet">
            <div>
              <strong>Shot mix under this plan</strong>
              <span className="now">rim · close · mid · three</span>
            </div>
            <div className="line">
              <span style={{ width: 72 }}>Own game</span>
              <ShotMix t={p.tendencies} />
            </div>
            <div className="line">
              <span style={{ width: 72 }}>Instructed</span>
              <ShotMix t={planned.tendencies} />
              <span>
                <b>{Math.round(planned.tendencies.shotThree * 100)}%</b> from three
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function Tactics() {
  const { client, snapshot, teamById, game } = useStore()
  const me = snapshot?.state.userTeamId ?? ''

  const [rows, setRows] = useState<RosterRow[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [minutes, setMinutes] = useState<Record<string, number>>({})
  const [inactive, setInactive] = useState<string[]>([])
  const [lineup, setLineup] = useState<Partial<Record<Position, string>>>({})
  const [lineups, setLineups] = useState<NamedLineups>({})
  const [system, setSystem] = useState<OffenseSystemId>('balanced')
  const [instructions, setInstructions] = useState<Record<string, PlayerInstruction>>({})
  const [tactics, setTactics] = useState<TacticsSettings>(DEFAULT_TACTICS)
  const [zoneLegal, setZoneLegal] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<string>('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [openMan, setOpenMan] = useState<string | null>(null)
  const [clamped, setClamped] = useState<string>('')

  /** Load the roster and whatever plan the sim already holds, seeding anything it leaves blank. */
  const load = useCallback(async () => {
    if (!me) return
    const [roster, got] = await Promise.all([client.roster(me), client.plan(me)])
    setRows(roster)
    setZoneLegal(got.zoneLegal)
    const byAbility = [...roster].sort((a, b) => overallOf(b) - overallOf(a))
    const ranked = got.plan.depth.length
      ? [
          ...got.plan.depth.filter((id) => roster.some((r) => r.player.playerId === id)),
          ...byAbility.map((r) => r.player.playerId).filter((id) => !got.plan.depth.includes(id)),
        ]
      : byAbility.map((r) => r.player.playerId)
    setOrder(ranked)
    setInactive(got.plan.inactive.filter((id) => ranked.includes(id)))
    const seeded: Record<string, number> = {}
    const active = ranked.filter((id) => !got.plan.inactive.includes(id))
    for (const id of ranked) {
      const explicit = got.plan.minutes[id]
      if (explicit != null) seeded[id] = explicit
      else {
        const slot = active.indexOf(id)
        seeded[id] = slot < 0 ? 0 : (LADDER[slot] ?? 0)
      }
    }
    setMinutes(seeded)
    setTactics(got.plan.tactics)
    setSystem(got.plan.system ?? 'balanced')
    setInstructions(got.plan.instructions ?? {})
    // Only keep lineup entries for men who are still on the roster — a trade can strand one.
    const l: Partial<Record<Position, string>> = {}
    for (const pos of POSITIONS) {
      const id = got.plan.lineup?.[pos]
      if (id && roster.some((r) => r.player.playerId === id)) l[pos] = id
    }
    setLineup(l)
    const units: NamedLineups = {}
    for (const unit of LINEUP_UNIT_IDS) {
      const slots = got.plan.lineups?.[unit]
      if (!slots) continue
      const cleaned: Partial<Record<Position, string>> = {}
      for (const pos of POSITIONS) {
        const id = slots[pos]
        if (id && roster.some((r) => r.player.playerId === id)) cleaned[pos] = id
      }
      if (POSITIONS.some((p) => cleaned[p])) units[unit] = cleaned
    }
    setLineups(units)
  }, [client, me])

  useEffect(() => {
    void load().catch(() => undefined)
  }, [load])

  /** Every edit goes to the sim immediately — the next game played reads it. */
  const push = useCallback(
    async (next: Partial<TeamPlan>) => {
      if (!me) return
      await client.setPlan(me, next)
      setSaved(new Date().toLocaleTimeString())
    },
    [client, me],
  )

  const byId = useMemo(() => new Map(rows.map((r) => [r.player.playerId, r])), [rows])
  const benched = useMemo(() => new Set(inactive), [inactive])
  const namedIds = useMemo(
    () => POSITIONS.map((p) => lineup[p]).filter((x): x is string => !!x),
    [lineup],
  )
  /** The rotation, in the order the coach will read it: the named five, then the depth order. */
  const active = useMemo(() => {
    const rest = order.filter((id) => !benched.has(id) && !namedIds.includes(id))
    return [...namedIds.filter((id) => !benched.has(id)), ...rest]
  }, [order, benched, namedIds])
  /** Everyone who is not starting. With no lineup named, the top five of the rotation start. */
  const bench = useMemo(() => active.slice(5), [active])

  const total = active.reduce((s, id) => s + (minutes[id] ?? 0), 0)
  const left = TEAM_MINUTES - total
  const heavy = active.filter((id) => (minutes[id] ?? 0) > HEAVY)
  const withMinutes = active.filter((id) => (minutes[id] ?? 0) > 0).length

  const instructionOf = useCallback(
    (id: string): PlayerInstruction => instructions[id] ?? NEUTRAL_INSTRUCTION,
    [instructions],
  )

  // ── the playbook, computed exactly as packages/game does it ────────────────
  // These are the same pure functions the sim runs, so what the screen shows is what will happen.
  const rolePlayers = useMemo<RolePlayer[]>(
    () =>
      active
        .map((id) => byId.get(id))
        .filter((r): r is RosterRow => !!r)
        .map((r) => ({
          playerId: r.player.playerId,
          name: r.player.name,
          pos: r.player.pos,
          ratings: r.player.ratings,
          tendencies: r.player.tendencies,
        })),
    [active, byId],
  )
  const roles = useMemo(
    () => (system === 'balanced' ? { hubId: null, handlerId: null } : assignRoles(rolePlayers)),
    [system, rolePlayers],
  )
  const fits = useMemo(() => {
    const ranked = rankSystems(rolePlayers)
    return new Map(ranked.map((f) => [f.id, f]))
  }, [rolePlayers])
  const chosenFit = fits.get(system) ?? systemFit(system, rolePlayers)

  const slotOfId = useCallback(
    (id: string): Position | null => POSITIONS.find((p) => lineup[p] === id) ?? null,
    [lineup],
  )

  /** What a man's tendencies and ratings actually become under the plan as it stands. */
  const effective = useCallback(
    (r: RosterRow): { tendencies: Tendencies; ratings: Ratings } => {
      const id = r.player.playerId
      const slot = slotOfId(id)
      let ratings = slot ? outOfPosition(r.player.ratings, r.player.pos, slot) : r.player.ratings
      let tendencies =
        system === 'balanced'
          ? r.player.tendencies
          : systemTendencies(system, r.player.tendencies, roleOf(id, roles))
      const i = instructions[id]
      if (i) {
        tendencies = instructedTendencies(tendencies, i)
        ratings = instructedRatings(ratings, i)
      }
      return { tendencies, ratings }
    },
    [slotOfId, system, roles, instructions],
  )

  const commit = useCallback(
    (next: Partial<TeamPlan>) => {
      if (next.depth) setOrder(next.depth)
      if (next.minutes) setMinutes(next.minutes)
      if (next.inactive) setInactive(next.inactive)
      if (next.lineup) setLineup(next.lineup)
      if (next.lineups) setLineups(next.lineups)
      if (next.instructions) setInstructions(next.instructions)
      void push(next).catch(() => undefined)
    },
    [push],
  )

  const move = useCallback(
    (id: string, delta: number) => {
      const from = order.indexOf(id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= order.length) return
      const next = [...order]
      next.splice(from, 1)
      next.splice(to, 0, id)
      commit({ depth: next })
    },
    [order, commit],
  )

  const dropOn = useCallback(
    (targetId: string) => {
      if (!dragging || dragging === targetId) return
      const next = order.filter((x) => x !== dragging)
      next.splice(order.indexOf(targetId), 0, dragging)
      setDragging(null)
      commit({ depth: next })
    },
    [dragging, order, commit],
  )

  /**
   * The budget, enforced. A stepper may raise a man only as far as the minutes that are actually
   * free, and it says so when it trims him rather than accepting a plan that adds up to 279.
   */
  const setMin = useCallback(
    (id: string, raw: number) => {
      const now = minutes[id] ?? 0
      const asked = Math.max(0, Math.min(48, Number.isFinite(raw) ? raw : 0))
      const ceiling = Math.min(48, now + Math.max(0, left))
      const given = Math.min(asked, ceiling)
      if (given < asked) {
        const name = byId.get(id)?.player.name ?? 'He'
        setClamped(
          `${name} was set to ${n1(given)}, not ${n1(asked)} — the team had ${n1(
            Math.max(0, left),
          )} minutes left. Take them off somebody else first.`,
        )
      } else {
        setClamped('')
      }
      commit({ minutes: { ...minutes, [id]: given } })
    },
    [minutes, left, byId, commit],
  )

  /**
   * Scale the plan he set into the budget without changing its shape.
   *
   * Scaling and the 48-minute ceiling fight each other — five men cannot absorb 240 minutes at
   * their current ratio — so it is a short fixed-point loop, the same one `fitTo240` runs in the
   * sim: whatever a capped man cannot use is handed back to everybody else.
   */
  const balance = useCallback(() => {
    if (active.length === 0) return
    let want = active.map((id) => Math.max(0, minutes[id] ?? 0))
    if (want.every((m) => m === 0)) want = active.map((_, i) => LADDER[i] ?? 0)
    for (let pass = 0; pass < 8; pass++) {
      const sum = want.reduce((a, b) => a + b, 0) || 1
      want = want.map((m) => (m * TEAM_MINUTES) / sum)
      if (!want.some((m) => m > 48 + 1e-9)) break
      const free = want.filter((m) => m <= 48).reduce((a, b) => a + b, 0)
      const spare = TEAM_MINUTES - want.filter((m) => m > 48).length * 48
      want = want.map((m) => (m > 48 ? 48 : free > 0 ? (m * spare) / free : m))
    }
    // Whole minutes, with the rounding drift settled on the men who can still take it.
    const next = { ...minutes }
    active.forEach((id, i) => {
      next[id] = Math.round(want[i] ?? 0)
    })
    let drift = TEAM_MINUTES - active.reduce((s, id) => s + (next[id] ?? 0), 0)
    const bySize = [...active].sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0))
    const order2 = drift > 0 ? bySize : [...bySize].reverse()
    for (let pass = 0; pass < 3 && drift !== 0; pass++) {
      for (const id of order2) {
        if (drift === 0) break
        const step = drift > 0 ? 1 : -1
        const v = (next[id] ?? 0) + step
        if (v < 0 || v > 48) continue
        next[id] = v
        drift -= step
      }
    }
    setClamped('')
    commit({ minutes: next })
  }, [active, minutes, commit])

  const toggleBench = useCallback(
    (id: string) => {
      const next = benched.has(id) ? inactive.filter((x) => x !== id) : [...inactive, id]
      // A benched man cannot hold a starting slot.
      const l = { ...lineup }
      if (!benched.has(id)) for (const p of POSITIONS) if (l[p] === id) delete l[p]
      // Either way he comes back on zero: benching frees his minutes, and activating hands them
      // back to the budget for you to spend rather than silently pushing the team over 240.
      commit({ inactive: next, lineup: l, minutes: { ...minutes, [id]: 0 } })
    },
    [benched, inactive, lineup, minutes, commit],
  )

  /**
   * The obvious lineup, in one click: each slot goes to the best available man who actually plays
   * it, and only when nobody is left does a slot take somebody out of position. Without this the
   * five slots start empty and the whole feature is twenty-five clicks away.
   */
  const fillByPosition = useCallback(() => {
    const pool = active
      .map((id) => byId.get(id))
      .filter((r): r is RosterRow => !!r)
      .sort((a, b) => overallOf(b) - overallOf(a))
    const taken = new Set<string>()
    const next = pickFive(pool, taken)
    commit({ lineup: next, inactive: inactive.filter((x) => !taken.has(x)) })
  }, [active, byId, inactive, commit])

  /**
   * One click for a real rotation: starters, bench, closing, and an 8–9 man minutes split.
   * Veterans (34+) are capped at 24 unless you change it after — sitting them is how they stay
   * healthy. The engine already injures less when the minutes are lower; this is the plan that
   * makes that true.
   */
  const autoAdjust = useCallback(() => {
    const pool = order
      .filter((id) => !benched.has(id))
      .map((id) => byId.get(id))
      .filter((r): r is RosterRow => !!r)
      .sort((a, b) => overallOf(b) - overallOf(a))
    const taken = new Set<string>()
    const starters = pickFive(pool, taken)
    const benchUnit = pickFive(pool, taken)
    const closing = { ...starters }
    const units: NamedLineups = { starters, bench: benchUnit, closing }
    const rotation: string[] = []
    for (const slots of [starters, benchUnit]) {
      for (const pos of POSITIONS) {
        const id = slots[pos]
        if (id && !rotation.includes(id)) rotation.push(id)
      }
    }
    const playoffs = game?.phase === 'playoffs' || game?.phase === 'playin'
    const ladder = playoffs ? AUTO_PO : AUTO_RS
    const depth = ladder.length
    while (rotation.length < depth) {
      const extra = pool.find((r) => !rotation.includes(r.player.playerId))
      if (!extra) break
      rotation.push(extra.player.playerId)
    }
    const used = rotation.slice(0, depth)
    const nextMin: Record<string, number> = { ...minutes }
    for (const id of order) nextMin[id] = 0
    const caps = used.map((id) => {
      const age = byId.get(id)?.player.age ?? 0
      return age >= 34 ? 24 : 40
    })
    let want = used.map((_, i) => ladder[i] ?? 0)
    for (let pass = 0; pass < 8; pass++) {
      want = want.map((m, i) => Math.min(caps[i] ?? 40, m))
      const sum = want.reduce((a, b) => a + b, 0) || 1
      if (Math.abs(sum - TEAM_MINUTES) < 0.5) break
      const room = used.map((_, i) => (caps[i] ?? 40) - (want[i] ?? 0))
      const free = room.reduce((a, b) => a + Math.max(0, b), 0)
      const need = TEAM_MINUTES - want.reduce((a, b) => a + b, 0)
      if (free <= 0 || need === 0) break
      want = want.map((m, i) => m + (Math.max(0, room[i] ?? 0) / free) * need)
    }
    used.forEach((id, i) => {
      nextMin[id] = Math.round(want[i] ?? 0)
    })
    let drift = TEAM_MINUTES - used.reduce((s, id) => s + (nextMin[id] ?? 0), 0)
    const order2 = [...used].sort((a, b) => (nextMin[b] ?? 0) - (nextMin[a] ?? 0))
    for (let pass = 0; pass < 4 && drift !== 0; pass++) {
      for (const id of drift > 0 ? order2 : [...order2].reverse()) {
        if (drift === 0) break
        const i = used.indexOf(id)
        const step = drift > 0 ? 1 : -1
        const v = (nextMin[id] ?? 0) + step
        if (v < 0 || v > (caps[i] ?? 40)) continue
        nextMin[id] = v
        drift -= step
      }
    }
    const depthOrder = [...used, ...order.filter((id) => !used.includes(id))]
    commit({
      depth: depthOrder,
      lineup: starters,
      lineups: units,
      minutes: nextMin,
      inactive: order.filter((id) => !used.includes(id)),
    })
  }, [order, benched, byId, minutes, game, commit])

  /** Fill a slot. If he is already in another slot the two men swap, which is what you meant. */
  const setSlot = useCallback(
    (pos: Position, id: string) => {
      const next: Partial<Record<Position, string>> = { ...lineup }
      if (!id) delete next[pos]
      else {
        const heldBy = POSITIONS.find((p) => p !== pos && next[p] === id)
        const displaced = next[pos]
        next[pos] = id
        if (heldBy) {
          if (displaced) next[heldBy] = displaced
          else delete next[heldBy]
        }
      }
      // Naming a man your starter un-benches him.
      const stillOut = inactive.filter((x) => !Object.values(next).includes(x))
      commit({ lineup: next, inactive: stillOut })
    },
    [lineup, inactive, commit],
  )

  const setUnitSlot = useCallback(
    (unit: LineupUnitId, pos: Position, id: string) => {
      const slots: Partial<Record<Position, string>> = { ...(lineups[unit] ?? {}) }
      if (!id) delete slots[pos]
      else {
        const heldBy = POSITIONS.find((p) => p !== pos && slots[p] === id)
        const displaced = slots[pos]
        slots[pos] = id
        if (heldBy) {
          if (displaced) slots[heldBy] = displaced
          else delete slots[heldBy]
        }
      }
      const next: NamedLineups = { ...lineups, [unit]: slots }
      const stillOut = inactive.filter((x) => !Object.values(slots).includes(x))
      if (unit === 'starters') commit({ lineups: next, lineup: slots, inactive: stillOut })
      else commit({ lineups: next, inactive: stillOut })
    },
    [lineups, inactive, commit],
  )

  const setInstruction = useCallback(
    (id: string, lever: Lever, v: number) => {
      const nextOne = normaliseInstruction({ ...instructionOf(id), [lever]: v })
      commit({ instructions: { ...instructions, [id]: nextOne } })
    },
    [instructions, instructionOf, commit],
  )

  const applyInstruction = useCallback(
    (id: string, i: PlayerInstruction) => {
      commit({ instructions: { ...instructions, [id]: normaliseInstruction(i) } })
    },
    [instructions, commit],
  )

  const setTactic = useCallback(
    (next: TacticsSettings) => {
      setTactics(next)
      void push({ tactics: next }).catch(() => undefined)
    },
    [push],
  )

  const setSystemId = useCallback(
    (id: OffenseSystemId) => {
      setSystem(id)
      void push({ system: id }).catch(() => undefined)
    },
    [push],
  )

  const reset = useCallback(async () => {
    await client.setPlan(me, {
      tactics: DEFAULT_TACTICS,
      depth: [],
      minutes: {},
      inactive: [],
      lineup: {},
      lineups: {},
      system: 'balanced',
      instructions: {},
    })
    setClamped('')
    setOpenMan(null)
    setSaved(new Date().toLocaleTimeString())
    await load()
  }, [client, me, load])

  /** Everybody who could fill a slot: the whole roster, so you can start whoever you like. */
  const selectable = useMemo(() => [...rows].sort((a, b) => overallOf(b) - overallOf(a)), [rows])

  const misfits = useMemo(
    () =>
      POSITIONS.map((pos) => {
        const id = lineup[pos]
        const r = id ? byId.get(id) : undefined
        if (!r) return null
        const gap = positionGap(r.player.pos, pos)
        return gap === 0 ? null : { pos, r, gap }
      }).filter((x): x is { pos: Position; r: RosterRow; gap: number } => !!x),
    [lineup, byId],
  )

  const openRow = openMan ? (byId.get(openMan) ?? null) : null

  if (!snapshot) return null
  const team = teamById.get(me)
  const emptySlots = POSITIONS.filter((p) => !lineup[p])

  const budgetClass = left < 0 ? 'over' : left === 0 ? 'done' : ''

  return (
    <div className="cols sidebar">
      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <div className="pagehead">
          <h1>{team ? `${team.city} ${team.name} — tactics` : 'Tactics'}</h1>
          <span style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={autoAdjust} disabled={rows.length === 0}>
            Auto-adjust lineups
          </button>
          <button type="button" className="ghost" onClick={balance} disabled={active.length === 0}>
            Balance to 240
          </button>
          <button type="button" className="ghost" onClick={() => void reset()}>
            Reset to automatic
          </button>
        </div>

        <div className={`tc-budget ${budgetClass}`}>
          <span className="big">{n1(Math.abs(left))}</span>
          <span className="what">
            {left > 0
              ? 'minutes left to assign'
              : left < 0
                ? 'minutes over the budget — nobody can be raised until you free some up'
                : 'the forty-eight minutes are all spoken for'}
          </span>
          <span style={{ flex: 1 }} />
          <span className="of">
            {n1(total)} / {TEAM_MINUTES} · {withMinutes} men
          </span>
        </div>

        {clamped ? (
          <p className="faint" style={{ fontSize: 11, margin: 0 }}>
            {clamped}
          </p>
        ) : null}

        {withMinutes < THIN_ROTATION || heavy.length > 0 || left < 0 ? (
          <div className="banner">
            <span className="warn">
              {left < 0
                ? `Over the budget by ${n1(-left)} minutes. Use “Balance to 240” to scale your plan into it. `
                : ''}
              {withMinutes < THIN_ROTATION
                ? `Thin bench: only ${withMinutes} men have minutes. Eight or nine is normal, and the coach will fill the gaps himself when somebody fouls out or goes down. `
                : ''}
              {heavy.length
                ? `Heavy load: ${heavy
                    .map((id) => byId.get(id)?.player.name ?? id)
                    .join(', ')} over ${HEAVY} minutes a night, and you will get the injury bill.`
                : ''}
            </span>
          </div>
        ) : null}

        <Panel
          title="Starting five"
          actions={
            <button type="button" className="ghost tiny" onClick={fillByPosition}>
              Fill by position
            </button>
          }
        >
          <div className="tc-five">
            {POSITIONS.map((pos) => {
              const id = lineup[pos]
              const r = id ? byId.get(id) : undefined
              const gap = r ? positionGap(r.player.pos, pos) : 0
              const bad = Math.abs(gap) >= 2
              const mins = id ? (minutes[id] ?? 0) : 0
              return (
                <div
                  key={pos}
                  className={`tc-slot${r ? '' : ' empty'}${gap !== 0 ? ' misfit' : ''}${bad ? ' bad' : ''}`}
                >
                  <div className="pos">{pos}</div>
                  <select
                    value={id ?? ''}
                    aria-label={`${pos} starter`}
                    onChange={(e) => setSlot(pos, e.currentTarget.value)}
                  >
                    <option value="">— nobody —</option>
                    {selectable.map((row) => (
                      <option key={row.player.playerId} value={row.player.playerId}>
                        {row.player.name} ({row.player.pos} {row.card.overall} ·{' '}
                        {height(row.player.heightIn)})
                      </option>
                    ))}
                  </select>
                  {r ? (
                    <>
                      <div className="who">
                        <button
                          type="button"
                          className="tc-name"
                          onClick={() => setOpenMan(r.player.playerId)}
                        >
                          <b>{r.player.name}</b>
                        </button>
                        <span className="ht">{height(r.player.heightIn)}</span>
                        <span className="ovr">{r.card.overall}</span>
                      </div>
                      <div className="good">{r.card.strengths.join(' · ')}</div>
                      <div className={`note${bad ? ' bad' : gap === 0 ? ' fine' : ''}`}>
                        {gap === 0 ? `A natural ${pos}. No cost.` : positionNote(r.player.pos, pos)}
                      </div>
                      <span className="mins">
                        min
                        <MinutesSelect
                          name={r.player.name}
                          value={mins}
                          ceiling={Math.min(48, mins + Math.max(0, left))}
                          onChange={(v) => setMin(r.player.playerId, v)}
                        />
                      </span>
                    </>
                  ) : (
                    // Unnamed slots are not a bug in this file. rotation.ts starts the named men
                    // (PG→C, blanks skipped) and fills the rest from the depth chart — nobody is
                    // assigned to the empty slot, so Fill by position is how you name all five.
                    <div className="note fine">
                      Nobody named. The best man left on the depth chart will start here.
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {misfits.length > 0 ? (
            <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              {misfits.length === 1 ? 'One man is' : `${misfits.length} men are`} out of position.
              That is not cosmetic: he loses the ratings the slot needs — a guard at centre stops
              rebounding and stops protecting the rim, and you will see it in the box score.
            </p>
          ) : emptySlots.length === POSITIONS.length ? (
            <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              No lineup named, so the top five of the rotation start and nobody is out of position —
              exactly what the coach does when you leave him to it. “Fill by position” puts the best
              man you have into each slot, and you can move anybody after that.
            </p>
          ) : null}
        </Panel>

        <Panel title="Lineups">
          <p className="faint" style={{ fontSize: 11, marginTop: 0, marginBottom: 8 }}>
            Three five-man units. Starters open, the bench unit takes the middle of the quarter, the
            closing five finishes a tight fourth. Leave them empty and minutes stay a share.
          </p>
          <div className="tc-units">
            {LINEUP_UNIT_IDS.map((unit) => (
              <div key={unit} className="tc-unit">
                <div className="tc-unit-name">{UNIT_LABEL[unit]}</div>
                <div className="tc-five">
                  {POSITIONS.map((pos) => {
                    const id = lineups[unit]?.[pos]
                    return (
                      <div key={pos} className={`tc-slot${id ? '' : ' empty'}`}>
                        <div className="pos">{pos}</div>
                        <select
                          value={id ?? ''}
                          aria-label={`${UNIT_LABEL[unit]} ${pos}`}
                          onChange={(e) => setUnitSlot(unit, pos, e.currentTarget.value)}
                        >
                          <option value="">—</option>
                          {selectable.map((row) => (
                            <option key={row.player.playerId} value={row.player.playerId}>
                              {row.player.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel flush title={`Rotation — ${bench.length} off the bench`}>
          <table className="grid tc-rota">
            <thead>
              <tr>
                <th>#</th>
                <th className="text">Player</th>
                <th className="text">Pos</th>
                <th>Ht</th>
                <th>Age</th>
                <th>Ovr</th>
                <th>MPG now</th>
                <th>Minutes</th>
                <th className="text">Shot mix</th>
                <th className="text">Instructions</th>
                <th className="text">Order</th>
                <th className="text">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...active, ...order.filter((id) => benched.has(id))].map((id) => {
                const r = byId.get(id)
                if (!r) return null
                const out = benched.has(id)
                const mins = minutes[id] ?? 0
                const slot = active.indexOf(id)
                const named = slotOfId(id)
                const i = instructionOf(id)
                const chips = chipsFor(i)
                const open = openMan === id
                const orderIdx = order.indexOf(id)
                const role = roleOf(id, roles)
                return (
                  <tr
                    key={id}
                    className={`${out ? 'sep' : named ? 'me' : ''}${open ? ' tc-open' : ''}`}
                    draggable
                    onDragStart={() => setDragging(id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(id)}
                  >
                    <td className="num faint">{out ? '—' : slot + 1}</td>
                    <td className="text">
                      <button type="button" className="tc-name" onClick={() => setOpenMan(id)}>
                        {r.player.name}
                      </button>
                      {role !== 'other' ? (
                        <span className="faint" style={{ fontSize: 10, marginLeft: 5 }}>
                          {role === 'hub' ? 'HUB' : 'BALL'}
                        </span>
                      ) : null}
                      {r.card.strengths.length ? (
                        <div className="good">{r.card.strengths.join(' · ')}</div>
                      ) : null}
                    </td>
                    <td className="text dim">
                      {named && named !== r.player.pos ? (
                        <span className="warn">{`${r.player.pos}→${named}`}</span>
                      ) : (
                        (named ?? r.player.pos)
                      )}
                    </td>
                    <td className="num dim">{height(r.player.heightIn)}</td>
                    <td className="num dim">{r.player.age}</td>
                    <td className="num">{r.card.overall}</td>
                    <td className="num dim">
                      {r.totals.gp ? n1(r.totals.min / r.totals.gp) : '—'}
                    </td>
                    <td className="num">
                      <MinutesSelect
                        name={r.player.name}
                        value={out ? 0 : mins}
                        ceiling={Math.min(48, mins + Math.max(0, left))}
                        disabled={out}
                        onChange={(v) => setMin(id, v)}
                      />
                    </td>
                    <td className="text">
                      <ShotMix t={effective(r).tendencies} />
                    </td>
                    <td className="text">
                      <button
                        type="button"
                        className="ghost tiny"
                        aria-expanded={open}
                        onClick={() => setOpenMan(open ? null : id)}
                      >
                        {open ? 'Done' : chips.length ? 'Edit' : 'Set'}
                      </button>
                      <span className="tc-chips" style={{ marginLeft: 5 }}>
                        {chips.length === 0 ? (
                          <span className="faint" style={{ fontSize: 10.5 }}>
                            plays his own game
                          </span>
                        ) : matchingPreset(i) ? (
                          <span className={`tc-chip ${chips[0]?.tone ?? ''}`}>
                            {instructionLabel(i)}
                          </span>
                        ) : (
                          chips.map((c) => (
                            <span key={c.text} className={`tc-chip ${c.tone}`}>
                              {c.text}
                            </span>
                          ))
                        )}
                      </span>
                    </td>
                    <td className="text">
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={orderIdx <= 0}
                        title="Move up"
                        onClick={() => move(id, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="ghost tiny"
                        disabled={orderIdx < 0 || orderIdx === order.length - 1}
                        title="Move down"
                        onClick={() => move(id, 1)}
                      >
                        ▼
                      </button>
                    </td>
                    <td className="text">
                      <button type="button" className="ghost tiny" onClick={() => toggleBench(id)}>
                        {out ? 'Activate' : 'Bench'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {order.length === 0 ? (
                <tr>
                  <td className="text dim" colSpan={12}>
                    No players.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </Panel>

        {/* The editor used to live under the table, below the fold, so "Set" looked broken. */}
        {openRow ? (
          <PlayerPop
            row={openRow}
            minutes={
              benched.has(openRow.player.playerId) ? 0 : (minutes[openRow.player.playerId] ?? 0)
            }
            ceiling={Math.min(48, (minutes[openRow.player.playerId] ?? 0) + Math.max(0, left))}
            benched={benched.has(openRow.player.playerId)}
            instruction={instructionOf(openRow.player.playerId)}
            planned={effective(openRow)}
            onMinutes={(v) => setMin(openRow.player.playerId, v)}
            onLever={(k, v) => setInstruction(openRow.player.playerId, k, v)}
            onPreset={(preset) =>
              applyInstruction(openRow.player.playerId, { ...preset.instruction })
            }
            onClose={() => setOpenMan(null)}
          />
        ) : null}

        <p className="faint" style={{ fontSize: 11 }}>
          Drag a row, or use ▲ ▼, to reorder the rotation. The five named above start whatever the
          order says; anyone you do not name falls in behind by ability. Minutes cannot be pushed
          past 240 — “Balance to 240” scales the shape you set into the budget, and the coach still
          fills in for foul trouble, blowouts and injuries.{' '}
          {saved ? `Sent to the coach at ${saved}.` : ''}
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
        <Panel title="Offensive system">
          <div className="tc-systems">
            {(Object.keys(OFFENSE_SYSTEMS) as OffenseSystemId[]).map((id) => {
              const spec = OFFENSE_SYSTEMS[id]
              const fit = fits.get(id)
              const chosen = id === system
              return (
                <button
                  key={id}
                  type="button"
                  className="tc-sys"
                  aria-pressed={chosen}
                  onClick={() => setSystemId(id)}
                >
                  <span className="head">
                    <b>{spec.name}</b>
                    {fit && id !== 'balanced' ? (
                      <span className={`tc-fit ${fit.verdict}`}>
                        {fit.verdict} · {fit.score}
                      </span>
                    ) : null}
                  </span>
                  <span className="blurb">{spec.blurb}</span>
                  {chosen ? (
                    <>
                      <dl>
                        <dt>WINS</dt>
                        <dd>{spec.strength}</dd>
                        <dt>COSTS</dt>
                        <dd className="cost">{spec.cost}</dd>
                        <dt>SUITS</dt>
                        <dd>{spec.suits}</dd>
                      </dl>
                      {id !== 'balanced' ? (
                        <span className="verdict">
                          <strong>Your squad: </strong>
                          {chosenFit.lines.join(' ')}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </button>
              )
            })}
          </div>
          <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
            A system changes who shoots and from where, and nothing else. It never adds points. The
            fit score is the same shot arithmetic the engine runs, so when it says an offence does
            not suit these men, the box score will agree.
          </p>
        </Panel>

        <Panel title="Team instructions">
          <div style={{ display: 'grid', gap: 14 }}>
            {KNOBS.map((k) => (
              <div key={k.key}>
                <div className="rowline" style={{ marginBottom: 4 }}>
                  <strong>{k.label}</strong>
                </div>
                <Segmented
                  name={k.label}
                  values={[-1, 0, 1]}
                  labels={[k.low, 'Balanced', k.high]}
                  value={tactics[k.key]}
                  onChange={(v) => setTactic({ ...tactics, [k.key]: v as -1 | 0 | 1 })}
                />
                <p className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                  {k.blurb}
                </p>
              </div>
            ))}

            <div>
              <div className="rowline" style={{ marginBottom: 4 }}>
                <strong>Zone defence</strong>
              </div>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={tactics.zone}
                  disabled={zoneLegal === false}
                  onChange={(e) => setTactic({ ...tactics, zone: e.currentTarget.checked })}
                />
                Play zone
              </label>
              <p className="faint" style={{ fontSize: 11, marginTop: 4 }}>
                {zoneLegal === null
                  ? 'This build could not read the era rules, so whether zone is legal in this season is unknown — the setting may simply be ignored.'
                  : zoneLegal
                    ? 'Legal this season. A zone protects the rim and concedes the arc; it helps a slow-footed team and hurts against shooters.'
                    : 'Illegal this season — the league still enforces illegal defence, so the coach will ignore this.'}
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="What the coach does with this">
          <p className="dim" style={{ fontSize: 12 }}>
            Anything you leave alone is decided for you: an unnamed slot goes to the best man left,
            an unranked player falls in behind the ones you ranked, and anyone without a minutes
            figure gets the default for his slot. The system stacks on top of the team instructions,
            so “Push the tempo” with the pace slider already up is still one step of pace — the
            engine only understands less, normal and more. “Reset to automatic” clears the whole
            plan, lineup and instructions included.
          </p>
        </Panel>
      </div>
    </div>
  )
}
