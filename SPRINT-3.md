# SPRINT-3 PLAN (2 Weeks)

Timeline đề xuất: 21/04/2026 - 04/05/2026
Sprint Goal: Hoàn tất Phase 1 bằng cách bổ sung Auth/RBAC v1, siết audit cho thao tác quản trị và xác nhận MVP chạy ổn định với 100 device mô phỏng.

## Scope Notes
- Sprint 3 là nửa sau của `Phase 1: MVP Core` trong `ROADMAP.md`.
- Sprint 2 đã hoàn tất alerting v1, audit log command cơ bản và local demo 50 devices; phần còn thiếu lớn nhất của Phase 1 là `Auth/RBAC v1`.
- Chưa đi vào persistence time-series hay reliability sâu của Phase 2 trong sprint này để tránh kéo giãn scope trước khi MVP core hoàn chỉnh.

## Progress Checklist (Cập nhật ngày 24/03/2026)
- [x] S3-01 User Auth v1
- [x] S3-02 RBAC Guard cho API nhạy cảm
- [x] S3-03 Audit Log mở rộng cho rule/config changes
- [x] S3-04 Rule Management Hardening + Dashboard/Test Tool Auth Flow
- [x] S3-05 Quality Gate + 100 Devices Soak Demo

## 1) Sprint Backlog

## Story S3-01: User Auth v1
- Status: DONE
- Owner Role: Backend
- Estimate: 2d
- Tasks:
  - Thiết kế auth đơn giản cho môi trường nội bộ: API key hoặc bearer token theo user role
  - Tạo danh sách user/credential seed tối thiểu cho `admin`, `operator`, `viewer`
  - Tạo endpoint/session bootstrap hoặc middleware parse auth header
  - Chuẩn hóa principal object gắn vào request context
- DoD:
  - API quản trị yêu cầu thông tin xác thực hợp lệ
  - Có thể phân biệt user theo role trong runtime
  - Cấu hình local demo đủ đơn giản để QA/operator dùng được

## Story S3-02: RBAC Guard cho API nhạy cảm
- Status: DONE
- Owner Role: Backend
- Estimate: 2d
- Tasks:
  - Áp policy role cho endpoint command, alert rule CRUD và audit query nhạy cảm
  - `viewer` chỉ đọc
  - `operator` được gửi command và xem dữ liệu vận hành
  - `admin` được chỉnh rule/cấu hình và xem audit đầy đủ
- DoD:
  - Endpoint nhạy cảm trả `401/403` đúng ngữ nghĩa khi không đủ quyền
  - Policy role được gom logic chung, không copy-paste trong từng route
  - Có test matrix cơ bản cho `admin/operator/viewer`

## Story S3-03: Audit Log mở rộng cho Rule/Config Changes
- Status: DONE
- Owner Role: Backend
- Estimate: 1.5d
- Tasks:
  - Ghi audit record khi tạo/sửa alert rule
  - Ghi actor, before/after summary và target resource
  - Cho phép lọc audit theo `user/device/action/time range` ở mức tối thiểu
  - Chuẩn hóa event name để chuẩn bị nối Phase 2/3
- DoD:
  - Mọi thay đổi rule/config qua API đều có audit record
  - Có thể truy vấn lịch sử thao tác theo actor hoặc action
  - Payload audit đủ để trace “ai đổi gì, lúc nào”

## Story S3-04: Rule Management Hardening + Dashboard/Test Tool Auth Flow
- Status: DONE
- Owner Role: Backend/Frontend
- Estimate: 2d
- Tasks:
  - Bổ sung auth input đơn giản cho `/dashboard-test`
  - Hiển thị role hiện tại và trạng thái authorize
  - Disable/hide action không phù hợp theo role trong test tool
  - Xử lý rõ các trạng thái `401/403` trên command/rule actions
- DoD:
  - Dashboard/test tool có thể chạy với `viewer/operator/admin`
  - User thấy rõ action nào bị chặn do role
  - Demo auth flow trơn tru cho bài review sprint

## Story S3-05: Quality Gate + 100 Devices Soak Demo
- Status: DONE
- Owner Role: Backend/QA
- Estimate: 2.5d
- Tasks:
  - Nâng smoke test từ `50` lên `100` devices
  - Chạy soak tối thiểu 30-60 phút local/staging nhỏ để quan sát reconnect, alert flow và command flow
  - Thu thập số liệu success rate tối thiểu cho telemetry/command
  - Xác nhận dashboard realtime không trễ bất thường dưới tải mục tiêu MVP
- DoD:
  - `100` device mô phỏng chạy ổn định trong cửa sổ soak test
  - Alert và command vẫn hoạt động end-to-end
  - Có ghi chú kết quả soak test và lỗi còn tồn dư nếu có

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S3-01 auth model + request principal
- Day 3-4: S3-02 RBAC guards cho command/rule endpoints
- Day 5: S3-03 audit log mở rộng

### Week 2
- Day 6-7: S3-04 dashboard/test tool auth integration
- Day 8-9: S3-05 soak test 100 devices + hardening
- Day 10: Sprint review + retro + quyết định vào Phase 2

## 3) Risks in Sprint 3
- Auth thiết kế quá nặng cho nhu cầu local-first
  - Mitigation: ưu tiên token/API key role-based đơn giản, chưa cần full identity provider
- RBAC bị cấy trực tiếp vào route gây khó mở rộng
  - Mitigation: tách middleware/guard dùng lại được
- Audit payload phình to, khó đọc
  - Mitigation: lưu before/after summary ngắn gọn, chưa làm snapshot đầy đủ
- 100 device soak test tạo false confidence nếu thời lượng quá ngắn
  - Mitigation: ghi rõ duration, giới hạn môi trường và lỗi tồn đọng trong verification notes

## 4) Sprint 3 Exit Criteria
- Auth/RBAC v1 hoạt động cho `admin/operator/viewer`
- Endpoint nhạy cảm được bảo vệ đúng role
- Audit log bao phủ command + rule/config changes
- MVP core demo ổn định với `100` devices mô phỏng và đủ điều kiện khép lại Phase 1

## 5) Verification Notes
- `cd server && npm run build` pass
- Auth/RBAC smoke test:
  - `GET /api/auth/me` không auth trả `authenticated: false`
  - `GET /api/devices` không auth trả `401`
  - `GET /api/devices` với `viewer-local-key` trả `200`
  - `POST /api/devices/:deviceId/commands` với `viewer-local-key` trả `403`
  - `POST /api/devices/:deviceId/commands` với `operator-local-key` vượt qua RBAC và xử lý tiếp business flow
  - `POST /api/alert-rules` với `operator-local-key` trả `403`
  - `POST /api/alert-rules` với `admin-local-key` trả `201`
  - `GET /api/audit-logs` với `admin-local-key` query được rule change audit
- Load smoke `100` devices:
  - `GET /health` cho thấy `connectedDevices: 100`, `connectedClients: 100`
  - `POST /api/devices/esp-050/commands` với `operator-local-key` thành công dưới tải
  - `GET /api/alerts` với `viewer-local-key` vẫn trả dữ liệu dưới tải
- Soak `30 phút` với `100` devices:
  - Sample `02` tới `30` trong `monitor.log` đều giữ `connectedDevices: 100` và `connectedClients: 100`
  - Sample `31` về `0/0` đúng thời điểm simulator kết thúc, không phải do crash giữa chừng
  - Không ghi nhận rớt session hàng loạt hay server stop trong cửa sổ soak
