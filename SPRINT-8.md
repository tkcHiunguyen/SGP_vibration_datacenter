# SPRINT-8 PLAN (2 Weeks)

Timeline đề xuất: 30/06/2026 - 13/07/2026
Sprint Goal: Mở `Phase 4: Fleet Management` bằng cách chuẩn hóa mô hình `group/cohort`, cho phép thao tác cấu hình theo nhóm thiết bị và dựng Fleet Console UI v1 để team vận hành không còn thao tác thủ công từng device.

## Scope Notes
- Sprint 8 là nửa đầu của `Phase 4: Fleet Management` trong `ROADMAP.md`.
- Sprint 7 đã khép `Phase 3` (incident/report/noise control), nên trọng tâm giờ chuyển sang năng lực quản trị fleet quy mô lớn.
- Sprint này ưu tiên nền tảng grouping + batch config + UI vận hành tương ứng; OTA rollout chỉ dựng khung ở mức chuẩn bị.

## Progress Checklist (Khởi tạo ngày 25/03/2026)
- [x] S8-01 Fleet Grouping Model + Cohort API
- [x] S8-02 Batch Config Apply + Dry-Run Guard
- [x] S8-03 Policy Engine v1 (Site/Zone Baseline)
- [x] S8-04 Fleet Console UI v1 (Groups + Batch Actions)
- [x] S8-05 Quality Gate + 700 Devices Fleet Demo

## 1) Sprint Backlog

## Story S8-01: Fleet Grouping Model + Cohort API
- Status: DONE
- Owner Role: Backend/Data
- Estimate: 2.5d
- Tasks:
  - Thiết kế model `device_groups` + `device_group_members` (hỗ trợ `site`, `zone`, `firmware`, `tag`, `custom query`)
  - Thêm API CRUD cho group và API preview member list theo filter
  - Hỗ trợ static membership + dynamic rule-based cohort cơ bản
  - Thêm audit trail cho thao tác tạo/sửa/xóa group
- DoD:
  - Operator tạo và quản lý group/cohort qua API ổn định
  - Có thể preview danh sách device trước khi chạy action batch
  - Group operation có audit log rõ ràng để trace

## Story S8-02: Batch Config Apply + Dry-Run Guard
- Status: DONE
- Owner Role: Backend/Ops
- Estimate: 2.5d
- Tasks:
  - Thêm batch command API theo group/cohort với command type `set_config`
  - Hỗ trợ `dry-run` để trả số thiết bị bị ảnh hưởng + preview payload
  - Bổ sung guard: hạn mức số lượng thiết bị/lần, note bắt buộc, role check
  - Ghi batch execution record: requested, dispatched, acked, timeout, failed
- DoD:
  - Có thể apply config theo group mà không gửi tay từng device
  - Dry-run giúp operator kiểm tra phạm vi trước khi apply thật
  - Có kết quả execution để đối soát sau batch run

## Story S8-03: Policy Engine v1 (Site/Zone Baseline)
- Status: DONE
- Owner Role: Backend/SRE
- Estimate: 1.5d
- Tasks:
  - Dựng policy schema baseline theo `site/zone` cho các thông số cấu hình mặc định
  - API attach/detach policy vào group
  - Cơ chế validate conflict policy tối thiểu (ưu tiên explicit override)
  - Audit policy change với before/after summary
- DoD:
  - Site/zone có baseline config rõ ràng theo policy
  - Policy attach/change có validation + audit
  - Conflict resolution có rule nhất quán cho vận hành

## Story S8-04: Fleet Console UI v1 (Groups + Batch Actions)
- Status: DONE
- Owner Role: Frontend/Backend
- Estimate: 2d
- Tasks:
  - Thêm panel Fleet Console trong `/dashboard-test` hoặc trang ops tương đương
  - UI tạo group, xem member preview, chạy dry-run/apply batch config
  - Hiển thị execution progress (queued/sent/acked/timeout)
  - Bảo toàn style technical ops, ưu tiên tính rõ ràng hơn màu mè
- DoD:
  - Operator thao tác group + batch config ngay trên UI
  - Có màn hình confirm/dry-run tránh thao tác nhầm diện rộng
  - UI phản ánh đúng status execution từ backend

## Story S8-05: Quality Gate + 700 Devices Fleet Demo
- Status: DONE
- Owner Role: Backend/QA/Ops
- Estimate: 1.5d
- Tasks:
  - Chạy demo `700` devices với ít nhất `3` cohort khác nhau
  - Verify flow: `group -> dry-run -> apply config -> ack/timeout summary -> audit`
  - Đo metric batch success rate, duration, timeout ratio
  - Chốt deferred items cho Sprint 9
- DoD:
  - Fleet grouping + batch config chạy ổn định ở tải cao hơn Sprint 7
  - Có báo cáo rõ tỷ lệ thành công/thất bại/timed-out của batch run
  - Sprint 8 đủ nền để bước sang rollout framework ở Sprint 9

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S8-01 grouping model + cohort API
- Day 3-4: S8-02 batch config + dry-run guard
- Day 5: smoke test + audit/role hardening

### Week 2
- Day 6: S8-03 policy engine v1
- Day 7-8: S8-04 fleet console UI v1
- Day 9-10: S8-05 quality gate `700` devices + backlog Sprint 9

## 3) Risks in Sprint 8
- Batch apply sai phạm vi gây tác động diện rộng
  - Mitigation: bắt buộc dry-run + confirm + note + guard theo role
- Dynamic cohort query nặng khi fleet lớn
  - Mitigation: giới hạn filter v1, thêm index và cache preview ngắn hạn
- UI fleet console dễ rối khi nhồi quá nhiều hành động
  - Mitigation: ưu tiên 1 luồng chính `preview -> dry-run -> apply -> verify`
- Policy rule conflict khó giải thích
  - Mitigation: định nghĩa precedence rõ ràng và expose reason trong API response

## 4) Sprint 8 Exit Criteria
- Có grouping/cohort model + API đủ dùng cho vận hành thật
- Batch config theo nhóm hoạt động với dry-run guard an toàn
- Policy engine v1 hỗ trợ baseline site/zone
- Fleet Console UI v1 thao tác được group + batch action
- Demo ổn định `700` devices, sẵn sàng mở rộng rollout framework ở Sprint 9

## 5) Verification Notes (Template)
- `cd server && npm run build`
- `cd server && npm run test` (nếu có)
- Verify API grouping/cohort + batch dry-run/apply
- Verify RBAC/audit cho action fleet-level
- Verify UI Fleet Console thao tác end-to-end
- Verify load demo `700` devices + metrics summary

## 6) Execution Log (25/03/2026)
- Build:
  - `cd server && pnpm build` -> pass
  - `cd web && pnpm build` -> pass
- Policy engine v1:
  - Có API policy: CRUD + attach/detach vào cohort
  - Có conflict validation site/zone khi attach policy vào cohort
  - Có audit log before/after cho policy create/update/delete/attach/detach
- Quality gate `700` devices:
  - Registered metadata: `700` devices (`site-a/z1`: 250, `site-b/z2`: 250, `site-c/z3`: 200)
  - Connected checkpoint: `700/700` devices online
  - Cohort dry-run totals: `250 + 250 + 200 = 700`
  - Apply totals: accepted `700`, failed `0`, success rate `100%`
  - Audit check: có record `fleet_batch_apply` và `fleet_policy_*`
