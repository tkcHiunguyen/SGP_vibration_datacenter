# SGP Vibration Datacenter

<p align="right">
  <a href="./README.md"><img alt="Tiếng Việt" src="https://img.shields.io/badge/Ng%C3%B4n%20ng%E1%BB%AF-Ti%E1%BA%BFng%20Vi%E1%BB%87t-blue"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-lightgrey"></a>
</p>

## Tổng quan

SGP Vibration Datacenter là hệ thống giám sát rung động cho thiết bị trong datacenter. Project được tổ chức dạng monorepo `pnpm` với hai phần chính:

- `server`: Fastify API server, Socket.IO realtime gateway, telemetry persistence, quản lý thiết bị, cảnh báo, sự cố, zone, rollout, OTA và metrics.
- `web`: Dashboard React/Vite để quan sát telemetry, biểu đồ rung động, nhiệt độ, phổ tần số, trạng thái thiết bị và các workflow vận hành.

Khi chạy, server cung cấp:

- API HTTP tại `/api/*`
- Socket.IO tại `/socket.io`
- health checks tại `/health`, `/health/live`, `/health/ready`
- Prometheus metrics tại `/metrics`
- dashboard production tại `/app/`

## Yêu cầu

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

## Cấu hình môi trường

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

## Cài dependencies

Chạy từ root repository:

```bash
pnpm install
```

Sau khi cài, root `postinstall` sẽ chạy `pnpm db:init`. Nếu MySQL đã được cấu hình, schema sẽ được tạo hoặc cập nhật. Nếu chưa cấu hình MySQL, script sẽ in thông báo skip.

## Chạy môi trường dev

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

## Kiểm tra cài đặt

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

## Giả lập thiết bị

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

## Build production

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

## Biến môi trường quan trọng

| Biến | Ý nghĩa |
| --- | --- |
| `PORT` | Port HTTP server, mặc định `8080`. |
| `HOST` | Địa chỉ bind, mặc định `0.0.0.0`. |
| `MYSQL_URL` | Connection string MySQL khuyến nghị. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Cấu hình MySQL dạng tách biến. |
| `DB_AUTO_INIT` | Đặt `false` để tắt tự động khởi tạo schema. |
| `DEVICE_AUTH_TOKEN` | Token tùy chọn cho device Socket.IO client. |
| `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` | Token role tĩnh cho API/dashboard; giá trị mặc định chỉ nên dùng local. |
| `AUTH_BYPASS_GATING` | Mặc định `true`, điều khiển auth gating. |
| `TELEMETRY_RETENTION_HOURS` | Thời gian giữ telemetry, mặc định `168` giờ. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | Khoảng thời gian dedupe khi nhận telemetry. |
| `TELEMETRY_MAX_PER_DEVICE_PER_MINUTE` | Giới hạn telemetry mỗi phút cho từng device. |
| `TELEMETRY_MAX_GLOBAL_PER_MINUTE` | Giới hạn telemetry mỗi phút toàn hệ thống. |
| `SPECTRUM_STORAGE_DIR` | Thư mục lưu spectrum, mặc định `storage/spectrum`. |
| `OTA_PUBLIC_BASE_URL` | Base URL public/LAN để thiết bị tải OTA binary. |

## Lệnh thường dùng

| Lệnh | Ý nghĩa |
| --- | --- |
| `pnpm install` | Cài dependencies và chạy DB init. |
| `pnpm dev` | Chạy server và web dev cùng lúc. |
| `pnpm dev:server` | Chỉ chạy Fastify server. |
| `pnpm dev:web` | Chỉ chạy Vite web app. |
| `pnpm build` | Build web rồi server. |
| `pnpm typecheck` | Kiểm tra TypeScript phía server. |
| `pnpm -C server test` | Chạy test phía server. |
| `pnpm -C server db:init` | Khởi tạo schema MySQL khi đã cấu hình MySQL. |
| `pnpm -C server simulate:devices` | Chạy giả lập thiết bị Socket.IO. |
| `pnpm perf:lighthouse` | Build và chạy kiểm tra Lighthouse. |

## Xử lý lỗi thường gặp

- `db:init skipped`: chưa cấu hình MySQL. Điều này bình thường nếu chỉ dev nhanh local.
- Không mở được dashboard tại `localhost:8080/app/` khi dev: hãy chạy `pnpm build` trước, hoặc dùng Vite tại `http://localhost:5173/app/`.
- Vite không gọi được API: đảm bảo `pnpm dev:server` đang chạy ở port `8080`.
- Simulator kết nối được nhưng không thấy telemetry: kiểm tra `DEVICE_AUTH_TOKEN`, filter trên dashboard và connected device count trong `/health`.
- OTA download lỗi trên thiết bị thật: không dùng `localhost` trong `OTA_PUBLIC_BASE_URL`; hãy dùng IP máy tính hoặc domain mà thiết bị truy cập được.
- MySQL connection lỗi: kiểm tra database đã tồn tại, credential đúng và MySQL cho phép TCP connection trên host/port đã cấu hình.
