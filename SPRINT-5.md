# SPRINT-5 PLAN (2 Weeks)

Timeline đề xuất: 19/05/2026 - 01/06/2026
Sprint Goal: Khép lại `Phase 2: Data & Reliability` bằng cách harden persistence path cho tải cao hơn, bổ sung truy vết telemetry theo retention/downsample, dựng technical dashboard tối thiểu và chốt quality gate `500` devices.

## Scope Notes
- Sprint 5 là nửa sau của `Phase 2: Data & Reliability` trong `ROADMAP.md`.
- Sprint 4 đã đạt `300` devices với Postgres bật, nhưng write path vẫn còn tính chất bridge/tạm thời và chưa chạm exit criteria `300-500` devices + `P95 API < 250ms`.
- Sprint này vẫn ưu tiên backend/ops; chưa mở rộng sang incident workflow hay UX product-facing của `Phase 3`.

## Progress Checklist (Khởi tạo ngày 24/03/2026)
- [x] S5-01 Persistence Path Hardening
- [x] S5-02 Telemetry Query + Retention v2
- [x] S5-03 Performance Tuning + API Latency Gate
- [x] S5-04 Technical Ops Dashboard v1
- [x] S5-05 Quality Gate + 500 Devices Load Demo

## 1) Sprint Backlog

## Story S5-01: Persistence Path Hardening
- Status: DONE
- Owner Role: Backend
- Estimate: 2.5d
- Tasks:
  - Thay các hot path đang dùng sync bridge/worker bằng access layer Postgres async rõ ràng hơn
  - Gom/batch write hợp lý cho alert/audit/session updates để giảm write amplification
  - Rà lại schema/index cho các bảng nóng: `device_metadata`, `alerts`, `audit_logs`
  - Ghi rõ failure mode khi Postgres chậm, unavailable hoặc backlog tăng
- DoD:
  - Hot path không còn block event loop bởi persistence internals
  - DB access layer đủ rõ để tiếp tục scale hoặc tách service sau này
  - Có benchmark trước/sau cho write-heavy path

## Story S5-02: Telemetry Query + Retention v2
- Status: DONE
- Owner Role: Backend/Data
- Estimate: 2d
- Tasks:
  - Thêm query path tối thiểu cho lịch sử telemetry theo `deviceId` + time window
  - Sinh downsample cơ bản theo bucket để phục vụ inspect ngắn hạn
  - Bổ sung retention cleanup job/script cấu hình được
  - Tài liệu hóa giới hạn hiện tại của file-backed raw storage và đường nâng cấp time-series store
- DoD:
  - Có thể đọc lại telemetry history theo khoảng thời gian cơ bản
  - Retention policy chạy được và không phá realtime path
  - Downsample đủ để dashboard kỹ thuật không phải đọc toàn bộ raw data

## Story S5-03: Performance Tuning + API Latency Gate
- Status: DONE
- Owner Role: Backend/Perf
- Estimate: 2d
- Tasks:
  - Đo P95 cho các endpoint chính: `GET /health`, `GET /api/devices`, `GET /api/alerts`, `GET /api/audit-logs`
  - Tối ưu query/index/cache nhẹ cho các endpoint không đạt mục tiêu
  - Rà lại alert churn, log volume, và broadcast fan-out dưới tải
  - Ghi benchmark note đủ để so sánh trước/sau tuning
- DoD:
  - P95 endpoint chính < `250ms` trong bài test mục tiêu
  - Có số liệu benchmark và bottleneck notes rõ ràng
  - Không tạo regression cho auth/RBAC, command, alert flow hiện tại

## Story S5-04: Technical Ops Dashboard v1
- Status: DONE
- Owner Role: Backend/Ops
- Estimate: 2d
- Tasks:
  - Dựng trang/dashboard kỹ thuật tối thiểu cho health, readiness, metrics, active alerts, ingest throughput
  - Hiển thị trạng thái Postgres persistence, device connectivity, command success/failure
  - Thêm filter thời gian/ngữ cảnh tối thiểu để operator backend đọc nhanh
  - Giữ giao diện gọn, phục vụ ops/debug, không biến thành product dashboard
- DoD:
  - Có technical dashboard đủ để quan sát backend trong load demo
  - Dữ liệu chính lấy từ metrics/health/API hiện hữu, không tạo luồng riêng khó bảo trì
  - Operator có thể dùng dashboard để xác nhận tình trạng hệ thống mà không cần đọc log thô liên tục

## Story S5-05: Quality Gate + 500 Devices Load Demo
- Status: DONE
- Owner Role: Backend/QA
- Estimate: 1.5d
- Tasks:
  - Chạy load demo `500` devices với Postgres bật và observability dashboard mở
  - Verify `telemetry -> alert -> command -> audit` còn hoạt động dưới tải
  - Capture latency, health/readiness, DB counts, alert churn và failure notes
  - Chốt deferred items cho `Phase 3`
- DoD:
  - Hệ thống giữ ổn định ở mốc `500` devices trong cửa sổ test mục tiêu
  - Endpoint chính đạt ngưỡng `P95 < 250ms`
  - Có verification notes đủ để kết luận hoàn tất `Phase 2`

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S5-01 hardening Postgres access layer + index review
- Day 3-4: S5-02 telemetry query/downsample/retention
- Day 5: benchmark vòng 1 + fix bottleneck rõ ràng nhất

