/** Promise-based RPC over the sim worker, with progress callbacks. */
import type { GameResult } from '@hoops/core'
import type {
  PickRef,
  RosterRow,
  SaveFile,
  ScheduleEntry,
  SimSeason,
  TeamFinance,
  TeamPlan,
  TradeAssessment,
  TradeBlockPlayer,
  TradePackage,
} from './api.ts'
import type {
  IncomingOffer,
  Progress,
  Request,
  RequestBody,
  Response,
  ResponseData,
  ResponseKind,
  SeasonInfo,
  Snapshot,
  WorkerEvent,
} from './protocol.ts'

type Pending = {
  resolve: (r: Response) => void
  reject: (e: Error) => void
  onProgress?: (p: Progress) => void
}

export class SimClient {
  private readonly worker: Worker
  private readonly pending = new Map<number, Pending>()
  private nextId = 1

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.addEventListener('message', (ev: MessageEvent<WorkerEvent>) => {
      const msg = ev.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if ('progress' in msg) {
        p.onProgress?.(msg.progress)
        return
      }
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg)
      else p.reject(new Error(msg.error))
    })
    this.worker.addEventListener('error', (ev) => {
      for (const [, p] of this.pending) p.reject(new Error(ev.message || 'sim worker crashed'))
      this.pending.clear()
    })
  }

  private send(req: RequestBody, onProgress?: (p: Progress) => void): Promise<Response> {
    const id = this.nextId++
    const full = { ...req, id } as Request
    return new Promise<Response>((resolve, reject) => {
      const entry: Pending = onProgress ? { resolve, reject, onProgress } : { resolve, reject }
      this.pending.set(id, entry)
      this.worker.postMessage(full)
    })
  }

  private async expect<K extends ResponseKind>(
    req: RequestBody,
    kind: K,
    onProgress?: (p: Progress) => void,
  ): Promise<ResponseData[K]> {
    const res = await this.send(req, onProgress)
    if (!res.ok) throw new Error(res.error)
    if (res.kind !== kind) throw new Error(`sim returned ${res.kind}, expected ${kind}`)
    // `kind` was just checked at runtime; TS cannot narrow a generic union member on its own.
    return res.data as ResponseData[K]
  }

  openSeason(yearEnd: number): Promise<SeasonInfo> {
    return this.expect({ kind: 'openSeason', yearEnd }, 'openSeason')
  }
  preview(yearEnd: number, teamId: string): Promise<{ roster: RosterRow[]; finance: TeamFinance }> {
    return this.expect({ kind: 'preview', yearEnd, teamId }, 'preview')
  }
  newGame(yearEnd: number, teamId: string, seed: number): Promise<Snapshot> {
    return this.expect({ kind: 'newGame', yearEnd, teamId, seed }, 'snapshot')
  }
  loadSave(save: SaveFile): Promise<Snapshot> {
    return this.expect({ kind: 'loadSave', save }, 'snapshot')
  }
  simDays(days: number, onProgress?: (p: Progress) => void): Promise<Snapshot> {
    return this.expect({ kind: 'simDays', days }, 'snapshot', onProgress)
  }
  simToDate(date: string, onProgress?: (p: Progress) => void): Promise<Snapshot> {
    return this.expect({ kind: 'simToDate', date }, 'snapshot', onProgress)
  }
  snapshot(): Promise<Snapshot> {
    return this.expect({ kind: 'snapshot' }, 'snapshot')
  }
  schedule(teamId?: string): Promise<ScheduleEntry[]> {
    return this.expect(teamId ? { kind: 'schedule', teamId } : { kind: 'schedule' }, 'schedule')
  }
  roster(teamId: string): Promise<RosterRow[]> {
    return this.expect({ kind: 'roster', teamId }, 'roster')
  }
  finance(teamId: string): Promise<TeamFinance> {
    return this.expect({ kind: 'finance', teamId }, 'finance')
  }
  boxScore(gameId: string): Promise<GameResult | null> {
    return this.expect({ kind: 'boxScore', gameId }, 'boxScore')
  }
  save(): Promise<SaveFile> {
    return this.expect({ kind: 'save' }, 'save')
  }
  tradeBlock(teamId: string): Promise<TradeBlockPlayer[]> {
    return this.expect({ kind: 'tradeBlock', teamId }, 'tradeBlock')
  }
  picks(teamId: string): Promise<PickRef[]> {
    return this.expect({ kind: 'picks', teamId }, 'picks')
  }
  assessTrade(user: TradePackage, other: TradePackage): Promise<TradeAssessment> {
    return this.expect({ kind: 'assessTrade', user, other }, 'tradeAssessment')
  }
  executeTrade(user: TradePackage, other: TradePackage): Promise<TradeAssessment> {
    return this.expect({ kind: 'executeTrade', user, other }, 'tradeAssessment')
  }
  incomingOffers(limit?: number): Promise<IncomingOffer[]> {
    return this.expect(
      limit == null ? { kind: 'incomingOffers' } : { kind: 'incomingOffers', limit },
      'incomingOffers',
    )
  }

  /** Call a `ManagerActions` method on the Dynasty in the worker. */
  async manager<T>(method: string, ...args: unknown[]): Promise<T> {
    return (await this.expect({ kind: 'manager', method, args }, 'manager')) as T
  }

  plan(teamId: string): Promise<{ plan: TeamPlan; zoneLegal: boolean }> {
    return this.expect({ kind: 'plan', teamId }, 'plan')
  }
  setPlan(
    teamId: string,
    plan: Partial<TeamPlan>,
  ): Promise<{ plan: TeamPlan; zoneLegal: boolean }> {
    return this.expect({ kind: 'setPlan', teamId, plan }, 'plan')
  }
  seasonHistory(): Promise<SimSeason[]> {
    return this.expect({ kind: 'seasonHistory' }, 'seasonHistory')
  }
}
