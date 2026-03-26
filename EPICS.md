# EPICS - SGP Vibration Datacenter

## Epic 1: Device Registry & Lifecycle
### Goal
Quản lý vòng đời thiết bị ESP8266 theo site/zone, trạng thái online/offline và metadata kỹ thuật.

### Scope
- CRUD thiết bị
- Gán site/zone
- Theo dõi heartbeat, online/offline timeout
- Lưu firmware/sensor version

### Acceptance Criteria
- Có API tạo/sửa/xem danh sách thiết bị
- Trạng thái online/offline cập nhật đúng theo heartbeat timeout cấu hình
- Có thể lọc thiết bị theo site/zone/status

---

## Epic 2: Realtime Telemetry Ingestion (Socket.IO)
### Goal
Thiết bị gửi dữ liệu rung/nhiệt theo thời gian thực và backend broadcast cho dashboard.

### Scope
- Event `device:telemetry`
- Validation schema (zod)
- Lưu `lastTelemetry` mỗi thiết bị
- Broadcast event `telemetry`

### Acceptance Criteria
- Thiết bị gửi telemetry hợp lệ được nhận và xử lý thành công
- Dashboard nhận realtime event với độ trễ thấp
- Payload sai schema bị từ chối và ghi log lỗi

---

## Epic 3: Command & Control
### Goal
Operator gửi lệnh điều khiển thiết bị từ backend và theo dõi trạng thái thực thi.

### Scope
- API `POST /api/devices/:deviceId/commands`
- Server emit `device:command`
- Cơ chế timeout/ack trạng thái command

### Acceptance Criteria
- Gửi command tới đúng device đang online
- Device offline trả về lỗi rõ ràng (`device_not_connected`)
- Có log đầy đủ commandId, deviceId, type, sentAt

---

## Epic 4: Alerting v1 (Threshold-based)
### Goal
Phát hiện sớm bất thường rung/nhiệt độ dựa trên ngưỡng vận hành.

### Scope
- Rule ngưỡng nhiệt/rung
- Debounce và cooldown
- Severity: warning/critical

### Acceptance Criteria
- Tạo alert khi vượt ngưỡng liên tiếp theo rule
- Không spam alert liên tục trong cooldown window
- Dashboard/API hiển thị alert active + history

---

## Epic 5: Auth, RBAC, Audit
### Goal
Bảo vệ hệ thống quản trị và truy vết thao tác vận hành.

### Scope
- Auth người dùng
- RBAC: admin/operator/viewer
- Audit log cho command/config/rule changes

### Acceptance Criteria
- Endpoint nhạy cảm yêu cầu quyền phù hợp
- Mọi thao tác điều khiển được ghi audit
- Có thể truy vấn lịch sử thao tác theo user/device/time range

---

## Epic 6: Data Persistence & Reporting
### Goal
Lưu trữ telemetry/history để truy vấn phân tích vận hành và xuất báo cáo.

### Scope
- Lưu metadata vào Postgres
- Lưu telemetry time-series (phase 2)
- Báo cáo online ratio, top bất thường, CSV export

### Acceptance Criteria
- Truy vấn được lịch sử telemetry theo device/time range
- Báo cáo cơ bản chạy được theo ngày/tuần
- Export CSV hoạt động đúng định dạng

---

## Epic 7: Reliability & Observability
### Goal
Đảm bảo hệ thống chạy ổn định trong môi trường local production.

### Scope
- Structured logging
- Health/readiness checks
- Ingest/command metrics
- Runbook sự cố

### Acceptance Criteria
- Có dashboard kỹ thuật theo dõi ingest rate, error rate, latency
- Health endpoint phản ánh đúng trạng thái runtime
- Có runbook xử lý sự cố phổ biến

---

## Epic 8: Fleet Management & Future Readiness
### Goal
Chuẩn bị mở rộng cho nhiều site, nhiều nhóm thiết bị, và tính năng nâng cao.

### Scope
- Device cohort/grouping
- Batch config rollout
- Chuẩn bị OTA framework
- Nền tảng predictive maintenance

### Acceptance Criteria
- Có thể áp policy theo nhóm thiết bị
- Có kế hoạch rollout/rollback cấu hình
- Có technical design doc cho OTA + predictive phase
