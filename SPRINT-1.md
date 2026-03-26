# SPRINT-1 PLAN (2 Weeks)

Timeline đề xuất: 24/03/2026 - 06/04/2026
Sprint Goal: Hoàn thiện lõi realtime Socket.IO + registry + command flow để demo end-to-end trên local network.

## Progress Checklist (Cập nhật ngày 24/03/2026)
- [x] S1-01 Event Contract v1
- [x] S1-02 Device Socket Auth + Identity
- [x] S1-03 Device Registry API v1
- [x] S1-04 Telemetry Ingest + Broadcast
- [x] S1-05 Command API v1 + state machine `sent/acked/timeout`
- [x] S1-06 Minimal Dashboard Connector (Test Tool)
- [x] S1-07 Quality Gate (`pnpm build` pass)
- [x] S1-04 DoD phụ: có device simulator script để test đa thiết bị

## 1) Sprint Backlog

## Story S1-01: Event Contract v1
- Status: DONE
- Owner Role: Backend
- Estimate: 1d
- Tasks:
  - Viết schema events (`device:heartbeat`, `device:telemetry`, `device:command`, `telemetry`)
  - Chuẩn hóa field bắt buộc/tùy chọn
  - Tạo docs ví dụ payload
- DoD:
  - Có tài liệu event contract trong repo
  - Device simulator gửi được payload đúng schema

## Story S1-02: Device Socket Auth + Identity
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - `DEVICE_AUTH_TOKEN` check
  - Validate `deviceId` khi handshake
  - Reject kết nối không hợp lệ
- DoD:
  - Unauthorized device không thể publish telemetry
  - Có log phân loại device/dashboard client

## Story S1-03: Device Registry API v1
- Status: DONE
- Owner Role: Backend
- Estimate: 2d
- Tasks:
  - Tạo model Device (in-memory hoặc DB seed)
  - Endpoint: list/get/create/update basic metadata
  - Gắn online/offline state theo heartbeat timeout
- DoD:
  - API hoạt động cho luồng đăng ký và truy vấn trạng thái
  - Test API basic pass

## Story S1-04: Telemetry Ingest + Broadcast
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - Validate telemetry payload bằng zod
  - Cập nhật `lastTelemetry` theo `deviceId`
  - Broadcast event `telemetry` tới dashboard
- DoD:
  - Dashboard nhận realtime telemetry từ >=10 device giả lập
  - Payload lỗi bị reject có log

## Story S1-05: Command API v1
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - Endpoint `POST /api/devices/:deviceId/commands`
  - Emit `device:command` tới room theo device
  - Trả lỗi chuẩn khi device offline
- DoD:
  - Command gửi thành công cho device online
  - Device offline trả `404 device_not_connected`

## Story S1-06: Minimal Dashboard Connector (Test Tool)
- Status: DONE
- Owner Role: Frontend/Backend
- Estimate: 1d
- Tasks:
  - Trang test connect Socket.IO
  - Hiển thị incoming telemetry stream
  - Trigger command test
- DoD:
  - Demo được luồng device -> server -> dashboard -> command

## Story S1-07: Quality Gate
- Status: DONE
- Owner Role: Backend
- Estimate: 1d
- Tasks:
  - Typecheck/build pipeline
  - Script smoke test local
  - Kiểm tra structured logs
- DoD:
  - `pnpm build` pass
  - Smoke test pass trên môi trường local

## 2) Daily Plan Suggestion

### Week 1
- Day 1: S1-01, khởi tạo docs và schema
- Day 2: S1-02
- Day 3-4: S1-03
- Day 5: S1-04

### Week 2
- Day 6-7: S1-05
- Day 8: S1-06
- Day 9: S1-07 + bugfix
- Day 10: Sprint review + retro + prepare Sprint 2

## 3) Risks in Sprint 1
- Device payload thay đổi liên tục
  - Mitigation: version field + adapter
- Realtime flood khi nhiều device gửi cùng lúc
  - Mitigation: throttling + sampling policy
- Device reconnect loop
  - Mitigation: backoff policy + heartbeat timeout tuning

## 4) Sprint 1 Exit Criteria
- End-to-end demo thành công với device simulator
- API core và realtime flow ổn định
- Build pass, logs quan sát được, không lỗi nghiêm trọng P1
