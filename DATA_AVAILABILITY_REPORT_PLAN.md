# Simple Data Availability Report

## Trạng thái

Đề xuất. Đây chỉ là tài liệu handoff để triển khai sau, không phải yêu cầu
thực hiện ngay.

## Mục tiêu

Hệ thống hiện chưa đưa vào vận hành chính thức, nên chưa có đủ dữ liệu nền
để đánh giá bất thường rung động hoặc nhiệt độ. Vì vậy, tính năng báo cáo đầu
tiên chỉ nên tập trung vào **mức độ sẵn có của dữ liệu**, không chẩn đoán tình
trạng sức khỏe thiết bị.

Tính năng này trả lời các câu hỏi vận hành:

- Thiết bị nào có telemetry trong khoảng thời gian đã chọn?
- Thiết bị nào không có telemetry?
- Thiết bị nào có spectrum frame?
- Thiết bị nào thiếu spectrum trục X, Y hoặc Z?
- Telemetry cuối cùng của từng thiết bị là lúc nào?
- Trạng thái online/offline hiện tại của từng thiết bị là gì?

Không dùng các từ như bất thường, lỗi thiết bị, rủi ro hỏng, tốt/xấu về mặt
kỹ thuật trong phiên bản đầu.

## Người dùng chính

- Quản lý datacenter cần báo cáo tổng quan theo tuần.
- Kỹ sư bảo trì cần dữ liệu chi tiết theo từng thiết bị để kiểm tra sau.

## Bối cảnh hiện tại

Codebase đã có các nền tảng cần thiết:

- Quản lý thiết bị và trạng thái kết nối runtime trong `server/src/modules/device`.
- Lịch sử telemetry trong `server/src/modules/telemetry`.
- Lưu spectrum frame trong `server/src/modules/spectrum`.
- Nhận telemetry/spectrum realtime qua Socket.IO.
- Dashboard thiết bị, chart, zone, OTA và fleet.

Phần fleet/device/OTA/zone/command đã có core MVP. Tài liệu này không mở rộng
các phần đó, trừ khi cần đọc dữ liệu để đưa vào báo cáo.

## Phạm vi

### Phase 1: API và dashboard preview

Tạo API đọc mức độ sẵn có dữ liệu và một màn hình preview trên dashboard.

Preview cần có:

- Chọn khoảng thời gian.
- Mặc định chọn 7 ngày gần nhất.
- Bảng danh sách thiết bị.
- Các chỉ số tổng quan.
- Filter theo zone và trạng thái dữ liệu.

Cột bảng đề xuất:

| Cột | Ý nghĩa |
| --- | --- |
| Thiết bị | Device ID hoặc tên thiết bị. |
| Zone | Zone hiện tại nếu có. |
| Online | Trạng thái online/offline hiện tại. |
| Số telemetry | Số bản ghi telemetry trong khoảng thời gian đã chọn. |
| Telemetry cuối | Thời điểm telemetry mới nhất trong khoảng thời gian đã chọn. |
| Số spectrum frame | Số spectrum frame đã lưu trong khoảng thời gian đã chọn. |
| Thiếu spectrum | Trục X/Y/Z bị thiếu. |
| Trạng thái dữ liệu | `Có dữ liệu`, `Không có telemetry`, `Có telemetry, chưa có spectrum`, hoặc `Thiếu spectrum`. |

### Phase 2: Report job nền và Excel

Thêm job tạo báo cáo và xuất Excel.

Cấu trúc Excel:

- Sheet `Overview`
  - Khoảng thời gian báo cáo.
  - Tổng số thiết bị.
  - Số thiết bị có telemetry.
  - Số thiết bị không có telemetry.
  - Số thiết bị có spectrum.
  - Số thiết bị thiếu spectrum.
  - Bảng tổng hợp danh sách thiết bị.
- Mỗi thiết bị một sheet riêng
  - Metadata thiết bị.
  - Trạng thái online/offline hiện tại.
  - Số telemetry.
  - Thời điểm telemetry cuối.
  - Số spectrum frame.
  - Trục spectrum bị thiếu.
  - Ghi chú ngắn giải thích trạng thái dữ liệu.

Không export toàn bộ raw telemetry trong Excel phiên bản đầu.

### Phase 3: PDF tổng quan

Thêm PDF cho quản lý sau khi preview và Excel đã ổn định.

PDF nên ngắn, khoảng 1-3 trang:

- Tiêu đề và khoảng thời gian báo cáo.
- Chỉ số tổng quan.
- Danh sách thiết bị không có telemetry.
- Danh sách thiết bị có telemetry nhưng chưa có spectrum.
- Danh sách thiết bị thiếu spectrum X/Y/Z.
- Có thể nhóm theo zone nếu dữ liệu zone đủ sạch.