### Week 2
- Day 6-7: S5-03 performance tuning + latency verification
- Day 8-9: S5-04 technical ops dashboard
- Day 10: S5-05 load demo `500` devices + phase review

## 3) Risks in Sprint 5
- Persistence refactor có thể làm vỡ luồng đã ổn định ở Sprint 4
  - Mitigation: giữ interface/repository rõ, benchmark từng bước, không đổi tất cả cùng lúc
- Downsample/retention làm phức tạp telemetry path quá sớm
  - Mitigation: chỉ làm mức tối thiểu đủ cho query và cleanup, chưa đẩy sang time-series stack mới
- Dashboard kỹ thuật bị trôi thành UI product
  - Mitigation: chỉ lấy metric/health hiện hữu, tập trung vào vận hành backend
- Quality gate `500` devices có thể lộ bottleneck mới ở fan-out hoặc query path
  - Mitigation: chốt benchmark sớm, tối ưu endpoint nóng trước ngày load demo cuối

## 4) Sprint 5 Exit Criteria
- Persistence path đủ bền cho tải cao hơn, không còn phụ thuộc vào bridge tạm thời ở hot path
- Có telemetry history/query + retention/downsample tối thiểu cho debug vận hành
- Endpoint chính đạt `P95 < 250ms` trong bài test mục tiêu
- Technical dashboard phục vụ vận hành backend hoạt động được
- Load demo `500` devices` pass`, đủ điều kiện hoàn tất `Phase 2`

## 5) Verification Notes
- `cd server && npm run build` pass
- Persistence hardening:
  - bootstrap repo chuyển sang async với `pg.Pool` trực tiếp qua `postgres-access.ts`
  - hot path write không còn phụ thuộc vào worker + `Atomics.wait`
  - `GET /health/ready` vẫn trả `healthy` với Postgres local
  - `GET /api/alerts` và `GET /api/audit-logs` vẫn query được sau refactor
- Telemetry query v2:
  - thêm `GET /api/devices/:deviceId/telemetry`
  - hỗ trợ `from`, `to`, `limit`, `bucketMs`
  - retention cleanup tối thiểu được gọi lúc khởi tạo telemetry store qua `TELEMETRY_RETENTION_HOURS`
  - telemetry store giữ index theo `deviceId` trong memory thay vì quét toàn bộ file raw ở mỗi query
  - smoke với simulator `2` devices xác nhận endpoint trả dữ liệu bucketed và `sampleCount`
  - đo nhanh local:
    - trước tối ưu: khoảng `490ms` cho `GET /api/devices/esp-001/telemetry?limit=3&bucketMs=1000`
    - sau tối ưu: khoảng `33ms` cho `GET /api/devices/esp-001/telemetry?limit=20&bucketMs=1000`
- Performance tuning + latency gate:
  - bottleneck chính dưới tải `500` devices không nằm ở Postgres mà ở realtime fan-out
  - sửa broadcast telemetry/alert chỉ gửi tới dashboard clients thay vì phát tới toàn bộ socket clients
  - giảm alert log volume từ `warn` xuống `debug` để tránh log churn khi alert state đổi nhiều
  - đo P95 với `30` samples/endpoint trong lúc hệ thống giữ đủ `500` devices:
    - `GET /health`: `15.903ms`
    - `GET /api/devices?status=online`: `21.442ms`
    - `GET /api/alerts?status=all&limit=20`: `32.194ms`
    - `GET /api/audit-logs?limit=20`: `11.531ms`
- Technical ops dashboard v1:
  - thêm panel `Ops Health`, `Metrics Snapshot`, `Telemetry Inspect` vào `/dashboard-test`
  - thêm `GET /api/ops/metrics` trả JSON snapshot từ metrics registry
  - dashboard đọc trực tiếp từ health/metrics/API hiện hữu, không tạo luồng dữ liệu riêng
  - verify dưới tải với `500` devices cho thấy operator vẫn đọc được health, metrics snapshot, alert state và telemetry inspect
- Quality gate `500` devices:
  - bài load dùng Postgres bật với simulator `500` devices, `--interval 1000 --ramp-step 15 --duration 180`
  - trạng thái trong tải:
    - `/health`: `connectedDevices=500`, `connectedClients=500`
    - `/api/ops/metrics`: `device_connections_total=500`, `telemetry_ingest_total=19089`, `alert_state_changes_total=3632`
    - DB snapshot: `device_sessions=500`, `device_metadata=500`, `alerts=10059`, `audit_logs=1`
  - verify flow dưới tải:
    - `POST /api/devices/esp-010/commands` với `operator-local-key` thành công
    - `GET /api/audit-logs?limit=5` với `admin-local-key` trả được audit record mới
  - trạng thái sau khi simulator tự kết thúc:
    - `/health`: `connectedDevices=0`, `connectedClients=0`
    - DB snapshot: `device_sessions=0`, `device_metadata=500`, `alerts=15610`, `audit_logs=2`
  - simulator disconnect sạch `500` devices do kết thúc test đúng hạn, không có dấu hiệu server gãy giữa bài
