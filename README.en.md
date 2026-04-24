# SGP Vibration Datacenter

<p align="right">
  <a href="./README.md"><img alt="Vietnamese" src="https://img.shields.io/badge/Language-Vietnamese-lightgrey"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue"></a>
</p>

## Overview

SGP Vibration Datacenter is a vibration monitoring system for datacenter devices. The project is a `pnpm` monorepo with two main apps:

- `server`: Fastify API server, Socket.IO realtime gateway, telemetry persistence, device management, alerts, incidents, zones, rollouts, OTA, and metrics.
- `web`: React/Vite dashboard for telemetry, vibration charts, temperature, spectrum data, device state, and operational workflows.

At runtime, the server exposes:

- HTTP APIs at `/api/*`
- Socket.IO at `/socket.io`
- health checks at `/health`, `/health/live`, `/health/ready`
- Prometheus metrics at `/metrics`
- production dashboard at `/app/`

## Prerequisites

Install these tools before running the project:

- Node.js 20 or newer
- pnpm 10.x, this repository declares `pnpm@10.32.1`
- MySQL 8.x or a compatible database, recommended for durable persistence
- Git

If pnpm is not installed, enable it through Corepack:

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

## Environment Setup

Create the server environment file:

```bash
cp server/.env.example server/.env
```

For quick local development, MySQL variables can be left empty. The server will skip schema initialization and use local/in-memory fallback behavior for some data.

For durable persistence, create a MySQL database:

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS sgp_vibration_datacenter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Example `server/.env`:

```dotenv
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
MYSQL_URL=mysql://root@127.0.0.1:3306/sgp_vibration_datacenter
TELEMETRY_RETENTION_HOURS=168
SPECTRUM_STORAGE_DIR=storage/spectrum
```

If ESP devices or other LAN machines need to download OTA binaries, set a reachable URL:

```dotenv
OTA_PUBLIC_BASE_URL=http://192.168.1.10:8080
```

If device Socket.IO authentication is required:

```dotenv
DEVICE_AUTH_TOKEN=replace-with-a-local-dev-token
```

## Install Dependencies

Run from the repository root:

```bash
pnpm install
```

After installation, the root `postinstall` script runs `pnpm db:init`. If MySQL is configured, the schema is created or updated. If MySQL is not configured, the script prints a skip message.

## Run in Development

Run server and web together:

```bash
pnpm dev
```

Default services:

- server: `http://localhost:8080`
- Vite web dev server: `http://localhost:5173`

During development, open the dashboard at:

```text
http://localhost:5173/app/
```

Vite proxies `/api`, `/health`, and `/socket.io` to the server on port `8080`.

Run each side separately if needed:

```bash
pnpm dev:server
pnpm dev:web
```

## Verify Installation

Check the server:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/health/ready
```

Check build and TypeScript:

```bash
pnpm build
pnpm typecheck
```

Run server tests:

```bash
pnpm -C server test
```

## Simulate Devices

After the server is running, start simulated devices:

```bash
pnpm -C server simulate:devices -- --url http://localhost:8080 --count 5 --interval 1000
```

If `DEVICE_AUTH_TOKEN` is set, pass the same token:

```bash
pnpm -C server simulate:devices -- --url http://localhost:8080 --count 5 --token replace-with-a-local-dev-token
```

Useful options:

- `--count`: number of simulated devices
- `--interval`: telemetry interval in milliseconds
- `--heartbeat`: heartbeat interval in milliseconds
- `--duration`: auto-stop after N seconds
- `--ramp-step`: stagger device startup by N milliseconds

## Production Build

Build web and server:

```bash
pnpm build
```

The web build is emitted to:

```text
server/public/app
```

Run the compiled server:

```bash
pnpm -C server start:prod
```

Then open:

```text
http://localhost:8080/app/
```

For production-like environments, configure at least:

- `NODE_ENV=production`
- `PORT`
- `HOST`
- `MYSQL_URL` or individual `MYSQL_*` variables
- `AUTH_*` tokens with non-default secrets
- `DEVICE_AUTH_TOKEN` if physical devices must authenticate
- `OTA_PUBLIC_BASE_URL` if OTA dispatch is used

## Important Environment Variables

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP server port, default `8080`. |
| `HOST` | Bind address, default `0.0.0.0`. |
| `MYSQL_URL` | Recommended MySQL connection string. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Alternative split MySQL config. |
| `DB_AUTO_INIT` | Set `false` to disable automatic schema initialization. |
| `DEVICE_AUTH_TOKEN` | Optional token for device Socket.IO clients. |
| `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` | Static role tokens for API/dashboard; defaults are for local use only. |
| `AUTH_BYPASS_GATING` | Defaults to `true`, controls auth gating. |
| `TELEMETRY_RETENTION_HOURS` | Telemetry retention window, default `168` hours. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | Dedupe window for telemetry ingress. |
| `TELEMETRY_MAX_PER_DEVICE_PER_MINUTE` | Per-device telemetry rate limit. |
| `TELEMETRY_MAX_GLOBAL_PER_MINUTE` | Global telemetry rate limit. |
| `SPECTRUM_STORAGE_DIR` | Spectrum storage directory, default `storage/spectrum`. |
| `OTA_PUBLIC_BASE_URL` | Public/LAN base URL for OTA binary downloads. |

## Common Commands

| Command | Meaning |
| --- | --- |
| `pnpm install` | Install dependencies and run DB init. |
| `pnpm dev` | Run server and web dev servers together. |
| `pnpm dev:server` | Run only the Fastify server. |
| `pnpm dev:web` | Run only the Vite web app. |
| `pnpm build` | Build web then server. |
| `pnpm typecheck` | Type-check the server. |
| `pnpm -C server test` | Run server tests. |
| `pnpm -C server db:init` | Initialize MySQL schema when MySQL is configured. |
| `pnpm -C server simulate:devices` | Start Socket.IO device simulator. |
| `pnpm perf:lighthouse` | Build and run Lighthouse checks. |

## Troubleshooting

- `db:init skipped`: MySQL is not configured. This is acceptable for quick local development.
- Cannot open the dashboard at `localhost:8080/app/` during dev: run `pnpm build` first, or use Vite at `http://localhost:5173/app/`.
- Vite cannot reach the API: make sure `pnpm dev:server` is running on port `8080`.
- Device simulator connects but no telemetry appears: check `DEVICE_AUTH_TOKEN`, dashboard filters, and `/health` connected device count.
- OTA download fails on physical devices: do not use `localhost` in `OTA_PUBLIC_BASE_URL`; use the machine IP or a domain reachable by the device.
- MySQL connection fails: verify that the database exists, credentials are correct, and MySQL accepts TCP connections on the configured host/port.
