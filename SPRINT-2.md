# SPRINT-2 PLAN (2 Weeks)

Timeline đề xuất: 07/04/2026 - 20/04/2026
Sprint Goal: Hoàn thiện MVP vận hành cơ bản với alerting v1, lọc thiết bị theo site/zone/status và audit log cho command flow.

## Scope Notes
- Sprint 2 bám vào phần còn thiếu của Phase 1 trong `ROADMAP.md`: Alerting v1 và một phần Auth/Audit nhẹ để hỗ trợ vận hành.
- Chưa đưa Auth/RBAC đầy đủ vào sprint này để tránh scope quá rộng khi codebase hiện tại vẫn đang dùng repository in-memory cho luồng core.
- Ưu tiên kết quả demo vận hành: telemetry -> alert -> dashboard/API -> command audit.

## Progress Checklist (Cập nhật ngày 24/03/2026)
- [x] S2-01 Device Registry Filter & Query API
- [x] S2-02 Alert Rule Engine v1
- [x] S2-03 Alert API + Dashboard/Test Tool Integration
- [x] S2-04 Command Audit Log v1
- [x] S2-05 Quality Gate + Local Demo 50 Devices

## 1) Sprint Backlog

## Story S2-01: Device Registry Filter & Query API
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - Mở rộng `GET /api/devices` với query `site`, `zone`, `status`, `search`
  - Chuẩn hóa response để frontend/test tool lọc được device đang online/offline
  - Bổ sung test cho filter combinations cơ bản
- DoD:
  - Có thể lọc thiết bị theo `site/zone/status`
  - Có thể tìm theo `deviceId` hoặc `name`
  - API trả dữ liệu ổn định cho dashboard/test tool

## Story S2-02: Alert Rule Engine v1
- Status: DONE
- Owner Role: Backend
- Estimate: 3d
- Tasks:
  - Định nghĩa model rule cho `temperature` và `vibration`
  - Hỗ trợ severity `warning/critical`
  - Áp dụng debounce theo số lần vượt ngưỡng liên tiếp
  - Áp dụng cooldown để không spam alert liên tục
  - Hook evaluate rule ngay sau bước telemetry ingest
- DoD:
  - Telemetry vượt ngưỡng liên tiếp tạo alert đúng rule
  - Cooldown hoạt động, không phát lại alert dồn dập
  - Alert có đầy đủ `deviceId`, metric, severity, triggeredAt

## Story S2-03: Alert API + Dashboard/Test Tool Integration
- Status: DONE
- Owner Role: Backend/Frontend
- Estimate: 2d
- Tasks:
  - Tạo API list alert active/history
  - Tạo API CRUD tối thiểu cho alert rules
  - Broadcast event alert tới dashboard/test tool khi có alert mới
  - Mở rộng `/dashboard-test` để hiển thị alert stream cơ bản
- DoD:
  - Có thể xem alert active và history qua API
  - Dashboard/test tool thấy alert mới theo realtime hoặc polling nhẹ
  - Có thể tạo/chỉnh rule để phục vụ demo local

## Story S2-04: Command Audit Log v1
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - Ghi audit record cho mỗi command gửi từ API
  - Lưu tối thiểu `commandId`, `deviceId`, `type`, `actor`, `createdAt`, `result`
  - Tạo endpoint xem recent audit logs
  - Gắn source mặc định cho dashboard/test tool nếu chưa có auth user thật
- DoD:
  - Mọi command qua API đều có audit record
  - Có thể truy vấn lịch sử audit gần nhất
  - Audit payload đủ để trace command flow khi demo/smoke test

## Story S2-05: Quality Gate + Local Demo 50 Devices
- Status: DONE
- Owner Role: Backend/QA
- Estimate: 1.5d
- Tasks:
  - Bổ sung smoke scenario: 50 device giả lập gửi telemetry đồng thời
  - Verify alert trigger, command send, audit log và device filter
  - Đảm bảo `pnpm build` pass và không có lỗi nghiêm trọng trong local run
- DoD:
  - Demo được luồng `device -> telemetry -> alert -> dashboard -> command -> audit`
  - Server xử lý ổn định với 50 device giả lập trên local
  - Build pass, logs đủ quan sát để debug nhanh

## 2) Daily Plan Suggestion

### Week 1
- Day 1: S2-01 và chốt shape response cho device filters
- Day 2-4: S2-02 alert rule engine + test cases
- Day 5: hardening evaluate flow trên telemetry ingest

### Week 2
- Day 6-7: S2-03 alert API + dashboard/test integration
- Day 8: S2-04 command audit log
- Day 9: S2-05 smoke test + bugfix
- Day 10: Sprint review + retro + prepare Sprint 3

## 3) Risks in Sprint 2
- Alert rule bị oversensitive gây false alert
  - Mitigation: debounce + cooldown mặc định, có fixture telemetry để test ngưỡng
- Scope creep sang Auth/RBAC đầy đủ
  - Mitigation: chỉ làm audit log v1 và actor/source tối thiểu trong sprint này
- In-memory repository khó mở rộng khi thêm alert/audit
  - Mitigation: tách interface repository rõ ràng để Sprint 3/4 thay backend lưu trữ
- Dashboard/test tool bị quá tải khi vừa nhận telemetry vừa nhận alert
  - Mitigation: giới hạn hiển thị recent items và ưu tiên dữ liệu demo quan trọng

## 4) Sprint 2 Exit Criteria
- Có alerting v1 chạy end-to-end từ telemetry thật/simulator
- API lọc device theo `site/zone/status` hoạt động đúng
- Command audit log truy vết được luồng điều khiển cơ bản
- Demo local thành công với 50 device giả lập, không có lỗi nghiêm trọng P1

## 5) Verification Notes
- `cd server && npm run build` pass
- Smoke test local với `50` device giả lập:
  - `GET /health` cho thấy `connectedDevices: 50`, `connectedClients: 50`
  - `GET /api/devices?status=online` trả danh sách thiết bị online dưới tải
  - `GET /api/alerts` trả alert active/resolved từ telemetry mô phỏng
  - `POST /api/devices/esp-010/commands` thành công trong cửa sổ tải
  - `GET /api/audit-logs?deviceId=esp-010` trả audit record tương ứng
