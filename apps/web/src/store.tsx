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
  advance: (days: number) => Promise<void>
  advanceTo: (date: string) => Promise<void>
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
    async (days: number) => {
      await guard(days === 1 ? 'Simulating' : `Simulating ${days} days`, async () => {
        setSnapshot(await client.simDays(days, setBusy))
        await autosave()
      })
    },
    [client, guard, autosave],
  )

  const advanceTo = useCallback(
    async (date: string) => {
      await guard('Simulating', async () => {
        setSnapshot(await client.simToDate(date, setBusy))
        await autosave()
      })
    },
    [client, guard, autosave],
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
