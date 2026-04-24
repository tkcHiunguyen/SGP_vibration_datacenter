# SGP Vibration Datacenter

## Tổng quan / Overview

**Tiếng Việt**

SGP Vibration Datacenter là hệ thống giám sát rung động cho thiết bị trong datacenter. Project được tổ chức dạng monorepo `pnpm` với hai phần chính:

- `server`: Fastify API server, Socket.IO realtime gateway, telemetry persistence, quản lý thiết bị, cảnh báo, sự cố, zone, rollout, OTA và metrics.
- `web`: Dashboard React/Vite để quan sát telemetry, biểu đồ rung động, nhiệt độ, phổ tần số, trạng thái thiết bị và các workflow vận hành.

Khi chạy, server cung cấp:

- API HTTP tại `/api/*`
- Socket.IO tại `/socket.io`
- health checks tại `/health`, `/health/live`, `/health/ready`
- Prometheus metrics tại `/metrics`
- dashboard production tại `/app/`

**English**

SGP Vibration Datacenter is a vibration monitoring system for datacenter devices. The project is a `pnpm` monorepo with two main apps:

- `server`: Fastify API server, Socket.IO realtime gateway, telemetry persistence, device management, alerts, incidents, zones, rollouts, OTA, and metrics.
- `web`: React/Vite dashboard for telemetry, vibration charts, temperature, spectrum data, device state, and operational workflows.

At runtime, the server exposes:

- HTTP APIs at `/api/*`
- Socket.IO at `/socket.io`
- health checks at `/health`, `/health/live`, `/health/ready`
- Prometheus metrics at `/metrics`
- production dashboard at `/app/`

## Yêu cầu / Prerequisites

**Tiếng Việt**

Cài các công cụ sau trước khi chạy project:

- Node.js 20 hoặc mới hơn
- pnpm 10.x, repository đang khai báo `pnpm@10.32.1`
- MySQL 8.x hoặc database tương thích, khuyến nghị dùng để lưu dữ liệu bền vững
- Git

Nếu chưa có pnpm, bật qua Corepack:

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

**English**

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

## Cấu hình môi trường / Environment Setup

**Tiếng Việt**

Tạo file môi trường cho server:

```bash
cp server/.env.example server/.env
```

Nếu chỉ cần chạy nhanh để phát triển giao diện hoặc kiểm thử local, có thể để trống các biến MySQL. Server sẽ bỏ qua bước khởi tạo schema và dùng fallback local/in-memory cho một số dữ liệu.

Khuyến nghị tạo MySQL database khi cần dữ liệu bền vững:

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS sgp_vibration_datacenter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Ví dụ `server/.env`:

```dotenv
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
MYSQL_URL=mysql://root@127.0.0.1:3306/sgp_vibration_datacenter
TELEMETRY_RETENTION_HOURS=168
SPECTRUM_STORAGE_DIR=storage/spectrum
```

Nếu thiết bị ESP hoặc máy khác trong LAN cần tải OTA, đặt URL mà thiết bị truy cập được:

```dotenv
OTA_PUBLIC_BASE_URL=http://192.168.1.10:8080
```

Nếu muốn xác thực thiết bị qua Socket.IO:

```dotenv
DEVICE_AUTH_TOKEN=replace-with-a-local-dev-token
```

**English**

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

## Cài dependencies / Install Dependencies

**Tiếng Việt**

Chạy từ root repository:

```bash
pnpm install
```

Sau khi cài, root `postinstall` sẽ chạy `pnpm db:init`. Nếu MySQL đã được cấu hình, schema sẽ được tạo hoặc cập nhật. Nếu chưa cấu hình MySQL, script sẽ in thông báo skip.

**English**

Run from the repository root:

```bash
pnpm install
```

After installation, the root `postinstall` script runs `pnpm db:init`. If MySQL is configured, the schema is created or updated. If MySQL is not configured, the script prints a skip message.

## Chạy môi trường dev / Run in Development

**Tiếng Việt**

Chạy server và web cùng lúc:

```bash
pnpm dev
```

Các service mặc định:

- server: `http://localhost:8080`
- Vite web dev server: `http://localhost:5173`

Khi dev, mở dashboard tại:

```text
http://localhost:5173/app/
```

Vite sẽ proxy `/api`, `/health` và `/socket.io` về server port `8080`.

Chạy riêng từng phần nếu cần:

```bash
pnpm dev:server
pnpm dev:web
```

**English**

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

## Kiểm tra cài đặt / Verify Installation

**Tiếng Việt**

