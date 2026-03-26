# SPRINT-9 PLAN (2 Weeks)

Timeline đề xuất: 14/07/2026 - 27/07/2026
Sprint Goal: Xây rollout framework v1 cho cấu hình/firmware theo cohort với chiến lược canary + rollback an toàn, đồng thời nâng Fleet Console UI v2 để theo dõi rollout theo từng wave rõ ràng.

## Scope Notes
- Sprint 9 là nửa giữa của `Phase 4: Fleet Management`.
- Sprint 8 đã có group/cohort + batch config, nên Sprint 9 tập trung vào orchestration rollout và kiểm soát rủi ro.
- OTA firmware đầy đủ chưa cần chốt trong sprint này; ưu tiên rollout framework chung dùng lại cho config trước, firmware sau.

## Progress Checklist (Khởi tạo ngày 25/03/2026)
- [x] S9-01 Rollout Plan/Execution Domain Model
- [x] S9-02 Canary + Wave-based Rollout Engine
- [x] S9-03 Auto-Stop + Rollback Safety Rules
- [x] S9-04 Fleet Console UI v2 (Rollout Timeline + Wave Control)
- [x] S9-05 Quality Gate + 900 Devices Rollout Drill

## 1) Sprint Backlog

## Story S9-01: Rollout Plan/Execution Domain Model
- Status: DONE (25/03/2026)
- Owner Role: Backend/Data
- Estimate: 2d
- Tasks:
  - Thiết kế model `rollout_plans`, `rollout_waves`, `rollout_executions`, `rollout_events`
  - API tạo rollout plan theo cohort + strategy (`all-at-once`, `wave`, `canary`)
  - Lưu immutable event timeline cho mỗi rollout
  - Bổ sung query/filter rollout theo site/group/status/time
- DoD:
  - Có lifecycle rollout rõ ràng: `draft -> scheduled -> running -> paused -> completed/failed/rolled_back`
  - Timeline rollout đủ để forensic và handover
  - Query rollout đủ dùng cho ops review

## Story S9-02: Canary + Wave-based Rollout Engine
- Status: DONE (25/03/2026)
- Owner Role: Backend/Ops
- Estimate: 3d
- Tasks:
  - Engine dispatch theo wave (% hoặc fixed-size)
  - Hỗ trợ pause/resume/cancel rollout
  - Gate chuyển wave theo điều kiện success ratio + timeout ratio
  - Tối ưu fan-out để không gây spike bất thường
- DoD:
  - Rollout canary/wave chạy tuần tự và có kiểm soát
  - Có thể pause/resume khi phát hiện tín hiệu xấu
  - Không làm nghẽn realtime/alert path dưới tải mục tiêu

## Story S9-03: Auto-Stop + Rollback Safety Rules
- Status: DONE (25/03/2026)
- Owner Role: Backend/SRE
- Estimate: 1.5d
- Tasks:
  - Rule auto-stop khi vượt ngưỡng lỗi/timeouts
  - Rollback command plan theo cohort/wave đã áp dụng
  - Manual override với quyền `admin` + note bắt buộc
  - Chuẩn hóa failure reason và incident hook cho rollout failure
- DoD:
  - Rollout dừng an toàn khi vượt ngưỡng rủi ro
  - Có rollback flow khả dụng và kiểm chứng được
  - Failure semantics rõ để tích hợp runbook/incident

## Story S9-04: Fleet Console UI v2 (Rollout Timeline + Wave Control)
- Status: DONE (25/03/2026)
- Owner Role: Frontend/Backend
- Estimate: 2d
- Tasks:
  - UI tạo rollout plan với wizard tối thiểu (target, strategy, gate)
  - Hiển thị rollout timeline theo wave: sent/acked/timeout/fail
  - Thêm action pause/resume/cancel/rollback
  - Thêm cảnh báo rõ trước action nguy cơ cao
- DoD:
  - Operator quản lý rollout lifecycle từ UI, không chỉ qua API
  - Timeline/wave state đọc nhanh, hỗ trợ quyết định trong ca trực
  - UI có safety affordance rõ cho thao tác rollout diện rộng

## Story S9-05: Quality Gate + 900 Devices Rollout Drill
- Status: DONE (25/03/2026)
- Owner Role: Backend/QA/Ops
- Estimate: 1.5d
- Tasks:
  - Drill rollout với `900` devices theo 3 wave + 1 canary phase
  - Mô phỏng lỗi một phần để verify auto-stop/rollback
  - Capture metrics: success ratio, timeout ratio, median wave duration
  - Chốt backlog cứng cho Sprint 10 (phase closeout)
- DoD:
  - Rollout framework hoạt động ổn định ở tải gần mốc phase exit
  - Auto-stop/rollback được chứng minh bằng case drill
  - Có dữ liệu để tự tin chốt 1000+ device gate ở Sprint 10

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S9-01 rollout domain model + API
- Day 3-5: S9-02 wave/canary engine

### Week 2
- Day 6: S9-03 auto-stop + rollback
- Day 7-8: S9-04 fleet console UI v2
- Day 9-10: S9-05 rollout drill `900` devices

## 3) Risks in Sprint 9
- Rollout engine ảnh hưởng luồng command hiện tại
  - Mitigation: reuse command service qua adapter, không bypass guard/retry logic sẵn có
- Gate wave quá chặt hoặc quá lỏng
  - Mitigation: expose ngưỡng cấu hình + lưu decision reason cho từng wave
- Rollback không đồng bộ với trạng thái thực tế thiết bị
  - Mitigation: track per-device apply/ack state và rollback theo danh sách đã apply
- UI rollout nhiều trạng thái dễ gây nhầm
  - Mitigation: dùng state machine label rõ ràng và disable action không hợp lệ

## 4) Sprint 9 Exit Criteria
- Có rollout framework v1 với canary/wave lifecycle đầy đủ
- Có auto-stop + rollback flow an toàn cho tình huống lỗi
- Fleet Console UI v2 quản trị rollout end-to-end
- Drill `900` devices pass với dữ liệu vận hành minh bạch
- Đủ nền để Sprint 10 chốt quality gate `1000+` devices và hoàn tất `Phase 4`

## 5) Verification Notes (Template)
- `cd server && npm run build`
- Verify rollout plan lifecycle + event timeline
- Verify canary/wave transitions + gate decisions
- Verify auto-stop + rollback trên fault-injection case
- Verify UI rollout actions (pause/resume/cancel/rollback)
- Verify drill `900` devices + metrics summary

## 6) Verification Run (25/03/2026)
- `cd web && pnpm build` => PASS
- `cd server && pnpm build` => PASS
- `cd server && pnpm quality:s9 -- --device-count 900 --min-connected 850 --poll-timeout-ms 240000` => PASS
- Drill result: target `900`, completed waves `3`, auto-stop triggered, rollback completed, final status `rolled_back`.
