# SPRINT-7 PLAN (2 Weeks)

Timeline đề xuất: 16/06/2026 - 29/06/2026
Sprint Goal: Khép `Phase 3: Ops Excellence` bằng cách giảm nhiễu alert, bổ sung incident history/reporting và harden quy trình NOC để team vận hành có thể theo dõi, lọc, truy vết và tổng hợp sự cố rõ ràng hơn.

## Scope Notes
- Sprint 7 là nửa sau của `Phase 3: Ops Excellence` trong `ROADMAP.md`.
- Sprint 6 đã hoàn tất alert workflow, incident core và runbook UI cơ bản, nên Sprint 7 không mở rộng bừa theo chiều ngang mà sẽ đào sâu phần vận hành thật.
- Trọng tâm là giảm false-alert, tăng khả năng truy vấn/lọc/report, và làm UI ops đủ chặt để dùng hàng ngày.

## Progress Checklist (Khởi tạo ngày 24/03/2026)
- [x] S7-01 Incident History + Reporting Foundation
- [x] S7-02 False-Alert Reduction + Alert Noise Controls
- [x] S7-03 NOC Workflow Hardening + RBAC/Audit Tightening
- [x] S7-04 Ops Console v2 for History/Filters/Timeline
- [x] S7-05 Quality Gate + Shift Handover Demo

## 1) Sprint Backlog

## Story S7-01: Incident History + Reporting Foundation
- Status: DONE
- Owner Role: Backend/Data
- Estimate: 2.5d
- Tasks:
  - Bổ sung query incident history theo `status`, `severity`, `site`, `owner`, `from`, `to`
  - Thêm summary API cơ bản cho số incident theo trạng thái/mức độ/thời gian
  - Chuẩn hóa timeline payload để dễ render/export hơn
  - Chuẩn bị nền `report/export` tối thiểu cho vận hành
- DoD:
  - Team ops query được incident history mà không cần soi DB thủ công
  - Có summary đủ để dùng trong daily review hoặc shift handover
  - Timeline incident có shape ổn định cho UI và export

## Story S7-02: False-Alert Reduction + Alert Noise Controls
- Status: DONE
- Owner Role: Backend/Ops
- Estimate: 3d
- Tasks:
  - Thêm guard chống alert flapping/churn tối thiểu
  - Hỗ trợ cooldown/suppression/dedup ở mức rule hoặc device
  - Đánh dấu alert noisy hoặc suppressed trong model/API
  - Đo các chỉ số nhiễu alert để so sánh trước/sau
- DoD:
  - Cùng một điều kiện bất ổn không spam incident/operator liên tục
  - Alert noisy có thể bị suppress hoặc coalesce theo rule rõ ràng
  - Có metric/summary để chứng minh giảm false-alert

## Story S7-03: NOC Workflow Hardening + RBAC/Audit Tightening
- Status: DONE
- Owner Role: Backend/Security
- Estimate: 1.5d
- Tasks:
  - Rà soát quyền theo action vận hành quan trọng: ack, resolve, assign, close, export
  - Bổ sung audit context tốt hơn cho incident ownership/status change
  - Thêm guard tránh close/resolve thiếu note khi cần
  - Chuẩn hóa failure reason cho workflow API
- DoD:
  - Workflow vận hành có rule nhất quán hơn và ít thao tác mơ hồ
  - Audit đủ để forensic ai đổi gì, khi nào, tại sao
  - Không có regression ở flow viewer/operator/admin

## Story S7-04: Ops Console v2 for History/Filters/Timeline
- Status: DONE
- Owner Role: Backend/Frontend
- Estimate: 2d
- Tasks:
  - Mở rộng UI ops với filter incident/alert theo `severity`, `status`, `site`, `owner`, thời gian
  - Hiển thị incident history rõ hơn thay vì chỉ list ngắn
  - Thêm timeline panel/inspector đọc được trong ca trực
  - Thêm summary cards cho handover/report nhanh
- DoD:
  - Operator lọc và tìm incident cũ được từ UI
  - Timeline đủ rõ để đọc nhanh diễn tiến xử lý
  - UI vẫn giữ technical ops style, không drift thành dashboard marketing/product

## Story S7-05: Quality Gate + Shift Handover Demo
- Status: DONE
- Owner Role: Backend/QA/Ops
- Estimate: 1d
- Tasks:
  - Chạy demo `noisy alert -> suppression/coalesce -> incident handling -> history review -> handover summary`
  - Verify UI/API/audit/timeline/report summary nhất quán
  - Ghi lại failure notes còn lại cho Sprint 8
  - Chốt exit note cho `Phase 3`
- DoD:
  - Có thể chứng minh hệ thống không chỉ tạo workflow mà còn vận hành được qua nhiều ca trực
  - Incident history/report và audit khớp nhau trên case demo
  - Sprint 7 đủ để khép `Phase 3`

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S7-01 incident history + reporting foundation
- Day 3-5: S7-02 false-alert reduction + alert noise controls

### Week 2
- Day 6: S7-03 workflow hardening + RBAC/audit tightening
- Day 7-8: S7-04 ops console v2
- Day 9-10: S7-05 shift handover demo + Phase 3 closeout

## 3) Risks in Sprint 7
- Noise reduction làm miss alert thật
  - Mitigation: ưu tiên dedupe/cooldown/coalesce có thể giải thích được, tránh suppression mù
- Reporting/history query làm nặng read path
  - Mitigation: thêm summary/read model tối thiểu, không query trực tiếp kiểu scan thô cho mọi view
