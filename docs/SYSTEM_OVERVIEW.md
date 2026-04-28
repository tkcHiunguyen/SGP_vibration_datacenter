# SGP Vibration Datacenter - System Overview

## How To Read This Repo

This project is now a single deployable app that runs on port `8080`.

```text
server/
  src/                 Backend source: API, socket.io, persistence, services
  client/              Frontend React/Vite source
  public/app/          Built frontend served by Fastify
  uploads/             Runtime OTA files, ignored by git
  storage/             Runtime local storage, ignored by git
scripts/               Repo tooling only, not app runtime
```

## Runtime Flow

```text
Browser http://localhost:8080
  -> Fastify server (`server/src/index.ts`)
  -> Static app shell from `server/public/app`
  -> API routes from `server/src/modules/http/register-routes.ts`
  -> Realtime events through Socket.IO gateway/handlers
  -> Services and repositories under `server/src/modules/*`
```

## Main Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run Fastify on port `8080` and Vite build watch for `server/client` in parallel. |
| `pnpm build` | Build frontend into `server/public/app`, compile backend to `server/dist`, then export `docs/database/mysql-schema.sql`. |
| `pnpm start` | Run compiled backend from `server/dist`. Run `pnpm build` first. |
| `pnpm typecheck` | Typecheck backend and frontend. |
| `pnpm test` | Run backend tests. |
| `pnpm db:init` | Initialize DB schema if DB env is configured. |
| `pnpm db:schema:export` | Export the MySQL bootstrap schema from source to `docs/database/mysql-schema.sql`. |
| `pnpm arch:generate` | Refresh architecture JSON and Mermaid artifacts under `docs/architecture`. |

## Dependency Layout

The workspace uses pnpm with `node-linker=hoisted` in `.npmrc`, so dependencies are hoisted to the root `node_modules` as much as possible. Pnpm may still create tiny package-level `node_modules` folders for package-local bins/links; these are install artifacts, not separate dependency sets to maintain manually.

## Backend Modules

| Module | Role | Keep/Risk Notes |
| --- | --- | --- |
| `auth` | Auth config/service helpers used by HTTP routes. | Keep if API auth is active. |
| `device` | Device registry, metadata, online state, safe hard-delete impact checks. | Core; list reads all rows present in `devices` so operators can hard-delete stale records. |
| `telemetry` | Telemetry ingestion/query/persistence. | Core. |
| `spectrum` | FFT/spectrum frame storage and lookup. | Core if spectrum charts are used. |
| `realtime` | Socket.IO gateway and device/client event handlers. | Core. |
| `http` | REST API route registration and app shell routes. | Core. |
| `zone` | Zone CRUD and metadata. | Keep if zone management UI is used. |
| `command` | Device command dispatch/timeout state. | Keep if OTA/commands are used. |
| `alert` | Alert creation/state. | Keep if dashboard alerts are used. |
| `audit` | Audit trail for mutations/events. | Candidate only if audit UI/API is not needed. |
| `persistence` | MySQL access/schema utilities. | MySQL is active; legacy Postgres runtime files were removed. |
| `reliability` | Telemetry ingress guard/rate limits/dedupe. | Keep for device data safety. |

## Frontend Areas

| Area | Files | Purpose |
| --- | --- | --- |
| App shell | `server/client/src/App.tsx`, `MainPanel.tsx`, `TopHeader.tsx`, `LeftPanel.tsx` | Navigation/layout. |
| Dashboard/device UI | `DeviceManagement.tsx`, `SensorChartModal.tsx`, `DeviceInfoModal.tsx` | Main monitoring workflow, including safe-delete preview modal. |
| 3D motor page | `Analyze3DPanel.tsx`, `ThreeDPage.tsx`, `MotorSceneCanvas.tsx` | Current motor visualization. |
| OTA | `OtaManagement.tsx` | Update Center UI. |
| Zones | `ZoneManagement.tsx` | Zone management UI. |
| Shared UI | `components/ui/*` | Buttons, modal, toast, page shells. |

## How To Judge A “Trash Module”

Use this order before deleting anything:

1. Check if it is imported by `server/src/index.ts`, `register-routes.ts`, or `socket.handlers.ts`.
2. Check if any route exposes it in `server/src/modules/http/register-routes.ts`.
3. Check if any frontend page calls that route.
4. Check if it owns DB tables or runtime files.
5. Disable route/UI first, then remove service/repository after tests pass.

Safe candidates usually have all of these traits:

- No import from the app entrypoint or route/socket layer.
- No route/UI usage.
- No required DB schema dependency.
- No runtime data you need to preserve.

## Current Cleanup Candidates To Review Manually

These are not deleted automatically because they may encode product decisions:

- `server/src/modules/audit`: remove only if audit history is not required.
- `scripts/perf/*` and Lighthouse dev deps: remove only if you do not run performance audits.

## Removed Legacy Tools

The old device simulator, sprint quality gates, sprint rollout drill, sprint phase-exit check, PostgreSQL-to-MySQL migration command, rollout/fleet/governance/incident modules, and expanded observability routes were removed because they are not part of the current app runtime.
