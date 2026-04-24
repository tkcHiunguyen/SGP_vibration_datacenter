# SGP Vibration Datacenter

<p align="right">
  <a href="./README.md"><img alt="Tiếng Việt" src="https://img.shields.io/badge/Ng%C3%B4n%20ng%E1%BB%AF-Ti%E1%BA%BFng%20Vi%E1%BB%87t-blue"></a>
  <a href="./README.en.md"><img alt="English" src="https://img.shields.io/badge/Language-English-lightgrey"></a>
</p>

## Tổng quan

SGP Vibration Datacenter là hệ thống giám sát rung động cho thiết bị thật trong datacenter. Hệ thống nhận dữ liệu realtime từ thiết bị qua Socket.IO, lưu telemetry vào MySQL nếu đã cấu hình database, phát dữ liệu realtime lên dashboard và cung cấp các API vận hành cho thiết bị, zone, cảnh báo, sự cố, rollout và OTA.

Repository là monorepo `pnpm` gồm hai ứng dụng chính:

| Thành phần | Công nghệ | Vai trò |
| --- | --- | --- |
| `server` | Fastify, Socket.IO, MySQL | API backend, realtime gateway, lưu telemetry, quản lý thiết bị/cảnh báo/sự cố/OTA/metrics. |
| `web` | React, Vite | Dashboard quan sát thiết bị, telemetry, biểu đồ rung động, nhiệt độ, phổ tần số và các thao tác vận hành. |

Khi server chạy, các endpoint chính là:

| Endpoint | Ý nghĩa |
| --- | --- |
| `/api/*` | API cho dashboard và workflow vận hành. |
| `/socket.io` | Kênh realtime cho thiết bị thật và dashboard. |
| `/health`, `/health/live`, `/health/ready` | Kiểm tra trạng thái server. |
| `/metrics` | Prometheus metrics. |
| `/app/` | Dashboard production sau khi build web. |
| `/socket-info` | Thông tin nhanh về Socket.IO path và event đang hỗ trợ. |

## Luồng dữ liệu với thiết bị thật

1. Thiết bị kết nối Socket.IO đến server tại `http://<server-ip>:8080/socket.io` với `clientType=device` và `deviceId`.
2. Server xác thực token nếu `DEVICE_AUTH_TOKEN` được cấu hình, sau đó trả event `device:ack`.
3. Thiết bị gửi `device:metadata`, `device:heartbeat`, `device:telemetry` và các frame phổ `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`.
4. Server chuẩn hóa dữ liệu, cập nhật trạng thái online/heartbeat, lưu telemetry/spectrum và kiểm tra rule cảnh báo.
5. Dashboard kết nối với `clientType=dashboard` và nhận realtime qua các event `telemetry`, `telemetry:spectrum`, `device:heartbeat`, `device:metadata` và `alert`.
6. Khi dashboard gửi lệnh vận hành, server phát `device:command` đến thiết bị đang online; thiết bị xác nhận lại bằng `device:command:ack`.

## Yêu cầu hệ thống

Cài các công cụ sau trước khi chạy project:

- Node.js 20 hoặc mới hơn.
- pnpm 10.x. Repository đang khai báo `pnpm@10.32.1`.
- MySQL 8.x hoặc database tương thích nếu cần lưu dữ liệu bền vững.
- Git.

Nếu chưa có pnpm, bật qua Corepack:

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

## Cấu hình server

Tạo file môi trường cho server:

```bash
cp server/.env.example server/.env
```

Ví dụ cấu hình tối thiểu trong `server/.env`:

```dotenv
NODE_ENV=development
PORT=8080
HOST=0.0.0.0
LOG_LEVEL=info
MYSQL_URL=mysql://root@127.0.0.1:3306/sgp_vibration_datacenter
TELEMETRY_RETENTION_HOURS=168
SPECTRUM_STORAGE_DIR=storage/spectrum
```

Giải thích các điểm quan trọng:

- `HOST=0.0.0.0` giúp thiết bị trong cùng LAN truy cập được server qua IP máy chạy backend.
- Thiết bị thật không dùng `localhost` để gọi server. Với firmware, `localhost` là chính thiết bị. Hãy dùng IP/domain của máy chạy server, ví dụ `http://192.168.1.10:8080`.
- Nếu chưa cấu hình MySQL, server vẫn chạy được cho kiểm thử nhanh, nhưng dữ liệu bền vững nên dùng MySQL.
- Nếu bật `DEVICE_AUTH_TOKEN`, firmware phải gửi đúng token khi handshake Socket.IO.

