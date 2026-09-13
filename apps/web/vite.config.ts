import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')

/** Season bundles are a few MB each and live in the gitignored data/ dir. Serve them, don't bundle them. */
const dataDir = process.env.HOOPS_DATA_DIR ?? join(repoRoot, 'data')
const bundlesDir = join(dataDir, 'bundles')

/**
 * Serves `/bundles/<yearEnd>.json` straight off disk in dev, and in build writes a manifest so the
 * app knows which seasons exist. Bundles are never emitted into dist; set HOOPS_DATA_DIR and serve
 * them alongside, or use `vite preview`, which reuses this middleware.
 */
function bundleServer(): Plugin {
  const serve = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? ''
    if (!url.startsWith('/bundles/')) return next()
    const name = url.slice('/bundles/'.length).split('?')[0] ?? ''
    if (!/^[a-z0-9]+\.json$/i.test(name)) {
      res.statusCode = 400
      return res.end('bad bundle name')
    }
    const file = join(bundlesDir, name)
    if (!existsSync(file)) {
      res.statusCode = 404
      return res.end(`no bundle at ${file}`)
    }
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.end(readFileSync(file))
  }
  return {
    name: 'hoops-bundle-server',
    configureServer: (s) => {
      s.middlewares.use(serve)
    },
    configurePreviewServer: (s) => {
      s.middlewares.use(serve)
    },
  }
}

const seasonManifest = (): number[] => {
  try {
    if (!statSync(bundlesDir).isDirectory()) return []
  } catch {
    return []
  }
  const years: number[] = []
  for (let y = 1998; y <= 2035; y++) if (existsSync(join(bundlesDir, `${y}.json`))) years.push(y)
  return years
}

export default defineConfig({
  root: here,
  plugins: [react(), bundleServer()],
  define: {
    __SEASONS__: JSON.stringify(seasonManifest()),
  },
  resolve: {
    // Point at the workspace sources directly so Vite compiles the TS rather than trying to
    // pre-bundle a package whose entrypoint is a .ts file.
    alias: {
      '@hoops/core': join(repoRoot, 'packages/core/src/index.ts'),
      '@hoops/engine': join(repoRoot, 'packages/engine/src/index.ts'),
    },
    preserveSymlinks: false,
  },
  optimizeDeps: { exclude: ['@hoops/core', '@hoops/engine'] },
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
    allowedHosts: true,
    fs: { allow: [realpathSync(repoRoot)] },
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    allowedHosts: true,
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2023' },
})
