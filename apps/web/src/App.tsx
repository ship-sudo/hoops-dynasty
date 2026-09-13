import { useCallback, useEffect, useState } from 'react'
import { downloadSave, readSaveFile } from './save/db.ts'
import { AllStar } from './screens/AllStar.tsx'
import { Awards } from './screens/Awards.tsx'
import { BoxScoreHost } from './screens/BoxScore.tsx'
import { Dynasty } from './screens/Dynasty.tsx'
import { History } from './screens/History.tsx'
import { Home } from './screens/Home.tsx'
import { League } from './screens/League.tsx'
import { NewGame } from './screens/NewGame.tsx'
import { Offseason } from './screens/Offseason.tsx'
import { Playoffs } from './screens/Playoffs.tsx'
import { Roster } from './screens/Roster.tsx'
import { Schedule } from './screens/Schedule.tsx'
import { Staff } from './screens/Staff.tsx'
import { Standings } from './screens/Standings.tsx'
import { Tactics } from './screens/Tactics.tsx'
import { Trade } from './screens/Trade.tsx'
import { useStore } from './store.tsx'
import { longDate } from './ui/format.ts'
import { InjuryPause } from './ui/InjuryPause.tsx'
import { ALL_DESTS, GameNav, SaveMenu } from './ui/Nav.tsx'
import {
  applyTeamAccent,
  readThemeChoice,
  resolveTheme,
  type ThemeChoice,
  writeThemeChoice,
} from './ui/theme.ts'


/**
 * Light, dark, or whatever the machine is set to. Stored, so a save opened tomorrow morning looks
 * the way it did last night.
 */
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice())
  const theme = resolveTheme(choice)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.style.background = ''
  }, [theme])
  useEffect(() => {
    if (choice !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const on = () => setChoice('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [choice])
  const cycle = useCallback(() => {
    setChoice((c) => {
      const next: ThemeChoice = c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system'
      writeThemeChoice(next)
      return next
    })
  }, [])
  return { choice, theme, cycle }
}

function Shell() {
  const {
    snapshot,
    teamById,
    screen,
    setScreen,
    advance,
    busy,
    error,
    dismissError,
    exportSave,
    resume,
    quitToMenu,
  } = useStore()

  const onImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (file) await resume(await readSaveFile(file))
    }
    input.click()
  }, [resume])

  // Keyboard: 1–4 switch screens, space continues.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (document.querySelector('.modal-backdrop')) return
      const hit = ALL_DESTS.find((d) => d.key === e.key)
      if (hit) {
        e.preventDefault()
        setScreen(hit.id)
        return
      }
      if ((e.key === ' ' || e.key === 'Enter') && !busy && !snapshot?.state.seasonComplete) {
        e.preventDefault()
        void advance(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setScreen, advance, busy, snapshot])

  const team = snapshot ? teamById.get(snapshot.state.userTeamId) : undefined
  const { choice, theme, cycle } = useTheme()

  // The accent of the whole interface is the club you manage. Back at the menu, it is the game's.
  useEffect(() => {
    applyTeamAccent(team?.abbr, theme)
  }, [team, theme])

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span>Hoops Dynasty</span>
        </span>
        {snapshot ? (
          <>
            <GameNav screen={screen} onGo={setScreen} />
            <span className="spacer" />
            <span className="clock">
              <span className="club">{team ? `${team.city} ${team.name}` : ''}</span>
              <span className="date">
                {longDate(snapshot.state.date)}
                {busy ? <span className="simming"> · simulating {busy.label}</span> : null}
              </span>
            </span>
            <button
              type="button"
              className="ghost iconbtn"
              title={`Theme: ${choice}. Click to change.`}
              aria-label={`Theme: ${choice}`}
              onClick={cycle}
            >
              {choice === 'system' ? '◐' : choice === 'light' ? '☀' : '☾'}
            </button>
            <SaveMenu
              onExport={() => {
                void exportSave().then(downloadSave)
              }}
              onImport={() => void onImport()}
              onQuit={quitToMenu}
            />
          </>
        ) : (
          <>
            <span className="spacer" />
            <button
              type="button"
              className="ghost iconbtn"
              title={`Theme: ${choice}. Click to change.`}
              aria-label={`Theme: ${choice}`}
              onClick={cycle}
            >
              {choice === 'system' ? '◐' : choice === 'light' ? '☀' : '☾'}
            </button>
          </>
        )}
      </header>

      <main className="content">
        {error ? (
          <div className="banner">
            <span>{error}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="ghost" onClick={dismissError}>
              Dismiss
            </button>
          </div>
        ) : null}
        {!snapshot ? (
          <NewGame />
        ) : screen === 'home' ? (
          <Home />
        ) : screen === 'league' ? (
          <League />
        ) : screen === 'awards' ? (
          <Awards />
        ) : screen === 'allstar' ? (
          <AllStar />
        ) : screen === 'playoffs' ? (
          <Playoffs />
        ) : screen === 'standings' ? (
          <Standings />
        ) : screen === 'roster' ? (
          <Roster />
        ) : screen === 'tactics' ? (
          <Tactics />
        ) : screen === 'staff' ? (
          <Staff />
        ) : screen === 'trade' ? (
          <Trade />
        ) : screen === 'offseason' ? (
          <Offseason />
        ) : screen === 'dynasty' ? (
          <Dynasty />
        ) : screen === 'history' ? (
          <History />
        ) : (
          <Schedule />
        )}
      </main>
      {snapshot ? <InjuryPause /> : null}
    </div>
  )
}

export function App() {
  return (
    <BoxScoreHost>
      <Shell />
    </BoxScoreHost>
  )
}
