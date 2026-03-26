# SGP Vibration Datacenter Roadmap

## 1) Mục tiêu sản phẩm
Xây dựng hệ thống local-first để quản lý fleet ESP8266 tích hợp cảm biến rung và nhiệt độ, phục vụ vận hành datacenter theo thời gian thực, cảnh báo sớm và điều khiển thiết bị từ xa.

## 2) KPI vận hành mục tiêu
- Telemetry ingest success rate >= 99.9%
- Alert latency P95 < 5 giây
- Command delivery success rate >= 99%
- Device online/offline detection accuracy >= 99%
- Backend availability >= 99.9%

## 3) Phạm vi kiến trúc (đã chốt Socket.IO)
- Device layer: ESP8266 kết nối trực tiếp Socket.IO vào backend nội bộ
- Realtime layer: Socket.IO event bus cho dashboard/operator
- API layer: Fastify (REST cho device registry, command, health)
- Data layer: Postgres (metadata + alert + audit), time-series store (giai đoạn 2)
- Security layer: device token, RBAC, audit log

---

## 4) Lộ trình triển khai theo phase

## Phase 0: Foundation (2 tuần)
Thời gian đề xuất: 24/03/2026 - 06/04/2026

### Mục tiêu
- Chốt schema dữ liệu và giao thức event giữa device-dashboard-server
- Hoàn thiện server scaffold production-ready cơ bản

### Deliverables
- Event contract v1:
  - `device:heartbeat`
  - `device:telemetry`
  - `device:command`
  - `telemetry`
- `ROADMAP.md` + chuẩn coding/backend conventions
- CI cơ bản: build + typecheck + lint

### Exit criteria
- Server chạy ổn định local, build pass
- Có thể connect device giả lập và nhận telemetry realtime trên dashboard giả lập

---

## Phase 1: MVP Core (4 tuần)
Thời gian đề xuất: 07/04/2026 - 04/05/2026

### Mục tiêu
- Có sản phẩm vận hành được cho 1 site nhỏ

### Phạm vi tính năng
- Device registry API:
  - đăng ký thiết bị
  - cập nhật metadata (site, zone, firmware, sensor version)
  - trạng thái online/offline theo heartbeat timeout
- Telemetry pipeline:
  - validation payload
  - lưu last telemetry theo thiết bị
  - realtime broadcast tới dashboard
- Command center v1:
  - gửi lệnh `capture`, `calibrate`, `restart`, `set_config`
  - ack + timeout + trạng thái command
- Alerting v1:
  - rule ngưỡng rung/nhiệt độ
  - debounce/cooldown chống spam
- Auth/RBAC v1:
  - roles: admin/operator/viewer

### Exit criteria
- 100 thiết bị mô phỏng ổn định >= 24h
- Alert và command hoạt động end-to-end
- Dashboard hiển thị realtime không trễ bất thường

---

## Phase 2: Data & Reliability (4 tuần)
Thời gian đề xuất: 05/05/2026 - 01/06/2026

### Mục tiêu
- Tăng độ bền hệ thống để chạy production nội bộ

### Phạm vi tính năng
- Persistence telemetry:
  - lưu time-series (raw + downsample)
  - retention policy
- Reliability:
  - idempotency xử lý message
  - reconnect strategy cho device
  - backpressure handling
- Observability:
  - log chuẩn cấu trúc
  - metric ingest rate, alert rate, command success rate
  - health/readiness riêng
- Audit log:
  - ghi lại thao tác điều khiển thiết bị

### Exit criteria
- Load test 300-500 device connections đồng thời
- P95 API response < 250ms cho endpoint chính
- Có dashboard kỹ thuật cho vận hành backend

---

## Phase 3: Ops Excellence (4 tuần)
Thời gian đề xuất: 02/06/2026 - 29/06/2026

### Mục tiêu
- Đưa hệ thống lên mức “đủ tin cậy để giao vận hành team NOC”

### Phạm vi tính năng
- Alerting v2:
  - severity levels
  - rule theo khung giờ/ca trực
  - ack/resolve workflow
- Incident workflow:
  - tạo incident từ alert
  - gán owner
  - timeline xử lý
