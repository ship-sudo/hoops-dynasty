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
  NamedUnitStyles,
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
import { DRESS_MAX } from '@hoops/game'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RatingCard, RosterRow, TeamPlan } from '../sim/api.ts'
import { display } from '../sim/card.ts'
import { useStore } from '../store.tsx'
import { Modal, Panel, RatingBar } from '../ui/bits.tsx'
import { height, n1 } from '../ui/format.ts'
import { InjuryMark } from '../ui/InjuryMark.tsx'
import { cannotDress, injuryOptionTag, remainingTeamGames, trainerRows } from './tacticsHealth.ts'
import './tactics.css'

/** The automatic ladder, mirrored from packages/game/src/rotation.ts. It sums to exactly 240. */
const LADDER = [36, 34, 32, 30, 28, 22, 18, 15, 12, 8, 5]
/** Regular-season auto: nine men. Playoffs shrink. r/nba consensus is 8–9 / 7–8. */
const AUTO_RS = [34, 32, 30, 28, 26, 24, 22, 18, 16]
const AUTO_PO = [38, 36, 34, 32, 28, 24, 20, 16]

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
  starters: 'First unit',
  bench: 'Second unit',
  closing: 'Closers',
}

const UNIT_WHEN: Record<LineupUnitId, string> = {
  starters: 'Opens Q1 and Q3, sits around the first TV timeout, then closes those quarters.',
  bench: 'The five who play together off the bench. Opens Q2 and takes the middle of Q1/Q3.',
  closing: 'Last six minutes of a tight fourth. Starting is prestige; closing is trust.',
}

// The card carries the rating a person should read — a flat mean of the raw nineteen says an
// All-Star is a 55.
const overallOf = (r: RosterRow) => r.card.overall

/** Naturals and one slot over first; everybody else still in the list. */
function optionsForSlot(
  pool: RosterRow[],
  slot: Position,
): { suggested: RosterRow[]; rest: RosterRow[] } {
  const suggested: RosterRow[] = []
  const rest: RosterRow[] = []
  for (const row of pool) {
    if (Math.abs(positionGap(row.player.pos, slot)) <= 1) suggested.push(row)
    else rest.push(row)
  }
  const byOvr = (a: RosterRow, b: RosterRow) => overallOf(b) - overallOf(a)
  suggested.sort((a, b) => {
    const g = Math.abs(positionGap(a.player.pos, slot)) - Math.abs(positionGap(b.player.pos, slot))
    return g || byOvr(a, b)
  })
  rest.sort(byOvr)
  return { suggested, rest }
}

