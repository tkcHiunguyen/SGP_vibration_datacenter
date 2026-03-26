# SPRINT-6 PLAN (2 Weeks)

Timeline đề xuất: 02/06/2026 - 15/06/2026
Sprint Goal: Bắt đầu `Phase 3: Ops Excellence` bằng cách nâng cấp `Alerting v2` và dựng lõi `Incident workflow` đủ để team vận hành có thể ack, assign và theo dõi xử lý sự cố mà không phải bám log thô.

## Scope Notes
- Sprint 6 là nửa đầu của `Phase 3: Ops Excellence` trong `ROADMAP.md`.
- Sprint 5 đã khép `Phase 2` với quality gate `500` devices, nên trọng tâm bây giờ chuyển từ data/reliability sang workflow vận hành.
- Sprint này vẫn ưu tiên backend + ops workflow; `report/export` sẽ chỉ làm phần nền cần thiết, chưa làm reporting đầy đủ.

## Progress Checklist (Khởi tạo ngày 24/03/2026)
- [x] S6-01 Alerting v2 Foundation
- [x] S6-02 Incident Core Workflow
- [x] S6-03 Ops Action API + RBAC Expansion
- [x] S6-04 Technical Ops UI for Alert/Incident Handling
- [x] S6-05 Quality Gate + NOC Runbook Demo

## 1) Sprint Backlog

## Story S6-01: Alerting v2 Foundation
- Status: DONE
- Owner Role: Backend/Ops
- Estimate: 2.5d
- Tasks:
  - Nâng model alert/rule để hỗ trợ `severity` rõ hơn theo ngữ cảnh vận hành
  - Thêm rule theo khung giờ/ca trực ở mức tối thiểu
  - Bổ sung `acknowledgedAt`, `acknowledgedBy`, `resolvedAt`, `resolvedBy`, `resolutionNote`
  - Chuẩn hóa state machine `active -> acknowledged -> resolved`
- DoD:
  - Alert có lifecycle rõ ràng, truy vết được ai ack/resolve
  - Rule có thể áp điều kiện time-window cơ bản cho ca trực
  - Không phá flow alert realtime/API hiện tại

## Story S6-02: Incident Core Workflow
- Status: DONE
- Owner Role: Backend
- Estimate: 3d
- Tasks:
  - Tạo entity incident từ alert hoặc nhóm alert liên quan
  - Hỗ trợ `open`, `assigned`, `monitoring`, `resolved`, `closed`
  - Gán owner cho incident
  - Lưu timeline xử lý cơ bản: create, ack, assign, note, resolve, close
- DoD:
  - Operator có thể tạo incident từ alert đang active
  - Incident có owner, status và timeline đủ để trace xử lý
  - Timeline query được qua API mà không phải đọc audit log thô

## Story S6-03: Ops Action API + RBAC Expansion
- Status: DONE
- Owner Role: Backend/Security
- Estimate: 1.5d
- Tasks:
  - Thêm API cho ack/resolve alert
  - Thêm API cho create/assign/update incident
  - Mở rộng RBAC cho action vận hành: `ack_alert`, `resolve_alert`, `manage_incident`
  - Audit đầy đủ các thao tác workflow mới
- DoD:
  - Endpoint mới được bảo vệ đúng theo role
  - Mọi thao tác ack/resolve/assign đều có audit record
  - Auth/RBAC hiện tại không bị regression

## Story S6-04: Technical Ops UI for Alert/Incident Handling
- Status: DONE
- Owner Role: Backend/Frontend
- Estimate: 2d
- Tasks:
  - Mở rộng `/dashboard-test` hoặc trang ops tương đương để thao tác ack/resolve alert
  - Hiển thị incident list, owner, status, timeline ngắn
  - Thêm filter theo severity, status, site, owner
  - Giữ UI theo hướng technical ops, không biến thành product dashboard
- DoD:
  - Operator có thể xử lý alert/incident từ UI thay vì chỉ qua API
  - UI phản ánh đúng state machine alert/incident mới
  - Flow đủ rõ để dùng trong demo runbook

## Story S6-05: Quality Gate + NOC Runbook Demo
- Status: DONE
- Owner Role: Backend/QA/Ops
- Estimate: 1d
- Tasks:
  - Chạy demo workflow: alert phát sinh -> ack -> create incident -> assign owner -> resolve -> close
  - Verify audit/timeline/API/UI đồng nhất dữ liệu
  - Capture thời gian xử lý và các failure notes còn lại
  - Chốt deferred items cho Sprint 7
- DoD:
  - Team vận hành có thể đi hết workflow xử lý sự cố cơ bản mà không cần dev can thiệp trực tiếp
  - Ack/resolve/incident timeline nhất quán giữa API, DB, audit và UI
  - Có demo note đủ để kết luận Sprint 6 hoàn tất

