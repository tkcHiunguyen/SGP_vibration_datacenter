# SPRINT-4 PLAN (2 Weeks)

Timeline đề xuất: 05/05/2026 - 18/05/2026
Sprint Goal: Bắt đầu `Phase 2: Data & Reliability` bằng cách đưa dữ liệu vận hành cốt lõi ra khỏi `in-memory`, bổ sung persistence cho telemetry và dựng baseline reliability/observability đủ để chuẩn bị scale tiếp.

## Scope Notes
- Sprint 4 là nửa đầu của `Phase 2: Data & Reliability` trong `ROADMAP.md`.
- Sprint 3 đã khép lại `Phase 1` với Auth/RBAC, audit mở rộng và soak `100` devices; điểm yếu lớn nhất hiện tại là dữ liệu runtime vẫn volatile sau restart.
- Chưa làm toàn bộ load target `500` devices hoặc dashboard vận hành hoàn chỉnh trong sprint này; ưu tiên là nền persistence + reliability trước.

## Progress Checklist (Cập nhật ngày 24/03/2026)
- [x] S4-01 Postgres Persistence Foundation
- [x] S4-02 Telemetry Persistence v1
- [x] S4-03 Reliability Guardrails v1
- [x] S4-04 Observability Baseline
- [x] S4-05 Quality Gate + 300 Devices Load Demo

## 1) Sprint Backlog

## Story S4-01: Postgres Persistence Foundation
- Status: DONE
- Owner Role: Backend
- Estimate: 2.5d
- Tasks:
  - Thiết kế schema Postgres cho `devices`, `alert_rules`, `alerts`, `audit_logs`
  - Tạo repository interface + implementation Postgres song song với in-memory hiện tại
  - Thêm bootstrap config kết nối DB cho local development
  - Viết migration/init script tối thiểu để khởi tạo schema
- DoD:
  - Device metadata, alert rules, alerts và audit logs không mất sau restart server
  - Repository layer tách rõ, không trộn logic SQL trực tiếp vào route/service
  - Có thể chạy local bằng cấu hình DB rõ ràng, không cần chỉnh tay nhiều

## Story S4-02: Telemetry Persistence v1
- Status: DONE
- Owner Role: Backend
- Estimate: 2.5d
- Tasks:
  - Lưu raw telemetry theo append-only model để phục vụ truy vết ngắn hạn
  - Giữ `last telemetry` path tối ưu cho realtime/dashboard
  - Định nghĩa retention strategy bước đầu hoặc cleanup policy placeholder
  - Chuẩn bị shape dữ liệu để sau này chuyển sang time-series store chuyên dụng nếu cần
- DoD:
  - Telemetry mới được persist thành công ngoài memory
  - Vẫn giữ được realtime broadcast hiện tại mà không tạo regression rõ rệt
  - Có tài liệu ngắn về retention/cleanup giả định cho Phase 2

## Story S4-03: Reliability Guardrails v1
- Status: DONE
- Owner Role: Backend
- Estimate: 2d
- Tasks:
  - Thêm idempotency cơ bản cho ingest path hoặc event dedupe key
  - Siết reconnect handling cho device sessions
  - Bổ sung giới hạn/backpressure guard cho luồng ingest hoặc broadcast dễ quá tải
  - Ghi nhận failure mode chính khi DB chậm hoặc mất kết nối tạm thời
- DoD:
  - Duplicate ingest phổ biến không tạo side effect sai lệch nghiêm trọng
  - Reconnect không làm state device nhảy loạn hoặc tạo session rác hàng loạt
  - Có guardrail tối thiểu khi tải tăng đột biến

## Story S4-04: Observability Baseline
- Status: DONE
- Owner Role: Backend/Ops
- Estimate: 2d
- Tasks:
  - Chuẩn hóa structured log cho telemetry ingest, command, alert, DB errors
  - Bổ sung metrics cơ bản: ingest rate, alert rate, command success/failure, DB latency
  - Tách `liveness` và `readiness` health endpoints
  - Tạo dashboard kỹ thuật tối thiểu hoặc note mapping metric cho Phase 2 review
- DoD:
  - Có log đủ nhất quán để trace lỗi runtime
  - Có thể nhìn thấy throughput cơ bản và tỉ lệ lỗi theo loại luồng
  - Health/readiness semantics rõ ràng cho môi trường staging/local

## Story S4-05: Quality Gate + 300 Devices Load Demo
- Status: DONE
- Owner Role: Backend/QA
- Estimate: 1d
- Tasks:
  - Chạy load demo `300` devices đồng thời sau khi bật persistence
  - Verify alert, command, audit và telemetry persistence không gãy dưới tải
  - Đo sơ bộ response time cho endpoint chính và quan sát DB bottleneck
  - Ghi lại kết quả test, giới hạn hiện tại và hạng mục defer sang Sprint 5
