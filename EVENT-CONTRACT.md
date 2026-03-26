# EVENT CONTRACT - Socket.IO (v1)

## 1) Mục tiêu
Tài liệu chuẩn hóa giao tiếp realtime giữa:
- ESP8266 device
- Backend Socket.IO server
- Dashboard/operator client

Áp dụng cho server hiện tại tại: `server/src/index.ts`.

---

## 2) Kết nối Socket.IO

## Endpoint
- URL: `http://<server-host>:<port>`
- Path Socket.IO mặc định: `/socket.io`
- Transports: `websocket`, `polling`

## Handshake auth/query bắt buộc
Client có thể truyền qua `auth` hoặc `query`.

### Device
- `clientType`: `device`
- `deviceId`: string, bắt buộc
- `token`: string, bắt buộc nếu server cấu hình `DEVICE_AUTH_TOKEN`

### Dashboard
- `clientType`: `dashboard` (hoặc bỏ trống, server mặc định `dashboard`)

---

## 3) Event map tổng quan

## Device -> Server
- `device:heartbeat`
- `device:telemetry`

## Server -> Device
- `device:ack`
- `device:error`
- `device:command`

## Server -> Dashboard
- `telemetry`

---

## 4) Device -> Server Events

## 4.1 `device:heartbeat`
### Purpose
Giữ trạng thái online và cập nhật `connectedAt`.

### Payload
- Không bắt buộc payload.

### Example
```json
{}
```

### Frequency đề xuất
- Mỗi 10-30 giây tùy profile mạng.

---

## 4.2 `device:telemetry`
### Purpose
Gửi dữ liệu cảm biến rung/nhiệt realtime.

### Payload schema (zod equivalent)
```ts
{
  vibration?: number;
  temperature?: number;
  [key: string]: unknown;
}
```

### Ghi chú
- `vibration` và `temperature` đều optional theo schema hiện tại.
- Nên gửi ít nhất 1 trường có giá trị để tránh telemetry rỗng.
- Có thể mở rộng fields (ví dụ `ax`, `ay`, `az`, `rssi`, `fwVersion`) mà không phá v1.

### Example (minimal)
```json
{
  "vibration": 0.183,
  "temperature": 36.8
}
```

### Example (extended)
```json
{
  "vibration": 0.183,
  "temperature": 36.8,
  "ax": 0.011,
  "ay": -0.003,
  "az": 1.002,
  "signal": -67,
  "frameSeq": 9123
}
```

---

## 5) Server -> Device Events

## 5.1 `device:ack`
### Purpose
Xác nhận handshake device thành công.

### Payload
```ts
{
  ok: true;
  deviceId: string;
}
```

### Example
```json
{
  "ok": true,
  "deviceId": "esp-001"
}
```

---

## 5.2 `device:error`
### Purpose
Thông báo lỗi kết nối device.

### Payload
```ts
{
  error: "missing_device_id" | "unauthorized";
}
```

### Example
```json
{
  "error": "unauthorized"
}
```

---

## 5.3 `device:command`
### Purpose
Backend đẩy lệnh điều khiển tới thiết bị.

### Payload
```ts
{
  commandId: string;
  type: "capture" | "calibrate" | "restart" | "set_config";
  payload: Record<string, unknown>;
  sentAt: string; // ISO8601
}
```

### Example
```json
{
  "commandId": "1711245123000-ab12cd",
  "type": "set_config",
  "payload": {
    "sampleRate": 100,
    "threshold": 0.25
  },
  "sentAt": "2026-03-24T03:45:12.300Z"
}
```

---

## 6) Server -> Dashboard Events

## 6.1 `telemetry`
### Purpose
Push dữ liệu realtime đã được backend nhận từ device.

### Payload
```ts
{
  deviceId: string;
  receivedAt: string; // ISO8601
  payload: {
    vibration?: number;
    temperature?: number;
    [key: string]: unknown;
  };
}
```

### Example
```json
{
  "deviceId": "esp-001",
  "receivedAt": "2026-03-24T03:51:44.913Z",
  "payload": {
    "vibration": 0.183,
    "temperature": 36.8,
    "ax": 0.011,
    "ay": -0.003,
    "az": 1.002
  }
}
```

---

## 7) REST endpoints liên quan

## 7.1 `GET /socket-info`
Trả thông tin contract cơ bản:
- transport
- path
- event list

## 7.2 `GET /api/devices`
Liệt kê devices đang kết nối (`deviceId`, `socketId`, `connectedAt`).

## 7.3 `GET /api/devices/last-telemetry`
Trả telemetry mới nhất server nhận.

## 7.4 `POST /api/devices/:deviceId/commands`
Gửi command tới đúng room thiết bị.

Request body:
```json
{
  "type": "capture",
  "payload": {}
}
```

---

## 8) Error behavior

## Device handshake errors
- Thiếu `deviceId` => emit `device:error { error: "missing_device_id" }` rồi disconnect.
- Sai token khi `DEVICE_AUTH_TOKEN` được bật => emit `device:error { error: "unauthorized" }` rồi disconnect.

## Command errors
- Gửi command tới device chưa online => HTTP `404` + `{ ok: false, error: "device_not_connected" }`

---

## 9) Khuyến nghị implement firmware ESP
1. Kết nối với `clientType=device`, `deviceId`, `token`.
2. Khi nhận `device:ack`, bắt đầu vòng heartbeat + telemetry.
3. Gửi `device:heartbeat` mỗi 15s (đề xuất).
4. Gửi `device:telemetry` theo chu kỳ đo (ví dụ 1s hoặc 5s).
5. Lắng nghe `device:command`, parse theo `type`, thực thi rồi log kết quả.
6. Nếu mất kết nối, reconnect backoff: 1s, 2s, 5s, 10s, 30s.

---

## 10) Versioning
- Contract hiện tại: `v1`
- Khi thay đổi breaking:
  - thêm `schemaVersion` vào payload device
  - hoặc tách namespace/event mới (`device:telemetry:v2`)

