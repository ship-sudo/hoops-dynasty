/// <reference lib="webworker" />
/**
 * The sim lives here so the UI thread never blocks. It owns the bundle and the Dynasty instance;
 * the UI only ever asks for views.
 */
import type { HistoryBundle, SeasonBundle } from '@hoops/core'
import type { Dynasty, DynastyModule } from './api.ts'
import type { Progress, Request, Response, Snapshot } from './protocol.ts'
import { realModule } from './real.ts'

/**
 * Career arcs for every real player, 1998 onward. They make draft classes real — the 2003 board
 * holds LeBron at the top — and they are what the fate slider blends toward. About 7MB, so it is
 * fetched once in the background and the game runs without it until it lands.
 */
let history: HistoryBundle | null = null
let game: DynastyModule = realModule()

const historyReady = fetch('/bundles/history.json')
  .then((res) => (res.ok ? (res.json() as Promise<HistoryBundle>) : null))
  .then((h) => {
    if (!h) return
    history = h
    game = realModule({ history })
  })
  .catch(() => {
    // No history file: draft classes stay fictional, which is a supported way to play.
  })

const ctx = self as unknown as DedicatedWorkerGlobalScope

let bundle: SeasonBundle | null = null
let dynasty: Dynasty | null = null

async function openSeason(yearEnd: number): Promise<SeasonBundle> {
  // Wait for the careers if they are still in flight: a game started without them would draft
  // invented players in a year whose real class we have.
  await historyReady
  if (bundle?.yearEnd === yearEnd) return bundle
  const res = await fetch(`/bundles/${yearEnd}.json`)
  if (!res.ok) throw new Error(`could not load season ${yearEnd} (${res.status})`)
  bundle = (await res.json()) as SeasonBundle
  dynasty = null
  return bundle
}

function need(): Dynasty {
  if (!dynasty) throw new Error('no game in progress')
  return dynasty
}

function snapshot(lastDay: Snapshot['lastDay'] = null): Snapshot {
  const d = need()
  return { state: d.getState(), standings: d.standings(), news: d.news(80), lastDay }
}

function report(id: number, progress: Progress): void {
  ctx.postMessage({ id, progress })
}

async function handle(req: Request): Promise<Response> {
  switch (req.kind) {
    case 'openSeason': {
      const b = await openSeason(req.yearEnd)
      return {
        id: req.id,
        ok: true,
        kind: 'openSeason',
        data: { yearEnd: b.yearEnd, seasonId: b.seasonId, teams: b.teams },
      }
    }
    case 'preview': {
      const b = await openSeason(req.yearEnd)
      return { id: req.id, ok: true, kind: 'preview', data: game.preview(b, req.teamId) }
    }
    case 'newGame': {
      const b = await openSeason(req.yearEnd)
      dynasty = game.newGame(b, { yearEnd: req.yearEnd, teamId: req.teamId, seed: req.seed })
      return { id: req.id, ok: true, kind: 'snapshot', data: snapshot() }
    }
    case 'loadSave': {
      const b = await openSeason(req.save.yearEnd)
      dynasty = game.loadGame(b, req.save)
      return { id: req.id, ok: true, kind: 'snapshot', data: snapshot() }
    }
    case 'simDays': {
      const d = need()
      let last = null
      for (let i = 0; i < req.days; i++) {
        const day = d.simDay()
        if (!day) break
        last = day
        report(req.id, { done: i + 1, total: req.days, label: day.date })
        if (day.interrupt) break
      }
      return { id: req.id, ok: true, kind: 'snapshot', data: snapshot(last) }
    }
    case 'simToDate': {
      const d = need()
      const target = new Date(req.date).getTime()
      const from = new Date(d.getState().date).getTime()
      const totalDays = Math.max(1, Math.round((target - from) / 86400000))
      let last = null
      const days = d.simToDate(req.date, (day, i) => {
        last = day
        report(req.id, { done: i, total: totalDays, label: day.date })
        return day.interrupt ? false : undefined
      })
      return { id: req.id, ok: true, kind: 'snapshot', data: snapshot(days.length ? last : null) }
    }
    case 'snapshot':
      return { id: req.id, ok: true, kind: 'snapshot', data: snapshot() }
    case 'schedule':
      return { id: req.id, ok: true, kind: 'schedule', data: need().schedule(req.teamId) }
    case 'roster':
      return { id: req.id, ok: true, kind: 'roster', data: need().roster(req.teamId) }
    case 'finance':
      return { id: req.id, ok: true, kind: 'finance', data: need().finance(req.teamId) }
    case 'boxScore':
      return { id: req.id, ok: true, kind: 'boxScore', data: need().boxScore(req.gameId) }
    case 'save':
      return { id: req.id, ok: true, kind: 'save', data: need().save() }
    case 'tradeBlock':
      return { id: req.id, ok: true, kind: 'tradeBlock', data: need().tradeBlock(req.teamId) }
    case 'picks':
      return { id: req.id, ok: true, kind: 'picks', data: need().picksOf(req.teamId) }
    case 'assessTrade':
      return {
        id: req.id,
        ok: true,
        kind: 'tradeAssessment',
        data: need().assessTrade(req.user, req.other),
      }
    case 'executeTrade':
      return {
        id: req.id,
        ok: true,
        kind: 'tradeAssessment',
        data: need().executeTrade(req.user, req.other),
      }
    case 'incomingOffers':
      return {
        id: req.id,
        ok: true,
        kind: 'incomingOffers',
        data: need().incomingOffers(req.limit),
      }
    case 'manager': {
      const d = need() as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>
      const fn = d[req.method]
      if (typeof fn !== 'function') throw new Error(`unknown manager action: ${req.method}`)
      return { id: req.id, ok: true, kind: 'manager', data: fn.apply(d, req.args) }
    }
    case 'plan':
      return {
        id: req.id,
        ok: true,
        kind: 'plan',
        data: { plan: need().getPlan(req.teamId), zoneLegal: bundle?.era.zoneLegal ?? false },
      }
    case 'setPlan': {
      const d = need()
      d.setPlan(req.teamId, req.plan)
      return {
        id: req.id,
        ok: true,
        kind: 'plan',
        data: { plan: d.getPlan(req.teamId), zoneLegal: bundle?.era.zoneLegal ?? false },
      }
    }
    case 'seasonHistory':
      return { id: req.id, ok: true, kind: 'seasonHistory', data: need().seasonHistory() }
  }
}

ctx.addEventListener('message', (ev: MessageEvent<Request>) => {
  const req = ev.data
  handle(req).then(
    (res) => ctx.postMessage(res),
    (err: unknown) =>
      ctx.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies Response),
  )
})