- DoD:
  - Hệ thống giữ ổn định ở mốc `300` devices trong bài load demo
  - Persistence path không gây hỏng end-to-end flow hiện tại
  - Có verification notes đủ để quyết định scope Sprint 5

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S4-01 schema + Postgres repositories
- Day 3-4: S4-02 telemetry persistence v1
- Day 5: hardening write path và migration/bootstrap local

### Week 2
- Day 6-7: S4-03 reliability guardrails
- Day 8-9: S4-04 observability baseline
- Day 10: S4-05 load demo `300` devices + sprint review

## 3) Risks in Sprint 4
- Đưa persistence vào quá nhiều module cùng lúc dễ gây regression
  - Mitigation: ưu tiên `device/alert/audit/telemetry`, giữ write scope rõ và rollout từng repository
- Postgres trở thành bottleneck mới khi telemetry write tăng
  - Mitigation: append-only đơn giản trước, benchmark sớm với `300` devices rồi mới tối ưu sâu
- Reliability scope bị loãng giữa idempotency, reconnect và backpressure
  - Mitigation: chỉ chốt guardrails tối thiểu có thể verify được trong sprint này
- Observability bị làm nửa vời, không đủ hữu ích
  - Mitigation: chọn metric phục vụ trực tiếp 3 luồng chính `telemetry/alert/command`

## 4) Sprint 4 Exit Criteria
- Dữ liệu vận hành chính không còn phụ thuộc hoàn toàn vào `in-memory`
- Telemetry có persistence path tối thiểu để truy vết và debug
- Hệ thống có reliability/observability baseline cho Phase 2
- Load demo `300` devices` pass` với flow chính còn hoạt động

## 5) Verification Notes
- `cd server && npm run build` pass
- Observability smoke:
  - `GET /health/live` trả `healthy`
  - `GET /health/ready` trả `healthy` khi `DATABASE_URL` local được cấu hình
  - `GET /metrics` xuất Prometheus-style metrics cho `connected_devices`, `connected_clients`, `active_alerts`, `telemetry_ingest_total`, `command_send_total`
- Telemetry persistence smoke:
  - `GET /api/devices/last-telemetry` trả dữ liệu sau khi ingest từ simulator
  - Restart server với cùng `TELEMETRY_DATA_DIR` vẫn hydrate lại `last telemetry`
  - Raw telemetry được append xuống disk qua `telemetry-raw.ndjson` và snapshot `telemetry-last.json`
- Reliability smoke:
  - Guardrail ingest đã được cắm vào realtime path
  - Có metric/counter cho telemetry accepted/dropped, command ack, alert state change
- Postgres foundation:
  - Code bridge + schema + migration SQL đã được thêm
  - Local Postgres `16` đã được cài và bật trên `127.0.0.1:5432`
  - `DATABASE_URL=postgresql://ruby@localhost:5432/sgp_vibration_datacenter` đã được cấu hình cho local server
  - Schema auto-init tạo thành công các bảng: `device_metadata`, `device_sessions`, `alert_rules`, `alerts`, `audit_logs`
  - Verify qua restart:
    - `device metadata`, `alert rules`, `alerts`, `audit logs` còn sau restart
    - `device_sessions` không bị hydrate lại thành trạng thái online giả sau restart
- Kết quả thử `300 devices load demo` ngày `24/03/2026`:
  - Lần đầu với Postgres bật và simulator ramp-up `--ramp-step 20` chưa đạt quality gate
  - Simulator ghi nhận `306` connect/ack events nhưng có `119` disconnect events trong cửa sổ test
  - Snapshot DB cuối bài test:
    - `device_sessions=184`
    - `device_metadata=241`
    - `alerts=2400`
    - `audit_logs=2`
  - Command gửi vào một device đang online (`esp-001`) thành công
  - Tuy nhiên hệ thống không giữ được `300 concurrent devices` ổn định và `health/metrics` phản hồi chậm dưới tải
- Kết quả rerun sau tối ưu write path ngày `24/03/2026`:
  - Đã rerun với Postgres bật và simulator ramp-up `--ramp-step 20`
  - Simulator ghi nhận `300` connect events, `300` ack events và `300` disconnect events khi bài test kết thúc đúng hạn
  - Snapshot giữa bài test:
    - `device_sessions=300`
    - `device_metadata=300`
    - `alerts=1586`
    - `audit_logs=0`
  - Command gửi dưới tải vào `esp-001` thành công và trả `commandId`
  - Snapshot sau khi simulator kết thúc:
    - `device_sessions=0`
    - `device_metadata=300`
    - `alerts=2873`
    - `audit_logs=1`
  - `GET /health/ready` và `GET /health/live` vẫn trả `healthy` sau bài chạy
  - Kết luận hiện tại: `S4-05` pass và Sprint 4 đủ điều kiện đóng