/** Best remaining body for each slot. Naturals first, then the next-closest position. */
function pickFive(pool: RosterRow[], taken: Set<string>): Partial<Record<Position, string>> {
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
  const shown = display(v)
  return shown >= 80 ? 'win' : shown <= 68 ? 'loss' : ''
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
    v: String(display(x)),
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
  const [draft, setDraft] = useState<string | null>(null)
  const bump = (d: number) => onChange(Math.max(0, Math.min(ceiling, cur + d)))
  const commit = (raw: string) => {
    const n = Number(raw)
    onChange(Number.isFinite(n) ? Math.max(0, Math.min(ceiling, Math.round(n))) : 0)
  }
  return (
    <span className="tc-minstep">
      <button
        type="button"
        className="ghost tiny"
        disabled={disabled || cur <= 0}
        aria-label={`Fewer minutes for ${name}`}
        onClick={() => bump(-1)}
      >
        −
      </button>
      <input
        className="tc-minsel"
        type="number"
        min={0}
        max={ceiling}
        step={1}
        value={draft ?? String(cur)}
        disabled={disabled}
        aria-label={`Minutes for ${name}`}
        onFocus={() => setDraft(String(cur))}
        onChange={(e) => {
          const raw = e.currentTarget.value
          setDraft(raw)
          if (raw === '') return
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(ceiling, Math.round(n))))
        }}
        onBlur={() => {
          if (draft != null) commit(draft)
          setDraft(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <button
        type="button"
        className="ghost tiny"
        disabled={disabled || cur >= ceiling}
        aria-label={`More minutes for ${name}`}
        onClick={() => bump(1)}
      >
        +
      </button>
    </span>
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
          {row.injury ? (
            <>
              {' '}
              <InjuryMark injury={row.injury} />
            </>
          ) : null}
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
              {label} <b className={rateTone(p.ratings[key])}>{display(p.ratings[key])}</b>
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
  const [rest, setRest] = useState<Record<string, 'b2b' | 'manage'>>({})
  const [lineup, setLineup] = useState<Partial<Record<Position, string>>>({})
  const [lineups, setLineups] = useState<NamedLineups>({})
  const [unitTactics, setUnitTactics] = useState<NamedUnitStyles>({})
  const [unitTab, setUnitTab] = useState<LineupUnitId>('starters')
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
    const activeIds = ranked.filter((id) => !got.plan.inactive.includes(id))
    const overflow = activeIds.slice(DRESS_MAX)
    const parked = [
      ...got.plan.inactive.filter((id) => ranked.includes(id)),
      ...overflow,
    ]
    setInactive(parked)
    setRest(got.plan.rest ?? {})
    const seeded: Record<string, number> = {}
    const dressing = ranked.filter((id) => !parked.includes(id))
    for (const id of ranked) {
      if (parked.includes(id)) seeded[id] = 0
      else {
        const explicit = got.plan.minutes[id]
        if (explicit != null) seeded[id] = explicit
        else {
          const slot = dressing.indexOf(id)
          seeded[id] = slot < 0 ? 0 : (LADDER[slot] ?? 0)
        }
      }
    }
    setMinutes(seeded)
    if (overflow.length) await client.setPlan(me, { inactive: parked, minutes: seeded })
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
    setUnitTactics(got.plan.unitTactics ?? {})
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
    (id: string): Position | null => {
      for (const unit of LINEUP_UNIT_IDS) {
        const slots = lineups[unit]
        if (!slots) continue
        const pos = POSITIONS.find((p) => slots[p] === id)
        if (pos) return pos
      }
      return POSITIONS.find((p) => lineup[p] === id) ?? null
    },
    [lineups, lineup],
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
      if (next.rest) setRest(next.rest)
      if (next.lineup) setLineup(next.lineup)
      if (next.lineups) setLineups(next.lineups)
      if (next.unitTactics) setUnitTactics(next.unitTactics)
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
      const activating = benched.has(id)
      let next = activating ? inactive.filter((x) => x !== id) : [...inactive, id]
      const minutesNext = { ...minutes }
      if (activating) delete minutesNext[id]
      else minutesNext[id] = 0
      if (activating && active.length >= DRESS_MAX) {
        const victim = [...active].reverse().find((x) => x !== id)
        if (victim) {
          if (!next.includes(victim)) next = [...next, victim]
          minutesNext[victim] = 0
        }
      }
      const l = { ...lineup }
      for (const pid of next) {
        for (const p of POSITIONS) if (l[p] === pid) delete l[p]
      }
      const units: NamedLineups = { ...lineups }
      for (const unit of LINEUP_UNIT_IDS) {
        const slots = { ...(units[unit] ?? {}) }
        for (const pid of next) {
          for (const p of POSITIONS) if (slots[p] === pid) delete slots[p]
        }
        if (POSITIONS.some((p) => slots[p])) units[unit] = slots
        else delete units[unit]
      }
      commit({ inactive: next, lineup: l, lineups: units, minutes: minutesNext })
    },
    [active, benched, inactive, lineup, lineups, minutes, commit],
  )

  /**
   * The obvious lineup, in one click: each slot goes to the best available man who actually plays
   * it, and only when nobody is left does a slot take somebody out of position. Without this the
   * five slots start empty and the whole feature is twenty-five clicks away.
   */
  const fillByPosition = useCallback(() => {
    const pool = active
      .map((id) => byId.get(id))
      .filter((r): r is RosterRow => !!r && !cannotDress(r.injury))
      .sort((a, b) => overallOf(b) - overallOf(a))
    const taken = new Set<string>()
    const next = pickFive(pool, taken)
    commit({
      lineup: next,
      lineups: { ...lineups, starters: next },
      inactive: inactive.filter((x) => !taken.has(x)),
    })
  }, [active, byId, inactive, lineups, commit])

  /** Second unit from whoever the first unit did not take. */
  const fillSecondUnit = useCallback(() => {
    const pool = active
      .map((id) => byId.get(id))
      .filter((r): r is RosterRow => !!r && !cannotDress(r.injury))
      .sort((a, b) => overallOf(b) - overallOf(a))
    const taken = new Set<string>()
    const first = lineups.starters ?? lineup
    for (const pos of POSITIONS) {
      const id = first[pos]
      if (id) taken.add(id)
    }
    const next = pickFive(pool, taken)
    commit({ lineups: { ...lineups, bench: next } })
  }, [active, byId, lineup, lineups, commit])

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
      .filter((r): r is RosterRow => !!r && !cannotDress(r.injury))
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

  const setUnitSlot = useCallback(
    (unit: LineupUnitId, pos: Position, id: string) => {
      const slots: Partial<Record<Position, string>> = {
        ...((unit === 'starters' ? (lineups.starters ?? lineup) : lineups[unit]) ?? {}),
      }
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
      let stillOut = inactive.filter((x) => !Object.values(slots).includes(x))
      const dressing = order.filter((x) => !stillOut.includes(x))
      if (dressing.length > DRESS_MAX) {
        const keep = new Set(Object.values(slots).filter((x): x is string => !!x))
        const spill = dressing.filter((x) => !keep.has(x)).slice(DRESS_MAX - keep.size)
        stillOut = [...stillOut, ...spill]
      }
      if (unit === 'starters') commit({ lineups: next, lineup: slots, inactive: stillOut })
      else commit({ lineups: next, inactive: stillOut })
    },
    [lineups, lineup, inactive, order, commit],
  )

  const setUnitStyle = useCallback(
    (unit: LineupUnitId, style: NamedUnitStyles[LineupUnitId] | null) => {
      const next: NamedUnitStyles = { ...unitTactics }
      if (!style) delete next[unit]
      else next[unit] = style
      commit({ unitTactics: next })
    },
    [unitTactics, commit],
  )

  const copyFirstToClosers = useCallback(() => {
    const first = lineups.starters ?? lineup
    if (!POSITIONS.some((p) => first[p])) return
    commit({ lineups: { ...lineups, closing: { ...first } } })
  }, [lineups, lineup, commit])

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
      unitTactics: {},
      system: 'balanced',
      instructions: {},
      rest: {},
      sitNext: [],
    })
    setClamped('')
    setOpenMan(null)
    setSaved(new Date().toLocaleTimeString())
    await load()
  }, [client, me, load])

  /** Everybody who could fill a slot: the whole roster, so you can start whoever you like. */
  const selectable = useMemo(() => [...rows].sort((a, b) => overallOf(b) - overallOf(a)), [rows])

  const firstFive = lineups.starters ?? lineup
  const gamesLeft = remainingTeamGames(game?.calendar, me)
  const trainer = useMemo(
    () => trainerRows(rows, gamesLeft, (id) => game?.availability?.[id]?.injury?.severity ?? null),
    [rows, gamesLeft, game],
  )
  const trainerById = useMemo(() => new Map(trainer.map((t) => [t.playerId, t])), [trainer])
  const optionLabel = (row: RosterRow) =>
    `${row.player.name} (${row.player.pos} ${row.card.overall})${injuryOptionTag(
      row.injury,
      game?.availability?.[row.player.playerId]?.injury?.severity,
      gamesLeft,
    )}`
  const misfits = useMemo(
    () =>
      POSITIONS.map((pos) => {
        const id = firstFive[pos]
        const r = id ? byId.get(id) : undefined
        if (!r) return null
        const gap = positionGap(r.player.pos, pos)
        return gap === 0 ? null : { pos, r, gap }
      }).filter((x): x is { pos: Position; r: RosterRow; gap: number } => !!x),
    [firstFive, byId],
  )

  const openRow = openMan ? (byId.get(openMan) ?? null) : null

  if (!snapshot) return null
  const team = teamById.get(me)
  const emptySlots = POSITIONS.filter((p) => !firstFive[p])
  const editingSlots = unitTab === 'starters' ? firstFive : (lineups[unitTab] ?? {})
  const unitStyle = unitTactics[unitTab]
  const inheritStyle = !unitStyle

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
            {n1(total)} / {TEAM_MINUTES} · {withMinutes} of {DRESS_MAX} dress
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

        {trainer.length > 0 ? (
          <div className="tc-trainer">
            <div className="hd">
              Unavailable
              <span className="faint">
                {rows.length -
                  trainer.filter((t) => t.kind === 'out' || t.kind === 'season').length}{' '}
                can dress
                {trainer.some((t) => t.kind === 'season')
                  ? ` · ${trainer.filter((t) => t.kind === 'season').length} out for the season`
                  : ''}
              </span>
            </div>
            <ul>
              {trainer.map((t) => (
                <li key={t.playerId}>
                  <span
                    className={
                      t.kind === 'out' || t.kind === 'season' ? 'badge loss' : 'badge warn'
                    }
                  >
                    {t.kind === 'season'
                      ? 'SEASON'
                      : t.kind === 'out'
                        ? 'OUT'
                        : t.kind === 'through'
                          ? 'THRU'
                          : 'DTD'}
                  </span>
                  <button type="button" className="tc-name" onClick={() => setOpenMan(t.playerId)}>
                    {t.name}
                  </button>
                  <span className="pos">{t.pos}</span>
                  <span className="why">{t.injuryName}</span>
                  <span className="when">{t.when}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Panel
          title="Who plays together"
          actions={
            <span style={{ display: 'flex', gap: 6 }}>
              {unitTab === 'starters' ? (
                <button type="button" className="ghost tiny" onClick={fillByPosition}>
                  Fill by position
                </button>
              ) : null}
              {unitTab === 'bench' ? (
                <button type="button" className="ghost tiny" onClick={fillSecondUnit}>
                  Fill remaining
                </button>
              ) : null}
              {unitTab === 'closing' ? (
                <button type="button" className="ghost tiny" onClick={copyFirstToClosers}>
                  Copy first unit
                </button>
              ) : null}
            </span>
          }
        >
          <div className="tc-unit-tabs">
            <fieldset className="segmented" aria-label="Rotation unit">
              {LINEUP_UNIT_IDS.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  className="ghost"
                  aria-pressed={unitTab === unit}
                  onClick={() => setUnitTab(unit)}
                >
                  {UNIT_LABEL[unit]}
                </button>
              ))}
            </fieldset>
          </div>
          <p className="faint" style={{ fontSize: 11, margin: '8px 0' }}>
            {UNIT_WHEN[unitTab]} Anyone can play any slot — suggested names are the naturals and the
            next-closest. Empty slots go to the next man in the minutes table.
          </p>
          <div className="tc-five">
            {POSITIONS.map((pos) => {
              const id = editingSlots[pos]
              const r = id ? byId.get(id) : undefined
              const desk = r ? trainerById.get(r.player.playerId) : undefined
              const gap = r ? positionGap(r.player.pos, pos) : 0
              const bad = Math.abs(gap) >= 2
              const { suggested, rest } = optionsForSlot(selectable, pos)
              const option = (row: RosterRow) => (
                <option key={row.player.playerId} value={row.player.playerId}>
                  {optionLabel(row)}
                </option>
              )
              return (
                <div
                  key={pos}
                  className={`tc-slot${r ? '' : ' empty'}${gap !== 0 ? ' misfit' : ''}${bad ? ' bad' : ''}`}
                >
                  <div className="pos">{pos}</div>
                  <select
                    value={id ?? ''}
                    aria-label={`${UNIT_LABEL[unitTab]} ${pos}`}
                    onChange={(e) => setUnitSlot(unitTab, pos, e.currentTarget.value)}
                  >
                    <option value="">— nobody —</option>
                    {suggested.length > 0 ? (
                      <optgroup label="Suggested">{suggested.map(option)}</optgroup>
                    ) : null}
                    {rest.length > 0 ? (
                      <optgroup label="Everyone else">{rest.map(option)}</optgroup>
                    ) : null}
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
                        {gap === 0 ? `A natural ${pos}.` : positionNote(r.player.pos, pos)}
                      </div>
                      {desk ? (
                        <div
                          className={`note${desk.kind === 'out' || desk.kind === 'season' ? ' bad' : ''}`}
                        >
                          {desk.injuryName} · {desk.when}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="note fine">Empty. Next man up from the rotation fills it.</div>
                  )}
                </div>
              )
            })}
          </div>
          {unitTab === 'starters' && misfits.length > 0 ? (
            <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              {misfits.length === 1 ? 'One man is' : `${misfits.length} men are`} out of position in
              the first unit. He loses the ratings the slot needs — you will see it in the box
              score.
            </p>
          ) : unitTab === 'starters' && emptySlots.length === POSITIONS.length ? (
            <p className="faint" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
              No first unit named, so the top of the rotation starts. “Fill by position” puts the
              best natural at each slot.
            </p>
          ) : null}
          <div className="tc-unit-style">
            <label className="checkline">
              <input
                type="checkbox"
                checked={inheritStyle}
                onChange={(e) => {
                  if (e.currentTarget.checked) setUnitStyle(unitTab, null)
                  else setUnitStyle(unitTab, { pace: tactics.pace, threes: tactics.threes })
                }}
              />
              Same pace and shots as the team
            </label>
            {inheritStyle ? (
              <p className="faint" style={{ fontSize: 11, margin: 0 }}>
                This five runs the team instructions. Uncheck to push the tempo or let them fly only
                while this group is on the floor.
              </p>
            ) : (
              <div className="tc-unit-knobs">
                <div>
                  <div className="rowline" style={{ marginBottom: 4 }}>
                    <strong>Pace</strong>
                  </div>
                  <Segmented
                    name={`${UNIT_LABEL[unitTab]} pace`}
                    values={[-1, 0, 1]}
                    labels={['Walk it up', 'Team', 'Push it']}
                    value={unitStyle?.pace ?? 0}
                    onChange={(v) =>
                      setUnitStyle(unitTab, {
                        pace: v as -1 | 0 | 1,
                        threes: unitStyle?.threes ?? 0,
                      })
                    }
                  />
                </div>
                <div>
                  <div className="rowline" style={{ marginBottom: 4 }}>
                    <strong>Shots</strong>
                  </div>
                  <Segmented
                    name={`${UNIT_LABEL[unitTab]} shots`}
                    values={[-1, 0, 1]}
                    labels={['Work inside', 'Team', 'Let them fly']}
                    value={unitStyle?.threes ?? 0}
                    onChange={(v) =>
                      setUnitStyle(unitTab, {
                        pace: unitStyle?.pace ?? 0,
                        threes: v as -1 | 0 | 1,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel flush title={`Rotation · ${withMinutes} men`}>
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
                <th className="text">Load</th>
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
                const desk = trainerById.get(id)
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
                      <InjuryMark injury={r.injury} />
                      {desk ? (
                        <div className="faint" style={{ fontSize: 10 }}>
                          {desk.injuryName} · {desk.when}
                        </div>
                      ) : null}
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
                      <select
                        aria-label={`${r.player.name} load`}
                        value={rest[id] ?? ''}
                        disabled={out}
                        onChange={(e) => {
                          const v = e.currentTarget.value as '' | 'b2b' | 'manage'
                          const next = { ...rest }
                          if (v) next[id] = v
                          else delete next[id]
                          commit({ rest: next })
                        }}
                        title={r.injuryRisk?.text ?? 'How often he dresses'}
                      >
                        <option value="">Every night</option>
                        <option value="b2b">Sit B2Bs</option>
                        <option value="manage">Manage nights</option>
                      </select>
                      {r.injuryRisk ? (
                        <div className="faint" style={{ fontSize: 10 }} title={r.injuryRisk.text}>
                          {r.injuryRisk.short}
                        </div>
                      ) : null}
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
                      <button
                        type="button"
                        className="ghost tiny"
                        onClick={() => toggleBench(id)}
                        title={
                          out && active.length >= DRESS_MAX
                            ? 'Twelve already dress. This sits the last man in the rotation.'
                            : undefined
                        }
                      >
                        {out ? 'Activate' : 'Bench'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {order.length === 0 ? (
                <tr>
                  <td className="text dim" colSpan={13}>
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
          Drag a row, or use ▲ ▼, to reorder the rotation. Twelve dress; sit the rest. Minutes are
          a share of 240, so a thin night still fills the game. “Balance to 240” scales the shape
          you set into the budget. The first unit starts; the second unit and the closers are the
          fives who play together in those stints. {saved ? `Sent to the coach at ${saved}.` : ''}
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
