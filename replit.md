# Hoops Dynasty on Replit

## Run

Use the **Start application** workflow. It installs npm dependencies when needed, then runs the
Vite web app on `0.0.0.0:5000` for Replit Preview.

The season bundles are served from `data/bundles`. Set `HOOPS_DATA_DIR` only when using a different
data directory.

## Checks

```bash
npm run build
npm test
npm run typecheck
npx biome check .
```
