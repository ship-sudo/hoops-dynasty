/**
 * The staff screen: your five men, what each of them actually does to your team, the market, and
 * who is coaching everyone else.
 *
 * Two rules the page keeps. Every claim it makes carries the number behind it — "±2.8 rating points
 * of misranking", "+24% on what your under-26s gain" — because those are the numbers the sim uses,
 * not adjectives about them. And every refusal says why, in a sentence, so "he said no" is never a
 * mystery.
 */
import { useCallback, useEffect, useState } from 'react'
import type { CandidateView, CoachView, StaffRoleId, StaffView } from '../sim/api.ts'
import { useStore } from '../store.tsx'
import { Panel, TeamChip } from '../ui/bits.tsx'
import { money } from '../ui/format.ts'
import './staff.css'

const ROLES: StaffRoleId[] = ['head', 'offense', 'defense', 'development', 'scout']

const SHORT: Record<StaffRoleId, string> = {
  head: 'Head coach',
  offense: 'Offence',
  defense: 'Defence',
  development: 'Development',
  scout: 'Scouting',
}

function quality(q: number): string {
  return q >= 70 ? 'st-q good' : q <= 40 ? 'st-q bad' : 'st-q'
}

/** The seven numbers, small, so a man can be compared at a glance. */
function Mini({ c }: { c: CoachView }) {
  const r = c.ratings
  const cells: [string, number][] = [
    ['rotation', r.rotation],
    ['adjust', r.adjust],
    ['morale', r.morale],
    ['offence', r.offense],
    ['defence', r.defense],
    ['develop', r.development],
    ['scouting', r.scouting],
  ]
  return (
    <div className="st-mini">
      {cells.map(([label, v]) => (
        <span key={label}>
          {label} <b>{Math.round(v)}</b>
        </span>
      ))}
    </div>
  )
}

