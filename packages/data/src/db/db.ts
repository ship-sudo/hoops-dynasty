// Open the sqlite database and apply the schema. node:sqlite, no native deps.

import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { DB_PATH } from '../paths.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

export type SqlValue = string | number | null
export type SqlRow = Record<string, SqlValue>

export function openDb(file: string = DB_PATH): DatabaseSync {
  mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;')
  db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'))
  return db
}

/** Prepare an insert once; call `.run(...row)` per row. Pair with `transaction`. */
export function prepareInsert(
  db: DatabaseSync,
  table: string,
  cols: readonly string[],
  mode: 'INSERT OR REPLACE' | 'INSERT OR IGNORE' = 'INSERT OR REPLACE',
): StatementSync {
  return db.prepare(
    `${mode} INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  )
}

/** Run `fn` inside one transaction. Rolls back on throw. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Insert many rows in one transaction. `cols` order must match each row array. */
export function insertMany(
  db: DatabaseSync,
  table: string,
  cols: readonly string[],
  rows: readonly (readonly SqlValue[])[],
  mode: 'INSERT OR REPLACE' | 'INSERT OR IGNORE' = 'INSERT OR REPLACE',
): number {
  if (rows.length === 0) return 0
  const stmt = prepareInsert(db, table, cols, mode)
  transaction(db, () => {
    for (const r of rows) stmt.run(...(r as SQLInputValue[]))
  })
  return rows.length
}

export function count(
  db: DatabaseSync,
  table: string,
  where = '',
  params: (string | number)[] = [],
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM ${table} ${where ? `WHERE ${where}` : ''}`)
    .get(...params) as { c: number }
  return row.c
}

/** All rows of a query, typed by the caller. */
export function all<T = SqlRow>(db: DatabaseSync, sql: string, params: SqlValue[] = []): T[] {
  return db.prepare(sql).all(...params) as T[]
}

/** First row of a query or undefined. */
export function one<T = SqlRow>(
  db: DatabaseSync,
  sql: string,
  params: SqlValue[] = [],
): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}