Tạo database MySQL nếu cần lưu dữ liệu bền vững:

```bash
mysql -uroot -e "CREATE DATABASE IF NOT EXISTS sgp_vibration_datacenter CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Nếu thiết bị cần tải OTA binary từ server, cấu hình URL mà thiết bị truy cập được:

```dotenv
OTA_PUBLIC_BASE_URL=http://192.168.1.10:8080
```

Nếu cần xác thực thiết bị:

```dotenv
DEVICE_AUTH_TOKEN=replace-with-a-real-device-token
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

Service mặc định:

| Service | URL |
| --- | --- |
| Server | `http://localhost:8080` |
| Vite web dev server | `http://localhost:5173` |
| Dashboard dev | `http://localhost:5173/app/` |

Vite sẽ proxy `/api`, `/health` và `/socket.io` về server port `8080`.

Chạy riêng từng phần nếu cần:

```bash
pnpm dev:server
pnpm dev:web
```

## Kết nối thiết bị thật

Thiết bị kết nối Socket.IO đến URL server mà thiết bị truy cập được:

```text
http://<server-lan-ip>:8080
```

Handshake cần gửi các field sau qua `auth` hoặc query string:

| Field | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `clientType` | Có | Đặt là `device` cho thiết bị thật. |
| `deviceId` | Có | ID duy nhất của thiết bị, ví dụ `esp-001`. |
| `token` | Khi có `DEVICE_AUTH_TOKEN` | Token xác thực thiết bị. |

Ví dụ bằng Socket.IO client:

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

Kết nối thành công sẽ nhận:

```json
{ "ok": true, "deviceId": "esp-001" }
```

qua event `device:ack`.

Nếu lỗi, server có thể trả `device:error` với:

- `missing_device_id`: thiếu `deviceId`.
- `unauthorized`: token không khớp `DEVICE_AUTH_TOKEN`.

## Event thiết bị gửi lên server

### `device:metadata`

Gửi khi thiết bị boot hoặc khi metadata thay đổi.

```json
{
  "uuid": "esp32-uuid-001",
  "name": "ESP Vibration 001",
  "site": "SGP",
  "zone": "Rack-A1",
  "firmwareVersion": "1.0.0",
  "sensorVersion": "adxl355-v1",
  "notes": "Main rack sensor"
}
```

Server cũng chấp nhận dạng envelope:

```json
{
  "metadata": {
    "firmware": "1.0.0",
    "sensor_version": "adxl355-v1"
  }
}
```

### `device:heartbeat`

Gửi định kỳ để dashboard biết thiết bị còn online.

```json
{
  "socketConnected": true,
  "staConnected": true,
  "signal": -62,
  "uptimeSec": 3600
}
```

### `device:telemetry`

Gửi mẫu telemetry chính. Các field phụ được giữ trong payload, còn MySQL hiện lưu các field lõi sau: `temperature`, `vibration`, `ax`, `ay`, `az`, `sample_count`, `telemetry_uuid`.

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

`telemetry_uuid` nên ổn định và duy nhất theo thiết bị cho mỗi sample để liên kết telemetry với frame phổ và tránh ghi trùng ở tầng lưu trữ. Nếu muốn server loại duplicate ngay ở tầng ingress, gửi thêm một trong các field `messageId`, `sequence` hoặc `seq`; các field này được kiểm tra theo `TELEMETRY_DEDUPE_WINDOW_MS`.

### `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`

Gửi phổ tần số theo từng trục. Có thể gửi mảng số trong JSON:

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

Hoặc gửi metadata làm payload thứ nhất và binary `Uint8Array`/buffer làm payload thứ hai. Binary được đọc theo dạng unsigned 16-bit little-endian. Nếu không truyền `value_scale`, server mặc định scale binary theo `256`.

## Lệnh từ dashboard xuống thiết bị

Khi dashboard/API gửi lệnh, thiết bị sẽ nhận event:

```text
device:command
```

Payload luôn có tối thiểu:

```json
{
  "commandId": "cmd-123",
  "command": "restart",
  "type": "restart",
  "deviceId": "esp-001"
}
```

Sau khi xử lý, thiết bị cần gửi ack:

```json
{
  "commandId": "cmd-123",
  "status": "ok",
  "detail": "restarted",
  "deviceId": "esp-001",
  "firmwareVersion": "1.0.1"
}
```

qua event:

```text
device:command:ack
```

Nếu thiết bị vừa reconnect và muốn lấy lại lệnh gần nhất, gửi:

```text
device:request-last-command
```

