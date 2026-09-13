import type { TeamRecord } from '@hoops/core'
import type { GameState } from '@hoops/game'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { saves } from './save/db.ts'
import type { SaveFile } from './sim/api.ts'
import { SimClient } from './sim/client.ts'
import type { Progress, Snapshot } from './sim/protocol.ts'

/** How a multi-day sim should feel. Play and season stay snappy; week/month/soft watch the days. */
export type SimPace = 'play' | 'week' | 'month' | 'soft' | 'season'

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

function beatMs(pace: SimPace): number {
  if (reducedMotion()) return 0
  if (pace === 'week') return 1100
  if (pace === 'month') return 850
  if (pace === 'soft') return 2200
  return 0
}

async function waitBeat(ms: number, skipped: () => boolean): Promise<void> {
  if (ms <= 0 || skipped()) return
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (skipped()) return
    await new Promise((r) => setTimeout(r, Math.min(80, end - Date.now())))
  }
}

export type Screen =
  | 'home'
  | 'standings'
  | 'roster'
  | 'schedule'
  | 'trade'
  | 'offseason'
  | 'tactics'
  | 'staff'
  | 'history'
  | 'dynasty'
  | 'league'
  | 'awards'
  | 'allstar'
  | 'playoffs'

/**
 * The save's payload, as the sim writes it. The league's memory — careers, records, the hall of
 * fame — is part of the state itself rather than something the seam in `sim/api.ts` exposes a
 * method for, so the history screens read it straight off the save the app already takes after
 * every simulated day. Nothing is fetched twice for it.
 */
interface SavePayload {
  game: GameState
}