- Report v1:
  - online ratio theo site
  - top thiết bị bất thường
  - xuất CSV

### Exit criteria
- Giảm false alert >= 30% so với Phase 1
- Team vận hành có thể xử lý sự cố theo runbook mà không cần dev can thiệp trực tiếp

---

## Phase 4: Fleet Management (4-6 tuần)
Thời gian đề xuất: 30/06/2026 - 10/08/2026

### Mục tiêu
- Quản lý fleet lớn nhiều site

### Phạm vi tính năng
- Device grouping/cohort
- Cấu hình batch theo nhóm thiết bị
- Firmware rollout framework (chuẩn bị OTA)
- Policy engine cho site-level config

### Exit criteria
- Quản lý được 1,000+ thiết bị trên staging
- Rollout config theo cohort có rollback an toàn

---

## Phase 5: Future Features (Q4/2026)
### Mục tiêu
- Chuẩn bị mở rộng dài hạn

### Tính năng tương lai ưu tiên
- Predictive maintenance (anomaly scoring)
- Multi-tenant boundaries
- SLA dashboard theo khách hàng/site
- Chiến lược cold storage tối ưu chi phí

---

## 5) Kế hoạch Sprint 1 (2 tuần đầu)

## Sprint 1A (Tuần 1)
- Hoàn thiện event schema + docs
- Device auth token flow
- API `GET /api/devices`, `GET /health`, `GET /api/devices/last-telemetry`
- Test integration cho telemetry ingest

## Sprint 1B (Tuần 2)
- API command `POST /api/devices/:deviceId/commands`
- Command ack/timeout state machine
- Online/offline detection từ heartbeat
- Dashboard mock subscribe `telemetry` event

### Definition of Done Sprint 1
- 100% endpoint chính có test cơ bản
- Typecheck/build pass
- Demo realtime + command flow thành công trên local network

### Kế hoạch Sprint 2 (2 tuần tiếp theo)

### Mục tiêu
- Hoàn thiện phần còn thiếu của MVP Core để có thể demo vận hành cảnh báo cơ bản

### Phạm vi chính
- Device registry filter:
  - lọc theo `site`, `zone`, `status`
  - search theo `deviceId/name`
- Alerting v1:
  - rule ngưỡng rung/nhiệt
  - debounce/cooldown chống spam
  - severity `warning/critical`
- Alert API + dashboard/test tool:
  - hiển thị active/history
  - xem và chỉnh rule cơ bản
- Audit log v1:
  - ghi thao tác command từ API/test tool

### Definition of Done Sprint 2
- Alert hoạt động end-to-end từ telemetry tới API/dashboard test tool
- Device filtering hoạt động đúng trên local demo
- Command audit log truy vấn được với dữ liệu đủ để trace
- Demo ổn định với 50 device giả lập

### Kế hoạch Sprint 3 (2 tuần tiếp theo)

### Mục tiêu
- Hoàn tất phần còn thiếu của MVP Core để khép lại Phase 1

### Phạm vi chính
- Auth v1 cho user nội bộ:
  - token/API key đơn giản
  - phân vai `admin/operator/viewer`
- RBAC guard:
  - bảo vệ endpoint command, alert rule, audit
- Audit log mở rộng:
  - ghi thao tác đổi rule/config
  - truy vấn theo actor/action
- Quality gate:
  - soak test `100` devices
  - xác nhận alert + command flow vẫn ổn định

### Definition of Done Sprint 3
- User nội bộ đăng nhập/xác thực được theo role
- RBAC chặn đúng các hành vi không đủ quyền
- Audit log bao phủ command và rule/config changes
- Demo ổn định với 100 device giả lập, đủ điều kiện hoàn tất Phase 1

### Kế hoạch Sprint 4 (2 tuần tiếp theo)

### Mục tiêu
- Bắt đầu `Phase 2` bằng cách thay dữ liệu runtime quan trọng khỏi `in-memory` và dựng baseline reliability/observability cho production nội bộ

### Phạm vi chính
- Postgres persistence foundation:
  - `devices`
  - `alert_rules`
  - `alerts`
  - `audit_logs`