- UI ops dễ phình thêm nhiều dashboard phụ
  - Mitigation: chỉ làm view phục vụ incident history, filters, timeline và handover summary
- RBAC tightening có thể phá flow hiện tại
  - Mitigation: verify lại viewer/operator/admin bằng smoke flow sau mỗi thay đổi

## 4) Sprint 7 Exit Criteria
- Có incident history/reporting foundation đủ dùng cho vận hành
- Alert noise được giảm rõ ràng bằng dedupe/cooldown/coalesce tối thiểu
- Quy trình NOC được harden hơn về role, note, audit và failure semantics
- Ops console hỗ trợ filter/history/timeline đủ để dùng trong handover
- Có demo shift handover hoàn chỉnh, đủ điều kiện khép `Phase 3`

## 5) Verification Notes
- `cd server && npm run build` pass
- Incident history/reporting foundation:
  - `GET /api/incidents` hỗ trợ filter `status`, `severity`, `owner`, `site`, `from`, `to`, `limit`
  - `GET /api/incidents/summary` trả aggregate theo status/severity/site/owner cho review/handover
  - `GET /api/incidents/:incidentId/timeline?limit=...` trả envelope ổn định:
    - `incident`
    - `entries`
    - `returnedEntries`
    - `firstEntryAt`
    - `lastEntryAt`
- Ops console v2 đã bắt đầu:
- Ops console v2:
  - `/dashboard-test` có filter incident theo `status`, `severity`, `owner`, `site`, `from`, `to`
  - thêm panel `Alert Noise Summary`
  - thêm panel `Incident Summary`
  - thêm panel `Incident Timeline`
  - thêm panel `Shift Handover`:
    - export incidents theo filter hiện tại (`json` / `ndjson`)
    - bundle snapshot gồm `incident summary` + `alert summary`
    - hiển thị lỗi workflow theo `status + error + reason + action`
  - role `operator` thấy message tĩnh cho audit thay vì poll `403`
- False-alert reduction + noise controls:
  - `AlertRule` hỗ trợ thêm:
    - `suppressionWindowMs`
    - `flappingWindowMs`
    - `flappingThreshold`
  - `AlertRecord` expose thêm:
    - `occurrenceCount`
    - `suppressedCount`
    - `noiseState`
    - `lastSuppressedAt`
  - `GET /api/alerts/summary` trả aggregate:
    - `byNoiseState`
    - `coalescedSignals`
    - `suppressedSignals`
    - `flappingSignals`
    - `topNoisyRules`
    - `topNoisyDevices`
- Smoke verify:
  - `/api/incidents/summary` trả aggregate đúng trên dữ liệu Sprint 6 hiện có
  - filter thời gian trên `/api/incidents` trả tập incident phù hợp
  - timeline incident demo `incident-1774344576396-r8zp67` trả đủ envelope + entries
  - `/api/alerts/summary` trả aggregate alert-noise hợp lệ
  - smoke device `esp-s7-noise-001` xác nhận `temperature-warning`:
    - re-trigger gần nhau không tạo thêm alert record spam
    - record cũ tăng `suppressedCount=2`
    - `noiseState=flapping`
  - browser snapshot xác nhận UI mới render các control:
    - `Alert Noise Summary`
    - `all severities`
    - `Filter by owner`
    - `Filter by site`
    - `Incident Summary`
    - `Incident Timeline`
    - `Shift Handover`
- NOC workflow hardening + RBAC/audit tightening:
  - workflow API trả reason chuẩn hóa:
    - `workflow_validation_failed`
    - `workflow_resource_not_found`
    - `workflow_transition_blocked`
  - guard transition:
    - không `close` incident khi chưa `resolved`
    - không `assign` incident đã `resolved/closed`
    - không `add note` incident đã `closed`
    - không `resolve` incident đã `resolved/closed`
    - `alert resolve` bắt buộc có `note`
  - audit context bổ sung:
    - `beforeSummary`
    - `afterSummary`
    - `workflow.transition`
  - export RBAC:
    - thêm `GET /api/incidents/export`
    - chỉ `admin` được export
    - audit ghi `incident_export`
  - smoke verify S7-03:
    - `incident close` trước `resolve` trả `409` + `reason=incident_must_be_resolved_before_close`
    - `incident resolve` thiếu note trả `422` + `reason=note_required`
    - `incident assign` sau `resolved` trả `409` + `reason=incident_resolved`
    - `incident note` sau `closed` trả `409` + `reason=incident_closed`
    - `incident export`:
      - operator: `403 forbidden`
      - admin: export được `json` và `ndjson`
    - `alert resolve` thiếu note trả `422` + `reason=note_required`
- Shift handover demo S7-05:
  - demo runbook `esp-s7-shift-002`:
    - `alert -> ack -> incident create -> assign -> note -> resolve -> close` đều pass (`200/201`)
    - noisy signal vẫn tạo suppression (`noiseState=suppressed`, `suppressedCount=1`)
    - incident timeline trả chuỗi event đầy đủ:
      - `created`
      - `linked_alert`
      - `assigned`
      - `note`
      - `assigned`
      - `note`
      - `monitoring`
      - `note`
      - `resolved`
      - `closed`
  - handover summary/export:
    - `GET /api/incidents/summary?site=sgp-shift-b` pass
    - `GET /api/alerts/summary` pass
    - `GET /api/incidents/export?format=json&site=sgp-shift-b&limit=20` pass (`admin`)
    - `GET /api/incidents/export?format=ndjson&site=sgp-shift-b&limit=5` pass (`admin`)

Sprint 7 có thể đóng sau khi team review nhanh UI `/dashboard-test` với role `admin/operator`.