Server sẽ phát lại `device:command` nếu lệnh gần nhất thuộc đúng `deviceId`.

## Kiểm tra cài đặt

Kiểm tra server:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/health/ready
curl http://localhost:8080/socket-info
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

Sau đó mở dashboard production:

```text
http://localhost:8080/app/
```

Với môi trường gần production, nên cấu hình tối thiểu:

- `NODE_ENV=production`.
- `PORT`.
- `HOST`.
- `MYSQL_URL` hoặc các biến `MYSQL_*`.
- `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` bằng secret riêng, không dùng giá trị mặc định.
- `DEVICE_AUTH_TOKEN` nếu thiết bị thật cần xác thực.
- `OTA_PUBLIC_BASE_URL` nếu dùng OTA dispatch.

## Biến môi trường quan trọng

| Biến | Ý nghĩa |
| --- | --- |
| `PORT` | Port HTTP server, mặc định `8080`. |
| `HOST` | Địa chỉ bind, mặc định `0.0.0.0`. |
| `MYSQL_URL` | Connection string MySQL khuyến nghị. |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Cấu hình MySQL dạng tách biến. |
| `DB_AUTO_INIT` | Đặt `false` để tắt tự động khởi tạo schema. |
| `DEVICE_AUTH_TOKEN` | Token xác thực device Socket.IO client. |
| `COMMAND_TIMEOUT_MS` | Thời gian chờ ack cho lệnh gửi xuống thiết bị. |
| `AUTH_ADMIN_TOKEN`, `AUTH_OPERATOR_TOKEN`, `AUTH_VIEWER_TOKEN` | Token role tĩnh cho API/dashboard; giá trị mặc định chỉ nên dùng local. |
| `AUTH_BYPASS_GATING` | Điều khiển auth gating. |
| `TELEMETRY_RETENTION_HOURS` | Thời gian giữ telemetry, mặc định `168` giờ. |
| `TELEMETRY_DEDUPE_WINDOW_MS` | Khoảng thời gian dedupe telemetry theo `messageId`, `sequence` hoặc `seq` của từng thiết bị. |
| `TELEMETRY_MAX_PER_DEVICE_PER_MINUTE` | Giới hạn telemetry mỗi phút cho từng thiết bị. |
| `TELEMETRY_MAX_GLOBAL_PER_MINUTE` | Giới hạn telemetry mỗi phút toàn hệ thống. |
| `SPECTRUM_STORAGE_DIR` | Thư mục lưu spectrum, mặc định `storage/spectrum`. |
| `SPECTRUM_FRAME_FLUSH_MS` | Chu kỳ flush frame phổ xuống storage. |
| `SPECTRUM_MATCH_WINDOW_MS` | Cửa sổ thời gian dùng để ghép telemetry với spectrum khi thiếu `telemetry_uuid`. |
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
| `pnpm -C server start:prod` | Chạy server từ output đã build. |
| `pnpm perf:lighthouse` | Build và chạy kiểm tra Lighthouse. |

## Xử lý lỗi thường gặp

- `db:init skipped`: chưa cấu hình MySQL. Điều này chấp nhận được khi chỉ chạy local nhanh, nhưng môi trường thật nên cấu hình MySQL.
- Thiết bị không kết nối được: kiểm tra server đang bind `HOST=0.0.0.0`, firewall cho phép port `8080`, firmware dùng IP/domain thật thay vì `localhost`, và `deviceId` không rỗng.
- Thiết bị bị `unauthorized`: token firmware gửi lên không khớp `DEVICE_AUTH_TOKEN`.
- Thiết bị online nhưng dashboard không thấy telemetry: kiểm tra event đang gửi đúng là `device:telemetry`, payload có số hợp lệ, `/health` có connected device count, dashboard không bị filter sai thiết bị/zone.
- Không thấy spectrum: kiểm tra event đúng trục `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`; payload có `values` hoặc binary attachment; `telemetry_uuid` nên khớp telemetry chính.
- Không mở được dashboard tại `localhost:8080/app/` khi dev: hãy chạy `pnpm build` trước, hoặc dùng Vite tại `http://localhost:5173/app/`.
- Vite không gọi được API: đảm bảo `pnpm dev:server` đang chạy ở port `8080`.
- OTA download lỗi trên thiết bị thật: không dùng `localhost` trong `OTA_PUBLIC_BASE_URL`; hãy dùng IP máy tính hoặc domain mà thiết bị truy cập được.
- MySQL connection lỗi: kiểm tra database đã tồn tại, credential đúng và MySQL cho phép TCP connection trên host/port đã cấu hình.