Kiểm tra server:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/health/ready
```

Kiểm tra build và TypeScript:

```bash
pnpm build
pnpm typecheck
```

Chạy test server:

```bash
pnpm -C server test
```

**English**

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

## Giả lập thiết bị / Simulate Devices

**Tiếng Việt**

Sau khi server đã chạy, khởi động thiết bị giả lập:

```bash
pnpm -C server simulate:devices -- --url http://localhost:8080 --count 5 --interval 1000
```

Nếu đã đặt `DEVICE_AUTH_TOKEN`, truyền cùng token:

```bash
pnpm -C server simulate:devices -- --url http://localhost:8080 --count 5 --token replace-with-a-local-dev-token
```

Một số option hữu ích:

- `--count`: số lượng thiết bị giả lập
- `--interval`: chu kỳ gửi telemetry, tính bằng milliseconds
- `--heartbeat`: chu kỳ heartbeat, tính bằng milliseconds
- `--duration`: tự dừng sau N giây
- `--ramp-step`: mỗi thiết bị start lệch nhau N milliseconds

**English**

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

## Build production / Production Build

**Tiếng Việt**

Build web và server:

```bash
pnpm build
```

Web build sẽ được ghi vào:

```text
server/public/app
```

Chạy server đã compile:

```bash
pnpm -C server start:prod
```

Sau đó mở:

```text
http://localhost:8080/app/
```

Với môi trường gần production, nên cấu hình tối thiểu:

- `NODE_ENV=production`
- `PORT`
- `HOST`
- `MYSQL_URL` hoặc các biến `MYSQL_*`
- `AUTH_*` tokens bằng secret riêng, không dùng giá trị mặc định
- `DEVICE_AUTH_TOKEN` nếu thiết bị thật cần xác thực
- `OTA_PUBLIC_BASE_URL` nếu dùng OTA dispatch

**English**

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

## Biến môi trường quan trọng / Important Environment Variables

| Biến / Variable | Tiếng Việt | English |
| --- | --- | --- |
| `PORT` | Port HTTP server, mặc định `8080`. | HTTP server port, default `8080`. |
| `HOST` | Địa chỉ bind, mặc định `0.0.0.0`. | Bind address, default `0.0.0.0`. |
| `MYSQL_URL` | Connection string MySQL khuyến nghị. | Recommended MySQL connection string. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Cấu hình MySQL dạng tách biến. | Alternative split MySQL config. |
| `DB_AUTO_INIT` | Đặt `false` để tắt tự động khởi tạo schema. | Set `false` to disable automatic schema initialization. |
| `DEVICE_AUTH_TOKEN` | Token tùy chọn cho device Socket.IO client. | Optional token for device Socket.IO clients. |
| `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` | Token role tĩnh cho API/dashboard; giá trị mặc định chỉ nên dùng local. | Static role tokens for API/dashboard; defaults are for local use only. |
| `AUTH_BYPASS_GATING` | Mặc định `true`, điều khiển auth gating. | Defaults to `true`, controls auth gating. |
| `TELEMETRY_RETENTION_HOURS` | Thời gian giữ telemetry, mặc định `168` giờ. | Telemetry retention window, default `168` hours. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | Khoảng thời gian dedupe khi nhận telemetry. | Dedupe window for telemetry ingress. |
| `TELEMETRY_MAX_PER_DEVICE_PER_MINUTE` | Giới hạn telemetry mỗi phút cho từng device. | Per-device telemetry rate limit. |
| `TELEMETRY_MAX_GLOBAL_PER_MINUTE` | Giới hạn telemetry mỗi phút toàn hệ thống. | Global telemetry rate limit. |
| `SPECTRUM_STORAGE_DIR` | Thư mục lưu spectrum, mặc định `storage/spectrum`. | Spectrum storage directory, default `storage/spectrum`. |
| `OTA_PUBLIC_BASE_URL` | Base URL public/LAN để thiết bị tải OTA binary. | Public/LAN base URL for OTA binary downloads. |

## Lệnh thường dùng / Common Commands

| Lệnh / Command | Tiếng Việt | English |
| --- | --- | --- |
| `pnpm install` | Cài dependencies và chạy DB init. | Install dependencies and run DB init. |
| `pnpm dev` | Chạy server và web dev cùng lúc. | Run server and web dev servers together. |
| `pnpm dev:server` | Chỉ chạy Fastify server. | Run only the Fastify server. |
| `pnpm dev:web` | Chỉ chạy Vite web app. | Run only the Vite web app. |
| `pnpm build` | Build web rồi server. | Build web then server. |
| `pnpm typecheck` | Kiểm tra TypeScript phía server. | Type-check the server. |
| `pnpm -C server test` | Chạy test phía server. | Run server tests. |
| `pnpm -C server db:init` | Khởi tạo schema MySQL khi đã cấu hình MySQL. | Initialize MySQL schema when MySQL is configured. |
| `pnpm -C server simulate:devices` | Chạy giả lập thiết bị Socket.IO. | Start Socket.IO device simulator. |
| `pnpm perf:lighthouse` | Build và chạy kiểm tra Lighthouse. | Build and run Lighthouse checks. |

## Xử lý lỗi thường gặp / Troubleshooting

**Tiếng Việt**

- `db:init skipped`: chưa cấu hình MySQL. Điều này bình thường nếu chỉ dev nhanh local.
- Không mở được dashboard tại `localhost:8080/app/` khi dev: hãy chạy `pnpm build` trước, hoặc dùng Vite tại `http://localhost:5173/app/`.
- Vite không gọi được API: đảm bảo `pnpm dev:server` đang chạy ở port `8080`.
- Simulator kết nối được nhưng không thấy telemetry: kiểm tra `DEVICE_AUTH_TOKEN`, filter trên dashboard và connected device count trong `/health`.
- OTA download lỗi trên thiết bị thật: không dùng `localhost` trong `OTA_PUBLIC_BASE_URL`; hãy dùng IP máy tính hoặc domain mà thiết bị truy cập được.
- MySQL connection lỗi: kiểm tra database đã tồn tại, credential đúng và MySQL cho phép TCP connection trên host/port đã cấu hình.

**English**

- `db:init skipped`: MySQL is not configured. This is acceptable for quick local development.
- Cannot open the dashboard at `localhost:8080/app/` during dev: run `pnpm build` first, or use Vite at `http://localhost:5173/app/`.
- Vite cannot reach the API: make sure `pnpm dev:server` is running on port `8080`.
- Device simulator connects but no telemetry appears: check `DEVICE_AUTH_TOKEN`, dashboard filters, and `/health` connected device count.
- OTA download fails on physical devices: do not use `localhost` in `OTA_PUBLIC_BASE_URL`; use the machine IP or a domain reachable by the device.
- MySQL connection fails: verify that the database exists, credentials are correct, and MySQL accepts TCP connections on the configured host/port.
