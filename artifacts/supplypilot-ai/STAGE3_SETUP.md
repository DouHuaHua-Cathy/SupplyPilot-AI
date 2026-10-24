# SupplyPilot AI Stage 3 — local setup

## Prerequisites

- Windows PowerShell
- Node.js 22 or newer (the current workspace runtime is Node 24)
- pnpm 11
- Replit AI Integrations with OpenAI enabled (no external API key)

The Express API uses Replit-managed OpenAI credentials and requests the fixed `gpt-5-mini` model with strict JSON Schema output. Each AI analysis uses Replit credits according to provider token pricing; the local rule-based mode makes no model request. The API applies a 60-second timeout, one request per analysis, and no automatic retries. `SUPPLIER_AI_DAILY_LIMIT` sets the shared per-process daily AI request cap (default: 25; set to `0` to disable AI).

## Install on Windows

From the repository root, install exactly from the workspace lockfile:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
```

`--ignore-scripts` avoids the repository's Unix `sh`-based root `preinstall` on Windows. If esbuild reports that its platform binary is missing, run the existing package installer once:

```powershell
node artifacts/api-server/node_modules/esbuild/install.js
```

## Start the API server

In PowerShell terminal 1, configure the Replit AI Integrations environment variables on the server. In Replit, these are managed by the integration setup. Do not copy them into `VITE_*` variables, React code, browser storage, or Git. Build and start the API:

```powershell
$env:PORT = '5000'
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

## Start the frontend

In PowerShell terminal 2:

```powershell
$env:PORT = '5173'
$env:BASE_PATH = '/'
$env:API_BASE_URL = 'http://127.0.0.1:5000'
pnpm --filter @workspace/supplypilot-ai run dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to Express. The browser never receives AI credentials. If Express/Replit AI Integrations is unavailable, the app explains the issue and creates an explicitly labeled rule-based result. Selecting `Rule-based demo (offline)` sends no model request.

## Manual demonstration

1. Leave analysis mode on **OpenAI · Replit AI Integrations** and analyze synthetic supplier text. Confirm this source label appears only when the API returned a valid Zod/schema-checked result; otherwise inspect the rule-based fallback notice. The server diagnostic may include the selected model ID.
2. Try confirmation, negation (for example, “We cannot supply 20kg flour”), multiple quantities/dates, and an incomplete reply. Facts remain evidence-only and PO comparisons remain deterministic.
3. Select **Rule-based demo (offline)** to demonstrate without a key or network connection.
4. Edit the draft, save it, and verify the edit appears in Activity Log.
5. As Staff, verify decision controls are disabled. Switch to the explicitly simulated Owner role, approve or reject, then refresh and verify status/activity persist.
6. For an approved review, copy the approved message and verify the UI says it was copied; no supplier message is sent automatically.

## Checks

```powershell
pnpm --filter @workspace/supplypilot-ai run test
pnpm --filter @workspace/api-server run test
pnpm run typecheck
$env:PORT = '5173'; $env:BASE_PATH = '/'; pnpm --filter @workspace/supplypilot-ai run build
pnpm --filter @workspace/api-server run build
```

## Deployment shape and limitations

The existing Replit artifacts provide the deployment shape: static React frontend plus Express API routed under `/api`. Keep the API as a separate server artifact, provision Replit AI Integrations for its runtime, and never expose its managed credentials to the static frontend. Do not deploy the frontend alone if AI analysis is needed. If frontend and API use different origins, set `CORS_ORIGINS` to the comma-separated exact frontend origins; in a same-origin Replit route, leave it unset. The current 12-request/minute in-memory limit is demo protection only, not a production abuse-control boundary.

The Staff/Owner role selector is simulated client-side access control. Review history and extracted evidence are stored in that browser's localStorage and can be changed or cleared by its user. Neither the role selector nor localStorage is production authentication or a server-side audit system.
