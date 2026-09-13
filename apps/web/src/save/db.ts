/** IndexedDB autosave. One slot per save name; 'autosave' is the one the app writes on its own. */
import type { SaveFile } from '../sim/api.ts'

const DB_NAME = 'hoops-dynasty'
const STORE = 'saves'
const AUTOSAVE = 'autosave'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb open failed'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('indexeddb request failed'))
        t.oncomplete = () => db.close()
      }),
  )
}

export const saves = {
  put: (save: SaveFile, slot = AUTOSAVE) => tx('readwrite', (s) => s.put(save, slot)),
  get: (slot = AUTOSAVE) => tx<SaveFile | undefined>('readonly', (s) => s.get(slot)),
  remove: (slot = AUTOSAVE) => tx('readwrite', (s) => s.delete(slot)),
  slots: () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()),
}

export function downloadSave(save: SaveFile): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hoops-dynasty-${save.yearEnd}-${save.userTeamId}-${save.savedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function readSaveFile(file: File): Promise<SaveFile> {
  const text = await file.text()
  const parsed = JSON.parse(text) as SaveFile
  if (parsed?.format !== 'hoops-dynasty-save') throw new Error('not a Hoops Dynasty save file')
  return parsed
}