## 2) Daily Plan Suggestion

### Week 1
- Day 1-2: S6-01 alerting v2 foundation
- Day 3-4: S6-02 incident core workflow
- Day 5: API + RBAC draft cho ops action

### Week 2
- Day 6: hoàn tất S6-03 và audit coverage
- Day 7-8: S6-04 technical ops UI
- Day 9-10: S6-05 runbook demo + backlog cho Sprint 7

## 3) Risks in Sprint 6
- Alert lifecycle mới có thể làm rối state machine hiện tại
  - Mitigation: giữ transition hữu hạn, cấm state jump không hợp lệ, verify bằng smoke flow
- Incident workflow dễ chồng chéo với audit log hiện có
  - Mitigation: tách incident timeline thành read model riêng, audit vẫn giữ vai trò forensic
- UI ops có thể phình scope
  - Mitigation: chỉ làm UI đủ để thao tác và quan sát workflow, chưa làm dashboard product-facing
- Rule theo khung giờ/ca trực có thể kéo theo scheduler phức tạp quá sớm
  - Mitigation: chỉ làm time-window evaluation tối thiểu trong Sprint 6

## 4) Sprint 6 Exit Criteria
- Alert có workflow `ack/resolve` rõ ràng và có audit đầy đủ
- Có incident core với owner, status, timeline
- Operator xử lý được alert/incident qua API và UI kỹ thuật
- Demo runbook vận hành hoàn chỉnh cho ít nhất `1` luồng sự cố
- Đủ nền để Sprint 7 tập trung vào reporting, false-alert reduction và hardening quy trình NOC

## 5) Verification Notes
- `cd server && npm run build` pass
- Alerting v2:
  - `AlertStatus` mở rộng thành `active | acknowledged | resolved`
  - thêm `acknowledgedAt`, `acknowledgedBy`, `acknowledgedNote`, `resolvedBy`, `resolutionNote`
  - hỗ trợ `timeWindow` tối thiểu trên alert rule
  - `POST /api/alerts/:alertId/ack` hoạt động và trả alert ở trạng thái `acknowledged`
  - `POST /api/alerts/:alertId/resolve` hoạt động và broadcast lại alert đã resolve
- Incident core:
  - thêm incident persistence + timeline persistence
  - `POST /api/incidents`, `GET /api/incidents`, `GET /api/incidents/:incidentId`, `GET /api/incidents/:incidentId/timeline` hoạt động
  - `PUT /api/incidents/:incidentId/assign`, `POST /api/incidents/:incidentId/notes`, `POST /api/incidents/:incidentId/resolve`, `POST /api/incidents/:incidentId/close` hoạt động
  - smoke API flow pass:
    - `alert -> ack -> incident create -> assign -> note -> resolve -> close`
    - timeline trả đúng chuỗi event `created`, `linked_alert`, `assigned`, `note`, `monitoring`, `resolved`, `closed`
- Ops action + audit:
  - audit log ghi nhận `alert_acknowledge`, `alert_resolve`, `incident_create`, `incident_assign`, `incident_note`, `incident_resolve`, `incident_close`
  - role guard dùng `viewer/operator` path hiện có để bảo vệ workflow mới
- Technical ops UI:
  - `/dashboard-test` render panel `Alert Workflow` và `Incident Workspace`
  - `GET /socket-info` đã quảng bá thêm `alert:ack`, `alert:resolve`, `incident:create`, `incident:update`
  - layout panel incident đã fix (`span-7`) và copy cũ `501/not implemented` đã được dọn
  - sau `Create Incident`, form tự hydrate `incidentId` từ response để chạy tiếp `assign/note/resolve/close` trong cùng màn hình
  - panel audit ở role `operator` không còn poll `403` liên tục; thay bằng message `Audit logs require admin role.`
- UI + runbook demo:
  - verify trực tiếp trên `/dashboard-test` với role `operator`
  - flow UI pass:
    - `alert -> ack -> create incident -> assign owner -> add note -> resolve -> close`
  - incident demo:
    - `incident-1774344576396-r8zp67`
    - title `S6 UI Flow 0929`
    - owner chuyển từ `noc-ui` sang `noc-ui-2`
    - state cuối `closed`
  - timeline API của incident demo trả đủ chuỗi event:
    - `created`, `linked_alert`, `assigned`, `note`, `assigned`, `note`, `monitoring`, `note`, `resolved`, `closed`
  - quality gate Sprint 6 đạt:
    - operator đi hết workflow xử lý sự cố cơ bản từ UI
    - UI/API/timeline nhất quán trên demo runbook
