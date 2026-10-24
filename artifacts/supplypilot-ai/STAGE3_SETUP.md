# SupplyPilot AI Stage 3 — local setup

## Prerequisites

- Windows PowerShell
- Node.js 22 or newer (the current workspace runtime is Node 24)
- pnpm 11
- An OpenRouter API key with access to free models

The Express API uses the OpenAI-compatible Chat Completions API at `https://openrouter.ai/api/v1/chat/completions`. It requests only `openrouter/free` and strict JSON Schema output, with a 60-second server timeout and 65-second browser timeout. The free router dynamically selects an eligible free model; there is no paid-model fallback or extra provider filter.

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

In PowerShell terminal 1, ensure `OPENROUTER_API_KEY` is set in this process environment. The key is read only by Express and must not be put in a `VITE_*` variable, React code, browser storage, or Git. Build and start the API:

```powershell
$env:PORT = '5000'
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

If you need to enter the key in this session, PowerShell can prompt without echoing it:

```powershell
$secureKey = Read-Host 'OpenRouter API key' -AsSecureString
$env:OPENROUTER_API_KEY = [System.Net.NetworkCredential]::new('', $secureKey).Password
```

## Start the frontend

In PowerShell terminal 2:

```powershell
$env:PORT = '5173'
$env:BASE_PATH = '/'
$env:API_BASE_URL = 'http://127.0.0.1:5000'
pnpm --filter @workspace/supplypilot-ai run dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the Express server. The browser never receives the OpenRouter key. If Express/OpenRouter is unavailable, the app explains the issue and creates an explicitly labeled rule-based result. Selecting `Rule-based demo (offline)` sends no API request.

## Manual demonstration

1. Leave analysis mode on **OpenRouter AI (Free Router)** and analyze synthetic supplier text. Confirm this source label appears only when the API returned a valid schema-checked result; otherwise inspect the rule-based fallback notice. The server diagnostic may include the selected model ID.
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

Deploy the React static build and Express API as separate components or serve them behind one reverse proxy. Route `/api/*` to Express and configure `OPENROUTER_API_KEY` only in the backend environment; a static-only frontend host cannot run this API. If frontend and API use different origins, set `CORS_ORIGINS` to the comma-separated exact frontend origins. In a same-origin reverse-proxy deployment, leave it unset.

The Staff/Owner role selector is simulated client-side access control. Review history and extracted evidence are stored in that browser's localStorage and can be changed or cleared by its user. The in-memory API rate limit resets on restart and is not a substitute for deployment-level abuse protection. Neither the role selector nor localStorage is production authentication or a server-side audit system. OpenRouter free-model availability and rate limits are external and can change; no paid model is selected as fallback.