- Telemetry persistence v1:
  - lưu raw telemetry append-only
  - giữ `last telemetry` path cho realtime
  - retention/cleanup strategy bước đầu
- Reliability guardrails:
  - idempotency/dedupe ingest cơ bản
  - reconnect handling
  - backpressure guard tối thiểu
- Observability baseline:
  - structured logs
  - metrics ingest/alert/command
  - tách `liveness` và `readiness`
- Quality gate:
  - load demo `300` devices với persistence bật

### Definition of Done Sprint 4
- Dữ liệu vận hành chính không mất sau restart server
- Telemetry có persistence path tối thiểu để phục vụ trace/debug
- Có health semantics và metric baseline cho backend
- Demo ổn định với `300` devices, đủ dữ liệu để chuẩn bị Sprint 5

### Kế hoạch Sprint 5 (2 tuần tiếp theo)

### Mục tiêu
- Khép lại `Phase 2` bằng cách harden persistence path, bổ sung telemetry history/retention, dựng technical dashboard và chốt quality gate `500` devices

### Phạm vi chính
- Persistence hardening:
  - thay hot path bridge/tạm thời bằng access layer Postgres async rõ ràng hơn
  - batch/coalesce write cho session, alert, audit
  - rà soát index/query path
- Telemetry query + retention:
  - đọc telemetry history theo thiết bị/khoảng thời gian
  - downsample bucket cơ bản
  - retention cleanup/job mức tối thiểu
- Performance/latency:
  - benchmark `P95` cho endpoint chính
  - tối ưu query, alert churn, log volume, broadcast fan-out
- Technical ops dashboard:
  - health/readiness
  - throughput, active alerts, command success/failure
  - trạng thái persistence/Postgres
- Quality gate:
  - load demo `500` devices với observability bật

### Definition of Done Sprint 5
- Persistence path đủ ổn định cho tải cao hơn và không còn phụ thuộc vào bridge tạm thời ở hot path
- Có telemetry history/query + retention/downsample tối thiểu cho debug vận hành
- `P95 API response < 250ms` cho endpoint chính trong bài test mục tiêu
- Có technical dashboard đủ dùng cho vận hành backend
- Demo ổn định với `500` devices, đủ điều kiện hoàn tất `Phase 2`

### Kế hoạch Sprint 6 (2 tuần tiếp theo)

### Mục tiêu
- Bắt đầu `Phase 3` bằng cách nâng cấp alert workflow và dựng incident handling core cho team vận hành

### Phạm vi chính
- Alerting v2 foundation:
  - severity theo ngữ cảnh vận hành
  - rule theo khung giờ/ca trực
  - `ack`/`resolve` workflow
- Incident core:
  - tạo incident từ alert
  - gán owner
  - timeline xử lý cơ bản
  - trạng thái `open/assigned/monitoring/resolved/closed`
- Ops action API + RBAC:
  - endpoint ack/resolve alert
  - endpoint create/assign/update incident
  - audit đầy đủ cho workflow mới
- Technical ops UI:
  - thao tác ack/resolve alert
  - xem incident list, owner, status, timeline
  - filter theo severity/status/site/owner
- Quality gate:
  - demo runbook `alert -> ack -> incident -> assign -> resolve -> close`

### Definition of Done Sprint 6
- Alert có workflow `ack/resolve` rõ ràng, truy vết được actor và thời điểm
- Incident core hoạt động được với owner, status, timeline
- Operator xử lý được workflow qua API và UI kỹ thuật
- Có demo runbook đủ để chuẩn bị Sprint 7 cho reporting và tối ưu false-alert

### Kế hoạch Sprint 7 (2 tuần tiếp theo)

### Mục tiêu
- Khép `Phase 3` bằng cách bổ sung incident history/reporting foundation, giảm false-alert và harden workflow NOC để vận hành theo ca trực rõ ràng hơn

### Phạm vi chính
- Incident history + reporting:
  - query incident theo `status`, `severity`, `site`, `owner`, thời gian
  - timeline/read model ổn định hơn cho UI và export
  - summary API tối thiểu cho handover/report