interface Store {
  client: SimClient
  snapshot: Snapshot | null
  /**
   * The whole league state as of the last autosave: every career ever played, the record book and
   * the hall of fame. Null before a game is loaded.
   */
  game: GameState | null
  teams: TeamRecord[]
  teamById: Map<string, TeamRecord>
  busy: Progress | null
  error: string | null
  hasAutosave: boolean
  screen: Screen
  setScreen: (s: Screen) => void
  startGame: (yearEnd: number, teamId: string, seed: number) => Promise<void>
  resume: (save: SaveFile) => Promise<void>
  advance: (days: number, pace?: SimPace) => Promise<void>
  advanceTo: (date: string, pace?: SimPace) => Promise<void>
  /** Finish a watching sim without waiting out the remaining beats. */
  skipSim: () => void
  setAutoLineup: (on: boolean) => Promise<void>
  /** Re-read the snapshot after something other than simming changed the game, and autosave. */
  refresh: () => Promise<void>
  quitToMenu: () => void
  exportSave: () => Promise<SaveFile>
  dismissError: () => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<SimClient | null>(null)
  if (!clientRef.current) clientRef.current = new SimClient()
  const client = clientRef.current

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [busy, setBusy] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasAutosave, setHasAutosave] = useState(false)
  const [screen, setScreen] = useState<Screen>('home')
  const skipRef = useRef(false)

  useEffect(() => {
    saves
      .get()
      .then((s) => setHasAutosave(Boolean(s)))
      .catch(() => setHasAutosave(false))
  }, [])

  /**
   * One trip for two jobs: the autosave, and the copy of the league state the history screens read.
   * The save was already being taken after every simulated day, so the league's memory costs
   * nothing extra to keep on hand.
   */
  const autosave = useCallback(async () => {
    try {
      const file = await client.save()
      setGame((file.state as SavePayload | undefined)?.game ?? null)
      await saves.put(file)
      setHasAutosave(true)
    } catch {
      /* a failed autosave must never break the game */
    }
  }, [client])

  const guard = useCallback(async <T,>(label: string, run: () => Promise<T>): Promise<T | null> => {
    setBusy({ done: 0, total: 1, label })
    setError(null)
    try {
      return await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }, [])

  const startGame = useCallback(
    async (yearEnd: number, teamId: string, seed: number) => {
      await guard('Starting season', async () => {
        const info = await client.openSeason(yearEnd)
        setTeams(info.teams)
        setSnapshot(await client.newGame(yearEnd, teamId, seed))
        setScreen('home')
        await autosave()
      })
    },
    [client, guard, autosave],
  )

  const resume = useCallback(
    async (save: SaveFile) => {
      await guard('Loading save', async () => {
        const info = await client.openSeason(save.yearEnd)
        setTeams(info.teams)
        setSnapshot(await client.loadSave(save))
        setGame((save.state as SavePayload | undefined)?.game ?? null)
        setScreen('home')
      })
    },
    [client, guard],
  )

  const advance = useCallback(
    async (days: number, pace: SimPace = 'play') => {
      const beat = beatMs(pace)
      await guard(days === 1 ? 'Simulating' : `Simulating ${days} days`, async () => {
        if (days <= 1 || beat <= 0) {
          setSnapshot(await client.simDays(days, setBusy))
          await autosave()
          return
        }
        skipRef.current = false
        for (let i = 0; i < days; i++) {
          if (skipRef.current) {
            setSnapshot(await client.simDays(days - i, setBusy))
            break
          }
          const snap = await client.simDays(1)
          setSnapshot(snap)
          setBusy({ done: i + 1, total: days, label: snap.state.date })
          if (snap.lastDay?.interrupt || snap.state.seasonComplete) break
          await waitBeat(beat, () => skipRef.current)
        }
        await autosave()
      })
    },
    [client, guard, autosave],
  )

  const advanceTo = useCallback(
    async (date: string, pace: SimPace = 'play') => {
      const beat = beatMs(pace)
      await guard('Simulating', async () => {
        if (beat <= 0) {
          setSnapshot(await client.simToDate(date, setBusy))
          await autosave()
          return
        }
        skipRef.current = false
        const from = snapshot?.state.date
        const total = from
          ? Math.max(1, Math.round((new Date(date).getTime() - new Date(from).getTime()) / 86400000))
          : 30
        for (let i = 0; i < 400; i++) {
          if (skipRef.current) {
            setSnapshot(await client.simToDate(date, setBusy))
            break
          }
          const snap = await client.simDays(1)
          setSnapshot(snap)
          setBusy({ done: Math.min(i + 1, total), total, label: snap.state.date })
          if (snap.lastDay?.interrupt || snap.state.seasonComplete || snap.state.date >= date) break
          await waitBeat(beat, () => skipRef.current)
        }
        await autosave()
      })
    },
    [client, guard, autosave, snapshot],
  )

  const skipSim = useCallback(() => {
    skipRef.current = true
  }, [])

  const setAutoLineup = useCallback(
    async (on: boolean) => {
      await client.manager('setAutoLineup', on)
      setSnapshot((s) => (s ? { ...s, state: { ...s.state, autoLineup: on } } : s))
      await autosave()
    },
    [client, autosave],
  )

  // One refresh for every screen that changes the game without playing a day: a trade, a draft
  // pick, a signing, a change of tactics.
  const refresh = useCallback(async () => {
    setSnapshot(await client.snapshot())
    await autosave()
  }, [client, autosave])

  const value = useMemo<Store>(
    () => ({
      client,
      snapshot,
      game,
      teams,
      teamById: new Map(teams.map((t) => [t.teamId, t])),
      busy,
      error,
      hasAutosave,
      screen,
      setScreen,
      startGame,
      resume,
      advance,
      advanceTo,
      skipSim,
      setAutoLineup,
      refresh,
      quitToMenu: () => {
        setSnapshot(null)
        setGame(null)
      },
      exportSave: () => client.save(),
      dismissError: () => setError(null),
    }),
    [
      client,
      snapshot,
      game,
      teams,
      busy,
      error,
      hasAutosave,
      screen,
      startGame,
      resume,
      advance,
      advanceTo,
      skipSim,
      setAutoLineup,
      refresh,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
