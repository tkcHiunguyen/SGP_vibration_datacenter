# SGP Vibration Datacenter

<p align="right">
  <a href="./README.md"><img alt="Vietnamese" src="https://img.shields.io/badge/Language-Vietnamese-lightgrey"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue"></a>
</p>

## Overview

SGP Vibration Datacenter is a vibration monitoring system for physical datacenter devices. It receives realtime data from devices over Socket.IO, persists telemetry to MySQL when a database is configured, streams realtime updates to the dashboard, and exposes operational APIs for devices, zones, alerts, commands, and OTA.

The repository is a `pnpm` monorepo with two main applications:

| Component | Stack | Role |
| --- | --- | --- |
| `server` | Fastify, Socket.IO, MySQL | Backend API, realtime gateway, telemetry persistence, device/alert/command/OTA management. |
| `server/client` | React, Vite | Dashboard for devices, telemetry, vibration charts, temperature, spectrum data, and operational workflows. |

When the server is running, the main endpoints are:

| Endpoint | Meaning |
| --- | --- |
| `/api/*` | API for the dashboard and operational workflows. |
| `/socket.io` | Realtime channel for physical devices and dashboard clients. |
| `/health` | Server health check. |
| `/app/` | Production dashboard after the web app is built. |
| `/socket-info` | Quick Socket.IO path and event reference. |

## Physical Device Data Flow

1. A device connects to Socket.IO at `http://<server-ip>:8080/socket.io` with `clientType=device` and `deviceId`.
2. The server validates the token when `DEVICE_AUTH_TOKEN` is configured, then returns `device:ack`.
3. The device emits `device:metadata`, `device:heartbeat`, `device:telemetry`, and spectrum frames through `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`.
4. The server normalizes the data, updates online/heartbeat state, persists telemetry/spectrum, and evaluates alert rules.
5. The dashboard connects with `clientType=dashboard` and receives realtime updates through `telemetry`, `telemetry:spectrum`, `device:heartbeat`, `device:metadata`, and `alert`.
6. When the dashboard sends an operational command, the server emits `device:command` to the online device; the device confirms with `device:command:ack`.

## Prerequisites

Install these tools before running the project:

- Node.js 20 or newer.
- pnpm 10.x. This repository declares `pnpm@10.32.1`.
- MySQL 8.x or a compatible database when durable persistence is required.
- Git.

If pnpm is not installed, enable it through Corepack:

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

## Server Configuration

Create the server environment file:

```bash
cp server/.env.example server/.env
```

Minimal `server/.env` example:

```dotenv
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
MYSQL_URL=mysql://root@127.0.0.1:3306/sgp_vibration_datacenter
DB_FALLBACK_ON_UNAVAILABLE=true
TELEMETRY_RETENTION_HOURS=168
SPECTRUM_STORAGE_DIR=storage/spectrum
```

Important details:

- `HOST=0.0.0.0` lets devices on the same LAN reach the backend by the server machine IP.
- Physical devices must not call `localhost` for the server. On firmware, `localhost` means the device itself. Use the server machine IP or domain, for example `http://192.168.1.10:8080`.
- Without MySQL, the server runs in demo/in-memory mode for quick checks; production/persistent mode needs MySQL to keep telemetry, metadata, audit, and command state after restarts.
- If MySQL is configured but the service/database is unavailable, the server falls back to `in-memory` by default so the dashboard/UI can still load; set `DB_FALLBACK_ON_UNAVAILABLE=false` for production fail-fast behavior.
- If `DEVICE_AUTH_TOKEN` is set, firmware must send the same token during the Socket.IO handshake.

Create the MySQL database when durable persistence is needed:

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS sgp_vibration_datacenter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

If devices need to download OTA binaries from the server, set a reachable URL:

```dotenv
OTA_PUBLIC_BASE_URL=http://192.168.1.10:8080
```

If device authentication is required:

```dotenv
DEVICE_AUTH_TOKEN=replace-with-a-real-device-token
```

## Install Dependencies

Run from the repository root:

```bash
pnpm install
```

After installation, the root `postinstall` script runs `pnpm db:init`. If MySQL is configured and available, the schema is created or updated. If MySQL is not configured, or MySQL is unavailable with the default fallback mode, the script prints a skip message.

## Run in Development

Run server and web together:

```bash
pnpm dev
```

Default services:

| Service | URL |
| --- | --- |
| Server | `http://localhost:8080` |
| Server + dashboard dev | `http://localhost:8080/app/` |
| Health check | `http://localhost:8080/health` |