## Ngoài phạm vi

Không làm trong phiên bản đầu:

- Phát hiện bất thường rung/nhiệt.
- Cấu hình ngưỡng thủ công.
- Tính coverage theo tần suất telemetry kỳ vọng.
- Data quality score hoặc attention score.
- Phân loại OK/warning/critical.
- Tạo báo cáo tự động hằng tuần.
- Phân quyền chi tiết theo vai trò.
- AI/LLM analysis.
- Export raw telemetry đầy đủ.

Các phần này chỉ nên quay lại sau khi hệ thống có dữ liệu vận hành thật.

## Thiết kế backend đề xuất

### Module

Tạo module mới:

```text
server/src/modules/reporting/
  reporting.types.ts
  reporting.repository.ts
  reporting.service.ts
  reporting-job.service.ts
  data-availability.service.ts
  excel-report.service.ts
  pdf-report.service.ts
```

Phase 1 chỉ cần:

```text
reporting.types.ts
reporting.service.ts
data-availability.service.ts
```

### API

Phase 1:

```text
GET /api/reports/data-availability
```

Query parameters:

```text
rangeStart=2026-04-17T00:00:00.000Z
rangeEnd=2026-04-24T00:00:00.000Z
zone=optional-zone-code
```

Response đề xuất:

```json
{
  "ok": true,
  "data": {
    "rangeStart": "2026-04-17T00:00:00.000Z",
    "rangeEnd": "2026-04-24T00:00:00.000Z",
    "summary": {
      "totalDevices": 120,
      "devicesWithTelemetry": 112,
      "devicesWithoutTelemetry": 8,
      "devicesWithSpectrum": 101,
      "devicesMissingSpectrum": 19
    },
    "devices": [
      {
        "deviceId": "ESP-001",
        "name": "Rack A1 sensor",
        "zone": "Rack-A1",
        "online": true,
        "telemetryRecords": 1250,
        "latestTelemetryAt": "2026-04-23T23:59:30.000Z",
        "spectrumFrames": 1200,
        "presentSpectrumAxes": ["x", "y", "z"],
        "missingSpectrumAxes": [],
        "dataState": "has_data"
      }
    ]
  }
}
```

Enum trạng thái dữ liệu:

```ts
type DataAvailabilityState =
  | 'has_data'
  | 'no_telemetry'
  | 'telemetry_without_spectrum'
  | 'missing_spectrum_axes';
```

Phase 2:

```text
POST /api/reports
GET  /api/reports
GET  /api/reports/:reportId
GET  /api/reports/:reportId/download/excel
```

Phase 3:

```text
GET /api/reports/:reportId/download/pdf
```

## Data model đề xuất

Phase 1 chưa cần bảng mới. Có thể tính trực tiếp từ các bảng MySQL hiện có.

Phase 2 thêm bảng `report_jobs`:

```text
report_jobs
- report_id
- type                 data_availability
- status               pending | running | completed | failed
- range_start
- range_end
- requested_at
- started_at
- completed_at
- failed_reason
- excel_path
- pdf_path
- created_at
- updated_at
```

File báo cáo lưu ở:

```text
storage/reports/
```

## Ghi chú tính toán dữ liệu

Phiên bản đầu chỉ dùng số liệu đơn giản.

Cho từng thiết bị:

- `telemetryRecords`: đếm dòng trong `device_datas` theo khoảng thời gian.
- `latestTelemetryAt`: lấy `max(received_at)` trong `device_datas`.
- `spectrumFrames`: đếm dòng trong `device_spectrum_frames`.
- `presentSpectrumAxes`: các trục đã có trong payload spectrum đã lưu.
- `missingSpectrumAxes`: các trục `x`, `y`, `z` chưa có.
- `online`: trạng thái runtime hiện tại từ device service/session state.

Không tính expected count hoặc coverage trong phiên bản đầu.

## Dashboard UX

Thêm trang mới, ví dụ:

- `Báo cáo vận hành`
- hoặc `Data Availability`

Layout đề xuất:

- Thanh điều khiển:
  - Date range.
  - Zone filter.
  - Nút refresh.
  - Phase 2: nút tạo Excel.
  - Phase 3: nút tạo PDF.
- Hàng tổng quan:
  - Tổng thiết bị.
  - Thiết bị có telemetry.
  - Thiết bị không có telemetry.
  - Thiết bị có spectrum.
  - Thiết bị thiếu spectrum.
- Bảng chính:
  - Thiết bị.
  - Zone.
  - Online.
  - Số telemetry.
  - Telemetry cuối.
  - Số spectrum frame.
  - Thiếu spectrum.
  - Trạng thái dữ liệu.

