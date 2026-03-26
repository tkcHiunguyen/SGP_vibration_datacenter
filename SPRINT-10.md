# SPRINT-10 PLAN (2 Weeks)

Timeline đề xuất: 28/07/2026 - 10/08/2026
Sprint Goal: Khép `Phase 4: Fleet Management` bằng quality gate `1000+` devices, hoàn thiện governance cho rollout/policy ở cấp site và chốt bộ runbook vận hành fleet-scale để sẵn sàng bước sang Phase 5.

## Scope Notes
- Sprint 10 là sprint closeout của `Phase 4`.
- Sprint 8-9 đã dựng group/cohort + rollout framework, nên Sprint 10 tập trung hardening, governance và chứng minh vận hành quy mô lớn.
- Sprint này ưu tiên stability/ops readiness hơn mở rộng feature mới.

## Progress Checklist (Khởi tạo ngày 25/03/2026)
- [x] S10-01 Fleet Governance + Approval Flow v1
- [x] S10-02 Policy/Rollout Hardening + Observability Deepening
- [x] S10-03 Fleet Console UI v3 (Governance + Audit-first)
- [x] S10-04 Phase Exit Quality Gate (1000+ Devices)
- [x] S10-05 Phase 4 Closeout + Phase 5 Entry Pack

## 1) Sprint Backlog

## Story S10-01: Fleet Governance + Approval Flow v1
- Status: DONE (25/03/2026)
- Owner Role: Backend/Security/Ops
- Estimate: 2d
- Tasks:
  - Thêm approval flow tối thiểu cho action rủi ro cao (batch diện rộng, rollout production)
  - Rule 2-step cho action nhạy cảm: requester + approver khác nhau
  - RBAC mở rộng cho vai trò `release_manager`/`approver` (hoặc tương đương)
  - Audit log mở rộng: approval decision, rationale, expiry
- DoD:
  - Action diện rộng có governance rõ, giảm rủi ro thao tác nhầm
  - Approval trail truy vết đầy đủ cho compliance nội bộ
  - Không phá flow xử lý sự cố nhanh khi cần emergency override

## Story S10-02: Policy/Rollout Hardening + Observability Deepening
- Status: DONE (25/03/2026)
- Owner Role: Backend/SRE
- Estimate: 2.5d
- Tasks:
  - Harden rollback consistency và idempotency cho rollout retry/restart
  - Chuẩn hóa policy evaluation reason code và conflict diagnostics
  - Bổ sung metric chuyên cho fleet rollout: wave success, rollback count, auto-stop count
  - Alert rule riêng cho health rollout pipeline
- DoD:
  - Rollout/policy path có khả năng tự bảo vệ tốt hơn khi lỗi cạnh biên
  - Operator đọc được tình trạng rollout qua metrics mà không cần truy log sâu
  - Có baseline alert cho sự cố rollout pipeline

## Story S10-03: Fleet Console UI v3 (Governance + Audit-first)
- Status: DONE (25/03/2026)
- Owner Role: Frontend/Backend
- Estimate: 2d
- Tasks:
  - UI approval inbox + action review cho batch/rollout
  - Audit-first views: ai request, ai approve, khi nào, tác động tới cohort nào
  - Trang summary cho policy compliance theo site/zone
  - Tối ưu UX vận hành ca trực: highlight action pending/risky
- DoD:
  - Team vận hành và approver thao tác được ngay trên UI
  - Quyết định rollout có ngữ cảnh audit rõ ràng
  - UI hỗ trợ governance mà không làm chậm thao tác thường ngày

## Story S10-04: Phase Exit Quality Gate (1000+ Devices)
- Status: DONE (25/03/2026)
- Owner Role: Backend/QA/Ops
- Estimate: 2d
- Tasks:
  - Chạy load + rollout mixed scenario ở `1000+` devices
  - Verify đồng thời: telemetry ingest, alerting, incident workflow, batch config, rollout engine
  - Đo và chốt KPI phase: success ratio, latency, rollback safety
  - Capture bottleneck/failure notes cuối phase
- DoD:
  - Hệ thống vận hành ổn định ở mốc `1000+` devices trên staging
  - Rollout theo cohort có rollback an toàn trên case lỗi mô phỏng
  - KPI phase đạt ngưỡng chấp nhận đã thống nhất

## Story S10-05: Phase 4 Closeout + Phase 5 Entry Pack
- Status: DONE (25/03/2026)
- Owner Role: Product/Tech Lead/Ops
- Estimate: 1.5d
- Tasks:
  - Tổng hợp báo cáo closeout `Phase 4` (đạt/chưa đạt, nợ kỹ thuật, risk còn mở)
  - Chuẩn hóa runbook fleet-scale cho NOC/SRE
  - Đề xuất backlog `Phase 5` theo ưu tiên: predictive maintenance, multi-tenant boundary, SLA dashboard
  - Chốt scope cắt lớp cho Sprint 11+
- DoD:
  - Có tài liệu bàn giao rõ để vận hành và mở rộng tiếp
  - Phase 5 có entry plan thực tế, tránh mở rộng dàn trải
  - Team nhìn thấy “điểm kết phase” rõ ràng, không mơ hồ roadmap

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S10-01 governance + approval flow
- Day 3-4: S10-02 hardening policy/rollout + metrics
- Day 5: smoke verify + incident integration check

### Week 2
- Day 6-7: S10-03 fleet console UI v3
- Day 8-9: S10-04 quality gate `1000+` devices
- Day 10: S10-05 phase closeout + phase 5 entry pack

## 3) Risks in Sprint 10
- Thêm approval flow có thể làm chậm vận hành
  - Mitigation: cho phép emergency override có audit bắt buộc
- Mixed scenario 1000+ devices bộc lộ bottleneck mới
  - Mitigation: test rehearsal sớm, theo dõi metric từng lớp (telemetry/command/rollout)
- UI governance dễ nặng và khó dùng
  - Mitigation: ưu tiên action clarity và timeline/audit thay vì thêm quá nhiều widget
- Phase closeout thiếu dữ liệu định lượng
  - Mitigation: khóa trước bộ KPI bắt buộc phải thu trong quality gate

## 4) Sprint 10 Exit Criteria
- Governance flow cho action fleet-level hoạt động và được audit đầy đủ
- Rollout/policy path được harden với metric + alert chuyên biệt
- Fleet Console UI v3 hỗ trợ governance/audit-first workflow
- Quality gate `1000+` devices pass với mixed scenario
- Hoàn tất closeout `Phase 4`, sẵn sàng bước sang `Phase 5`

## 5) Verification Notes (Template)
- `cd server && npm run build`
- Verify approval + RBAC + audit trail cho high-risk actions
- Verify policy/rollout idempotency + rollback consistency
- Verify fleet governance UI flows end-to-end
- Verify mixed load + rollout scenario ở `1000+` devices
- Publish phase closeout report + phase 5 entry backlog

## 6) Verification Run (25/03/2026)
- `cd web && pnpm build` => PASS
- `cd server && pnpm build` => PASS
- `cd server && pnpm quality:s10 -- --min-connected 1000 --poll-timeout-ms 300000` => PASS
- Mixed scenario snapshot:
  - Connected devices: `1000`
  - Batch apply: `accepted=1000`, `failed=0`
  - Rollout: `target=1000`, `status=completed`, `successRatio=0.977`
  - Rollout pipeline metrics: `rollout_wave_completed_total=4`