- False-alert reduction:
  - dedupe/coalesce/cooldown ở mức tối thiểu
  - suppression cho alert noisy
  - metric/summary để đo nhiễu alert
- NOC workflow hardening:
  - tighten role/action semantics
  - audit context tốt hơn cho ownership/status change
  - validation/note policy rõ hơn cho resolve/close/export
- Ops console v2:
  - filter incident/alert/history theo status, severity, owner, site, thời gian
  - timeline inspector + summary cards
  - hỗ trợ review ca trực và shift handover
- Quality gate:
  - demo `noisy alert -> suppression/coalesce -> incident handling -> history review -> handover summary`

### Definition of Done Sprint 7
- Incident history/reporting đủ dùng cho review và handover cơ bản
- False-alert giảm rõ ràng bằng cơ chế có thể giải thích được
- Workflow NOC chặt hơn về RBAC, audit, validation và failure semantics
- Ops console đủ để lọc, truy vết và review incident theo ca trực
- Demo handover hoàn chỉnh, đủ điều kiện khép `Phase 3`

---

## 6) Rủi ro chính và phương án giảm thiểu
- Device mất kết nối chập chờn
  - Heartbeat + reconnect backoff + state timeout
- Dữ liệu telemetry không đồng nhất schema
  - Zod validation + schema version field
- Spam command từ operator
  - RBAC + rate limit + audit
- Nâng quy mô bị nghẽn realtime
  - Phân tách ingest/service, cân nhắc Redis adapter cho Socket.IO

---

## 7) Nguồn lực tối thiểu đề xuất
- 2 Backend engineers
- 1 Frontend engineer (dashboard)
- 1 QA/Automation part-time
- 1 Ops/SRE part-time

### Kế hoạch Sprint 8 (2 tuần tiếp theo)

### Mục tiêu
- Mở `Phase 4` bằng cách đưa `group/cohort` và `batch config` vào vận hành thật.

### Phạm vi chính
- Fleet grouping/cohort API:
  - static + dynamic cohort
  - preview member trước thao tác diện rộng
- Batch config v1:
  - dry-run trước apply
  - execution summary (sent/acked/timeout/failed)
- Policy baseline v1:
  - site/zone-level defaults
  - audit cho thay đổi policy
- Fleet Console UI v1:
  - tạo group/cohort
  - dry-run/apply batch config

### Definition of Done Sprint 8
- Operator thao tác group/cohort và batch config từ UI/API
- Có guard an toàn cho batch action diện rộng
- Demo ổn định với `700` devices và ít nhất `3` cohort

### Kế hoạch Sprint 9 (2 tuần tiếp theo)

### Mục tiêu
- Dựng rollout framework v1 theo `canary + wave` với cơ chế `pause/resume/rollback`.

### Phạm vi chính
- Rollout domain model + timeline event
- Wave/canary rollout engine + gate theo tỷ lệ lỗi/timeout
- Auto-stop + rollback safety rules
- Fleet Console UI v2:
  - rollout wizard
  - wave timeline
  - pause/resume/cancel/rollback

### Definition of Done Sprint 9
- Rollout framework chạy ổn định với canary/wave lifecycle đầy đủ
- Auto-stop/rollback được kiểm chứng bằng fault drill
- Drill pass với `900` devices

### Kế hoạch Sprint 10 (2 tuần tiếp theo)

### Mục tiêu
- Khép `Phase 4` bằng governance rollout/policy và quality gate `1000+` devices.

### Phạm vi chính
- Approval flow v1 cho action rủi ro cao
- Hardening rollout/policy + metric/alert chuyên biệt
- Fleet Console UI v3:
  - approval inbox
  - audit-first views
  - policy compliance summary
- Mixed scenario quality gate:
  - telemetry + alert + incident + batch + rollout

### Definition of Done Sprint 10
- Governance + audit cho fleet-level actions hoạt động ổn định
- Rollout/policy path được harden đủ dùng production nội bộ
- Quality gate pass ở `1000+` devices
- Hoàn tất closeout `Phase 4` và entry pack cho `Phase 5`

### Tài liệu chi tiết Sprint
- `SPRINT-8.md`
- `SPRINT-9.md`
- `SPRINT-10.md`
