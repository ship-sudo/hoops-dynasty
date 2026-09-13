/**
 * In-game chrome. Fifteen sibling tabs do not fit a laptop; four groups do.
 *
 * Home stays one click. Everything else hangs off Club, League, or Office. Keyboard shortcuts
 * still jump straight to the old screens — the menus are for the mouse.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Screen } from '../store.tsx'

export type NavDest = { id: Screen; label: string; key: string }

export const NAV_GROUPS: { id: string; label: string; items: NavDest[] }[] = [
  {
    id: 'club',
    label: 'Club',
    items: [
      { id: 'roster', label: 'Roster', key: '3' },
      { id: 'tactics', label: 'Tactics', key: '5' },
      { id: 'schedule', label: 'Schedule', key: '4' },
      { id: 'staff', label: 'Staff', key: '6' },
    ],
  },
  {
    id: 'league',
    label: 'League',
    items: [
      { id: 'standings', label: 'Standings', key: '2' },
      { id: 'league', label: 'Stats', key: 'l' },
      { id: 'awards', label: 'Awards', key: 'a' },
      { id: 'allstar', label: 'All-Star', key: 'g' },
      { id: 'playoffs', label: 'Playoffs', key: 'p' },
    ],
  },
  {
    id: 'office',
    label: 'Office',
    items: [
      { id: 'trade', label: 'Trade desk', key: '7' },
      { id: 'offseason', label: 'Offseason', key: '8' },
      { id: 'dynasty', label: 'Dynasty', key: '9' },
      { id: 'history', label: 'Vs reality', key: '0' },
    ],
  },
]

export const HOME: NavDest = { id: 'home', label: 'Home', key: '1' }

export const ALL_DESTS: NavDest[] = [HOME, ...NAV_GROUPS.flatMap((g) => g.items)]

function Menu({
  label,
  open,
  current,
  onToggle,
  onClose,
  children,
}: {
  label: string
  open: boolean
  current: boolean
  onToggle: () => void
  onClose: () => void
  children: ReactNode
}) {
  const id = useId()
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return (
    <div className="nav-menu" ref={wrap}>
      <button
        type="button"
        className="nav-trigger"
        aria-current={current ? 'true' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={id}
        onClick={onToggle}
      >
        {label}
        <span className="caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="nav-drop" id={id} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function GameNav({
  screen,
  onGo,
}: {
  screen: Screen
  onGo: (id: Screen) => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const close = () => setOpen(null)
  const go = (id: Screen) => {
    onGo(id)
    close()
  }
  return (
    <nav className="nav" aria-label="Game">
      <button
        type="button"
        aria-current={screen === 'home' ? 'true' : undefined}
        onClick={() => go('home')}
        title="Key 1"
      >
        Home
      </button>
      {NAV_GROUPS.map((g) => {
        const here = g.items.some((i) => i.id === screen)
        return (
          <Menu
            key={g.id}
            label={g.label}
            open={open === g.id}
            current={here}
            onToggle={() => setOpen(open === g.id ? null : g.id)}
            onClose={close}
          >
            {g.items.map((i) => (
              <button
                key={i.id}
                type="button"
                role="menuitem"
                aria-current={screen === i.id ? 'true' : undefined}
                onClick={() => go(i.id)}
              >
                <span>{i.label}</span>
                <kbd>{i.key}</kbd>
              </button>
            ))}
          </Menu>
        )
      })}
    </nav>
  )
}

export function SaveMenu({
  onExport,
  onImport,
  onQuit,
}: {
  onExport: () => void
  onImport: () => void
  onQuit: () => void
}) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <Menu
      label="Save"
      open={open}
      current={false}
      onToggle={() => setOpen(!open)}
      onClose={close}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onExport()
          close()
        }}
      >
        Export save
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onImport()
          close()
        }}
      >
        Import save
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onQuit()
          close()
        }}
      >
        Quit to menu
      </button>
    </Menu>
  )
}