In dev mode, `server/client` runs Vite build watch and writes assets into `server/public/app`; Fastify serves the dashboard directly at `/app/`.

Run each side separately if needed:

```bash
pnpm -C server dev
pnpm -C server/client dev
```

## Connect Physical Devices

Devices connect to the Socket.IO server URL that is reachable from the device:

```text
http://<server-lan-ip>:8080
```

The handshake must send these fields through `auth` or the query string:

| Field | Required | Meaning |
| --- | --- | --- |
| `clientType` | Yes | Must be `device` for physical devices. |
| `deviceId` | Yes | Unique device ID, for example `esp-001`. |
| `token` | When `DEVICE_AUTH_TOKEN` is set | Device authentication token. |

Socket.IO client example:

```ts
import { io } from "socket.io-client";

const socket = io("http://192.168.1.10:8080", {
  transports: ["websocket"],
  auth: {
    clientType: "device",
    deviceId: "esp-001",
    token: "replace-with-a-real-device-token",
  },
});
```

A successful connection receives:

```json
{ "ok": true, "deviceId": "esp-001" }
```

on the `device:ack` event.

On failure, the server can return `device:error` with:

- `missing_device_id`: `deviceId` is missing.
- `unauthorized`: the token does not match `DEVICE_AUTH_TOKEN`.

## Device Events Sent to the Server

### `device:metadata`

Send this when the device boots or when metadata changes.

```json
{
  "uuid": "esp32-uuid-001",
  "name": "ESP Vibration 001",
  "site": "SGP",
  "zone": "Rack-A1",
  "firmwareVersion": "1.0.0",
  "notes": "Main rack sensor"
}
```

The server also accepts an envelope:

```json
{
  "metadata": {
    "firmware": "1.0.0"
  }
}
```

### `device:heartbeat`

Send periodically so the dashboard can show the device as online.

```json
{
  "socketConnected": true,
  "staConnected": true,
  "signal": -62,
  "uptimeSec": 3600
}
```

### `device:telemetry`

Send the main telemetry sample. Extra fields are kept in the payload, while MySQL currently persists these core fields: `temperature`, `vibration`, `ax`, `ay`, `az`, `sample_count`, `telemetry_uuid`.

```json
{
  "messageId": "esp-001-1713938400000",
  "telemetry_uuid": "esp-001-1713938400000",
  "temperature": 31.2,
  "vibration": 0.23,
  "ax": 0.01,
  "ay": -0.02,
  "az": 1.03,
  "sample_count": 1024
}
```

`telemetry_uuid` should be stable and unique per device sample so telemetry can be linked with spectrum frames and duplicate storage writes can be avoided. If the device needs ingress-level dedupe, also send one of `messageId`, `sequence`, or `seq`; those fields are checked within `TELEMETRY_DEDUPE_WINDOW_MS`.

### `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`

Send spectrum data per axis. A numeric JSON array is accepted:

```json
{
  "telemetry_uuid": "esp-001-1713938400000",
  "sample_rate_hz": 3200,
  "source_sample_count": 1024,
  "bin_count": 512,
  "bin_hz": 3.125,
  "value_scale": 256,
  "magnitude_unit": "m/s2",
  "values": [12, 18, 20, 15]
}
```

The device may also send metadata as the first payload and a binary `Uint8Array`/buffer as the second payload. Binary data is decoded as unsigned 16-bit little-endian values. If `value_scale` is omitted, the server scales binary values by `256`.

## Commands from Dashboard to Device

When the dashboard/API sends a command, the device receives:

```text
device:command
```

The payload always includes at least:

```json
{
  "commandId": "cmd-123",
  "command": "restart",
  "type": "restart",
  "deviceId": "esp-001"
}
```

After handling the command, the device should acknowledge it:

```json
{
  "commandId": "cmd-123",
  "status": "ok",
  "detail": "restarted",
  "deviceId": "esp-001",
  "firmwareVersion": "1.0.1"
}
```

through:

```text
device:command:ack
```

If a device has just reconnected and wants the most recent command, emit:

```text
device:request-last-command
```

The server re-emits `device:command` when the most recent command belongs to the same `deviceId`.

## Verify Installation

Check the server:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/socket-info
```

Check build and TypeScript:

```bash
pnpm build
pnpm typecheck
```

Each `pnpm build` also exports the current MySQL bootstrap schema to:

```text
docs/database/mysql-schema.sql
```

Run server tests:

```bash
pnpm -C server test
```

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
pnpm start
```

Then open the production dashboard:

```text
http://localhost:8080/app/
```

For production-like environments, configure at least:

- `NODE_ENV=production`.
- `PORT`.
- `HOST`.
- `MYSQL_URL` or individual `MYSQL_*` variables.
- `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` with non-default secrets.
- `DEVICE_AUTH_TOKEN` if physical devices must authenticate.
- `OTA_PUBLIC_BASE_URL` if OTA dispatch is used.

## Important Environment Variables

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP server port, default `8080`. |
| `HOST` | Bind address, default `0.0.0.0`. |
| `MYSQL_URL` | Recommended MySQL connection string. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Alternative split MySQL config. |
| `DB_AUTO_INIT` | Set `false` to disable automatic schema initialization. |
| `DB_FALLBACK_ON_UNAVAILABLE` | Defaults to `true`: run `in-memory` when MySQL is unavailable so the UI still works; set `false` to fail fast. |
| `DEVICE_AUTH_TOKEN` | Token for device Socket.IO clients. |
| `COMMAND_TIMEOUT_MS` | Timeout while waiting for device command acknowledgements. |
| `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` | Static role tokens for API/dashboard; defaults are for local use only. |
| `AUTH_BYPASS_GATING` | Controls auth gating. |
| `TELEMETRY_RETENTION_HOURS` | Telemetry retention window, default `168` hours. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | Telemetry dedupe window for each device's `messageId`, `sequence`, or `seq`. |
| `TELEMETRY_MAX_PER_DEVICE_PER_MINUTE` | Per-device telemetry rate limit. |
| `TELEMETRY_MAX_GLOBAL_PER_MINUTE` | Global telemetry rate limit. |
| `SPECTRUM_STORAGE_DIR` | Spectrum storage directory, default `storage/spectrum`. |
| `SPECTRUM_FRAME_FLUSH_MS` | Spectrum frame storage flush interval. |
| `SPECTRUM_MATCH_WINDOW_MS` | Time window used to match telemetry with spectrum when `telemetry_uuid` is missing. |
| `OTA_PUBLIC_BASE_URL` | Public/LAN base URL for OTA binary downloads. |

## Common Commands

| Command | Meaning |
| --- | --- |
| `pnpm install` | Install dependencies and run DB init. |
| `pnpm dev` | Run server and web dev servers together. |
| `pnpm -C server dev` | Run only the Fastify server. |
| `pnpm -C server/client dev` | Run only the Vite build watch for the dashboard. |
| `pnpm build` | Build web, build server, and export SQL schema to `docs/database/mysql-schema.sql`. |
| `pnpm typecheck` | Type-check the dashboard and server. |
| `pnpm -C server test` | Run server tests. |
| `pnpm -C server db:init` | Initialize MySQL schema when MySQL is configured. |
| `pnpm db:schema:export` | Export the MySQL bootstrap schema to `docs/database/mysql-schema.sql`. |
| `pnpm start` | Run the server from compiled output. |
| `pnpm perf:lighthouse` | Build and run Lighthouse checks. |

## Troubleshooting

- `db:init skipped`: MySQL is not configured. This is acceptable for quick local checks, but physical deployments should configure MySQL.
- `/health` returns `persistence.mode="in-memory"` and `reason="unavailable"`: the server is running degraded because MySQL/database is unavailable; the UI still works, but data is not durable after restart.
- Device cannot connect: verify the server is bound to `HOST=0.0.0.0`, firewall allows port `8080`, firmware uses a real IP/domain instead of `localhost`, and `deviceId` is not empty.
- Device receives `unauthorized`: the firmware token does not match `DEVICE_AUTH_TOKEN`.
- Device is online but telemetry is not visible: verify the device emits `device:telemetry`, payload fields are valid numbers, `/health` shows connected devices, and dashboard filters are not hiding the device/zone.
- Spectrum is not visible: verify the axis event is `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, or `device:telemetry:zspectrum`; payload contains `values` or a binary attachment; `telemetry_uuid` should match the main telemetry sample.
- Cannot open the dashboard at `localhost:8080/app/` during dev: make sure `pnpm dev` is running, or run `pnpm build` first if you only need production assets.
- Dashboard does not update during dev: make sure `pnpm -C server/client dev` is running to rebuild assets and `pnpm -C server dev` is running on port `8080`.
- OTA download fails on physical devices: do not use `localhost` in `OTA_PUBLIC_BASE_URL`; use the machine IP or a domain reachable by the device.
- MySQL connection fails: verify that the database exists, credentials are correct, and MySQL accepts TCP connections on the configured host/port.