Nhãn tiếng Việt nên dùng:

- `Có dữ liệu`
- `Không có telemetry`
- `Có telemetry, chưa có spectrum`
- `Thiếu spectrum X/Y/Z`

## Job behavior cho Phase 2

Vì hệ thống hiện chưa có phân quyền chi tiết, mọi người truy cập dashboard đều
có thể tạo và tải báo cáo.

Vẫn cần guardrail tối thiểu:

- Không tạo thêm job trùng nếu cùng range đang chạy.
- Nếu job cùng range đang chạy, trả về job hiện có.
- Giới hạn số report job chạy đồng thời.
- Lưu `failed_reason` nếu tạo report thất bại.

Đây không phải permission model đầy đủ, chỉ là bảo vệ khỏi thao tác bấm lặp.

## Kế hoạch triển khai

### Phase 1 checklist

- Thêm reporting types.
- Thêm data availability service.
- Thêm API route `GET /api/reports/data-availability`.
- Thêm query tổng hợp telemetry/spectrum.
- Thêm trang dashboard.
- Thêm summary cards và bảng thiết bị.
- Thêm loading, empty và error state.
- Thêm test cho logic map trạng thái dữ liệu.
- Chạy `pnpm -C server test`, `pnpm typecheck`, `pnpm -C server/client build`.

### Phase 2 checklist

- Thêm migration cho `report_jobs`.
- Thêm report repository.
- Thêm background job service.
- Thêm Excel generation service.
- Thêm API danh sách job.
- Thêm endpoint tải Excel.
- Thêm danh sách job trên dashboard.
- Thêm nút tạo/tải Excel.
- Thêm test cho vòng đời job.

### Phase 3 checklist

- Thêm PDF generation service.
- Thêm endpoint tải PDF.
- Thêm layout PDF tổng quan.
- Thêm nút tải PDF trên dashboard.
- Thêm test cho metadata báo cáo đã tạo.

## Chiến lược kiểm thử

Backend:

- Unit test các trạng thái dữ liệu:
  - Không có telemetry.
  - Có telemetry nhưng không có spectrum.
  - Thiếu riêng X/Y/Z.
  - Có đủ X/Y/Z.
- Test validate date range.
- Test kết quả rỗng.
- Test thiết bị không có zone.
- Phase 2: test duplicate job và failed job state.

Frontend:

- Test empty state.
- Test loading state.
- Test render bảng với đủ trạng thái dữ liệu.
- Test date range request parameters.

Kiểm tra thủ công:

- Chạy server với MySQL.
- Dùng một tập thiết bị nhỏ.
- Đối chiếu số liệu preview với số dòng trong DB.
- Phase 2: kiểm tra số sheet Excel khớp số thiết bị.

## Rủi ro và việc cần theo dõi

- Online/offline hiện tại không phải uptime lịch sử. UI cần ghi rõ là trạng thái hiện tại.
- Spectrum completeness phụ thuộc format payload đã lưu. Cần kiểm tra lại trước khi code.
- Excel mỗi thiết bị một sheet có thể nặng khi lên 300 thiết bị. Mỗi sheet cần giữ gọn.
- Chỉ thêm lịch tự động hằng tuần sau khi tạo report thủ công ổn định.
- Chỉ thêm anomaly/threshold report sau khi có đủ dữ liệu vận hành thật.

## Decision log

| Quyết định | Lý do |
| --- | --- |
| Tập trung data availability, không làm anomaly detection. | Chưa có dữ liệu nền vận hành thật. |
| Bỏ threshold, coverage score và attention score khỏi phiên bản đầu. | Chủ dự án muốn phiên bản đơn giản trước. |
| Làm dashboard preview trước export file. | Giúp kiểm chứng logic và có giá trị dùng ngay. |
| Làm Excel trước PDF. | Kỹ sư cần dữ liệu chi tiết để kiểm tra trước. |
| PDF giữ ngắn cho quản lý. | Quản lý cần tóm tắt nhanh, không cần raw data. |
| File report tạo bằng backend job. | Report tuần cho 100-300 thiết bị không nên block request trình duyệt. |
| Tạm thời ai vào dashboard cũng tạo/tải report được. | Hệ thống chưa có phân quyền chi tiết. |

## Câu hỏi mở

- Trang `Data Availability` nên là sidebar item riêng hay nằm trong trang thiết bị hiện tại?
- Phase 1 chỉ hiển thị thiết bị active hay gồm cả thiết bị archived/deleted?
- File trong `storage/reports` nên giữ bao lâu?
- Có cần backup file report không, hay có thể tạo lại từ DB khi cần?
