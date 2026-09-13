import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '../../..')
/** Override with HOOPS_DATA_DIR so worktrees share one raw cache. */
export const DATA_DIR = process.env.HOOPS_DATA_DIR ?? path.join(REPO_ROOT, 'data')
export const RAW_DIR = path.join(DATA_DIR, 'raw')
export const DB_PATH = path.join(DATA_DIR, 'db.sqlite')
export const BUNDLES_DIR = path.join(DATA_DIR, 'bundles')
export const REPORT_PATH = path.join(DATA_DIR, 'REPORT.md')