function Employed({
  slot,
  onFire,
  busy,
}: {
  slot: StaffView['slots'][number]
  onFire: () => void
  busy: boolean
}) {
  const c = slot.coach
  if (!c)
    return (
      <div className="st-card vacant">
        <div className="st-head">
          <span className="st-role">{slot.roleLabel}</span>
          <span className="st-name">Vacant</span>
          <span className="st-q bad">35</span>
        </div>
        <div className="st-job">{slot.job}</div>
        <div className="st-bg">
          Nobody is doing this job. An empty chair is not neutral — the league treats it as a rating
          of 35, below the worst man you could hire.
        </div>
      </div>
    )
  return (
    <div className="st-card">
      <div className="st-head">
        <span className="st-role">{slot.roleLabel}</span>
        <span className="st-name">{c.name}</span>
        {c.hallOfFamer ? <span className="st-hof">Hall of Fame</span> : null}
        <span className={quality(c.quality)}>{c.quality}</span>
      </div>
      <div className="st-job">{slot.job}</div>
      <div className="st-bg">
        Age {c.age} · {c.background}
        {c.record.w + c.record.l > 0
          ? ` · ${c.record.w}-${c.record.l} as a head coach${c.titles ? `, ${c.titles} title${c.titles === 1 ? '' : 's'}` : ''}`
          : ''}
      </div>
      <ul className="st-effects">
        {c.effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <Mini c={c} />
      <div className="st-foot">
        <span>
          {money(c.salary)}/yr · {c.yearsLeft} year{c.yearsLeft === 1 ? '' : 's'} left
        </span>
        <span className="spacer" />
        <span className="warn">Sacking him costs {money(slot.severance)}</span>
        <button type="button" className="ghost" onClick={onFire} disabled={busy}>
          Sack
        </button>
      </div>
    </div>
  )
}

function Candidate({
  c,
  role,
  onHire,
  busy,
  vacant,
}: {
  c: CandidateView
  role: StaffRoleId
  onHire: (years: number, premium: boolean) => void
  busy: boolean
  vacant: boolean
}) {
  const [years, setYears] = useState(3)
  const [premium, setPremium] = useState(false)
  const interest = c.interest.find((i) => i.role === role)
  const salary = Math.round((interest?.salary ?? 0) * (premium ? 1.25 : 1))
  return (
    <div className={interest?.willing ? 'st-cand' : 'st-cand no'}>
      <div className="st-head">
        <span className="st-name">{c.name}</span>
        {c.hallOfFamer ? <span className="st-hof">Hall of Fame</span> : null}
        <span className="dim" style={{ fontSize: 11 }}>
          {c.age} · known as {c.roleLabel.toLowerCase()} · reputation {c.reputation}
        </span>
        <span className={quality(c.quality)}>{c.quality}</span>
      </div>
      <div className="st-bg">{c.background}</div>
      <ul className="st-effects">
        {c.effects.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <Mini c={c} />
      <div className={interest?.willing ? 'st-verdict yes' : 'st-verdict no'}>
        {interest?.reason}
      </div>
      <div className="st-hire">
        <span>{money(salary)}/yr</span>
        <select
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          aria-label="Contract length"
        >
          {[1, 2, 3, 4, 5].map((y) => (
            <option key={y} value={y}>
              {y} year{y === 1 ? '' : 's'}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={premium} onChange={(e) => setPremium(e.target.checked)} />{' '}
          pay 25% over the odds
        </label>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          type="button"
          className="primary"
          disabled={busy || !vacant}
          onClick={() => onHire(years, premium)}
          title={vacant ? '' : 'Sack the man in that chair first'}
        >
          Hire as {SHORT[role].toLowerCase()}
        </button>
      </div>
    </div>
  )
}

export function Staff() {
  const { client, snapshot, teamById, refresh } = useStore()
  const me = snapshot?.state.userTeamId ?? ''
  const [view, setView] = useState<StaffView | null>(null)
  const [role, setRole] = useState<StaffRoleId>('head')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!me) return
    setView(await client.manager<StaffView>('staff', me))
  }, [client, me])

  useEffect(() => {
    void load()
  }, [load])

  const act = useCallback(
    async (method: 'hireCoach' | 'fireCoach', ...args: unknown[]) => {
      setBusy(true)
      try {
        const res = await client.manager<{ ok: boolean; message: string; view: StaffView }>(
          method,
          ...args,
        )
        setView(res.view)
        setMsg({ ok: res.ok, text: res.message })
        if (res.ok) await refresh()
      } finally {
        setBusy(false)
      }
    },
    [client, refresh],
  )

  if (!view) return <div className="dim">Loading the staff…</div>

  const slot = view.slots.find((s) => s.role === role)
  const vacant = !slot?.coach
  const willing = view.pool.filter((c) => c.interest.find((i) => i.role === role)?.willing)

  return (
    <div className="cols sidebar">
      <div className="cols">
        {msg ? <div className={msg.ok ? 'st-msg ok' : 'st-msg bad'}>{msg.text}</div> : null}

        <Panel title="Your staff">
          <div className="st-slots">
            {view.slots.map((s) => (
              <Employed
                key={s.role}
                slot={s}
                busy={busy}
                onFire={() => void act('fireCoach', s.role)}
              />
            ))}
          </div>
        </Panel>

        <Panel
          title="The market"
          actions={
            <div className="st-tabs">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={role === r}
                  onClick={() => setRole(r)}
                  className="ghost"
                >
                  {SHORT[r]}
                </button>
              ))}
            </div>
          }
        >
          <p className="st-job" style={{ marginTop: 0 }}>
            {view.pool.length} men are out of work, and {willing.length} of them would take the{' '}
            {SHORT[role].toLowerCase()} job at {teamById.get(me)?.name ?? 'your club'}
            {willing.length === view.pool.length
              ? '. Nobody is turning you down — a club is judged on how it has been playing, and yours looks like a job worth having.'
              : ' — the rest say below why they would not.'}{' '}
            {vacant ? '' : 'That chair is taken; sack the man in it first.'}
          </p>
          <div className="st-pool">
            {view.pool.map((c) => (
              <Candidate
                key={c.coachId}
                c={c}
                role={role}
                busy={busy}
                vacant={vacant}
                onHire={(years, premium) =>
                  void act(
                    'hireCoach',
                    c.coachId,
                    role,
                    years,
                    Math.round(
                      (c.interest.find((i) => i.role === role)?.salary ?? 0) * (premium ? 1.25 : 1),
                    ),
                  )
                }
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="cols">
        <Panel title="The bill">
          <dl className="kv">
            <dt>Staff wages</dt>
            <dd>{money(view.wages)}/yr</dd>
            <dt>Paid off so far</dt>
            <dd className={view.deadMoney > 0 ? 'warn' : ''}>{money(view.deadMoney)}</dd>
            <dt>Salary cap</dt>
            <dd>{money(view.cap)}</dd>
            <dt>You look like</dt>
            <dd>{view.appeal}/100</dd>
          </dl>
          <p className="st-bg" style={{ marginTop: 8 }}>
            Coaching money is not player money: it never touches the cap. What it does cost you is
            the pay-off when you change your mind — every guaranteed year of a sacked man's deal is
            paid in full. How your club looks to a coach is mostly how it has been playing, then
            what it has won, then what you are offering.
          </p>
        </Panel>

        <Panel title="Around the league">
          <table className="st-rivals">
            <thead>
              <tr>
                <th>Club</th>
                <th>Head coach</th>
                <th>Rep</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {view.rivals.map((r) => (
                <tr key={r.teamId} className={r.formerlyYours ? 'yours' : ''}>
                  <td>
                    <TeamChip team={teamById.get(r.teamId)} />
                  </td>
                  <td>
                    {r.coachName}
                    {r.hallOfFamer ? <span className="st-hof"> HOF</span> : null}
                    {r.formerlyYours ? <span className="loss"> · you sacked him</span> : null}
                    {r.playerId ? <span className="faint"> · former player</span> : null}
                  </td>
                  <td className="num">{r.reputation || '—'}</td>
                  <td className="num">
                    {r.record.w}-{r.record.l}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  )
}
