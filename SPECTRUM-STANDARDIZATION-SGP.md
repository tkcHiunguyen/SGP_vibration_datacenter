# Spectrum Standardization Guide (for `SGP_vibration_datacenter`)

Ngày tạo: 2026-04-08  
Nguồn chuẩn: firmware trong project `vibration` (ESP8266)

## 1) Mục tiêu chuẩn hoá

Đảm bảo phổ hiển thị ở dashboard `SGP_vibration_datacenter` khớp với phổ firmware gửi ra, theo cùng:

- nguồn dữ liệu
- công thức scale
- trục tần số
- cách ghép frame theo `uuid + telemetryUuid`

## 2) Kết luận khác biệt hiện tại

### Project `vibration` (nguồn chuẩn)

- Web local hiện tại có thể tự FFT từ `x_raw/y_raw/z_raw` (`web/app.js`).
- Firmware cũng gửi spectrum qua Socket.IO binary events:
  - `device:telemetry:xspectrum`
  - `device:telemetry:yspectrum`
  - `device:telemetry:zspectrum`
- Spectrum binary format: `u16le`, `bin_count=512`, `source_sample_count=1024`, `value_scale=256.0`, `magnitude_unit=m/s2`.

### Project `SGP_vibration_datacenter`

- Dashboard không tự FFT từ raw cho chart spectrum; chủ yếu render từ `telemetry:spectrum`.
- Server decode + normalize spectrum trong `server/src/modules/realtime/socket.handlers.ts`.
- Có fallback dữ liệu giả (`generateFFT(...)`) trong `SensorChartModal.tsx` khi chưa có data realtime.

=> Nếu so trực tiếp chart giữa hai project mà một bên đang dùng pipeline khác/fallback khác thì phổ sẽ lệch là bình thường.

## 3) Chuẩn dữ liệu bắt buộc (Canonical Contract)

Áp dụng cho pipeline Socket spectrum:

1. Event gốc từ device:
   - `device:telemetry`
   - `device:telemetry:xspectrum|yspectrum|zspectrum` (binary attachment)

2. Khoá ghép frame:
   - `uuid + telemetryUuid`

3. Định dạng amplitude:
   - raw binary: `uint16 little-endian` (`u16le`)
   - đổi sang biên độ thực:
   - `amplitude_mps2 = raw_u16 / value_scale`
   - với firmware hiện tại: `value_scale = 256.0`

4. Trục tần số:
   - `bin_hz = sample_rate_hz / source_sample_count` (nếu payload không có `bin_hz`)
   - `freq_hz(i) = bin_hz * (i + 1)` với `i` từ `0..bin_count-1`
   - lưu ý: đây là nửa phổ dương, đã bỏ DC bin.

5. Đơn vị:
   - `magnitude_unit = "m/s2"`

## 4) Quy tắc triển khai bên SGP (Server + Web)

## 4.1 Server (`socket.handlers.ts`)

Server phải:

1. Ưu tiên đọc spectrum từ binary attachment `u16le`.
2. Chỉ dùng mảng số trong payload như fallback khi không có binary.
3. Cắt đúng `bin_count`.
4. Scale đúng 1 lần duy nhất theo `value_scale`.
5. Emit `telemetry:spectrum` với metadata đầy đủ:
   - `axis`, `telemetryUuid`, `uuid`
   - `sourceSampleCount`, `sampleRateHz`, `binHz`, `binCount`
   - `valueScale`, `magnitudeUnit`
   - `amplitudes` (đã scale)
   - `peakBinIndex`, `peakFrequencyHz`, `peakAmplitude`

## 4.2 Web (`SensorChartModal.tsx`, `App.tsx`)

Web phải:

1. Render spectrum từ `telemetry:spectrum.amplitudes` (đã chuẩn hoá).
2. Không tự FFT lại cho chart spectrum production.
3. Tắt fallback `generateFFT(...)` trong production:
   - không có data thì hiển thị empty state, không sinh phổ giả.
4. Dùng `bin_hz` từ payload để dựng trục tần số; nếu thiếu thì fallback theo `sample_rate_hz/source_sample_count`.

## 5) Checklist nghiệm thu (Definition of Done)

Pass khi tất cả điều kiện sau đúng:

1. Cùng một frame (`uuid + telemetryUuid`), 3 trục x/y/z lên đủ và đúng thứ tự logic.
2. `bin_count` đúng 512 cho firmware hiện tại.
3. `byte_length` đúng 1024 bytes (512 * uint16).
4. Peak frequency bên SGP khớp backend decode:
   - sai số khuyến nghị: <= 1 bin (`<= bin_hz`).
5. Peak amplitude không bị double-scale:
   - không bị quá lớn bất thường (quên chia `value_scale`)
   - không bị quá nhỏ bất thường (chia nhiều lần).
6. Khi mất một trục spectrum, UI báo thiếu dữ liệu thay vì dựng dữ liệu fake.

## 6) Bộ test nhanh đề xuất

1. Ghi lại 1 bundle đầy đủ (`telemetry + xspectrum + yspectrum + zspectrum`) theo cùng `telemetryUuid`.
2. Tại server, log:
   - `bin_count`, `bin_hz`, `value_scale`, peak của từng trục.
3. Tại web, hover vào peak của từng trục và đối chiếu:
   - `freq_hz`
   - `amp`
4. Nếu lệch:
   - kiểm tra decode `u16le`
   - kiểm tra scale `value_scale`
   - kiểm tra nguồn data có phải fallback giả không.

## 7) Khuyến nghị cuối

Để hai hệ thống khớp ổn định lâu dài:

1. Chọn một nguồn chuẩn duy nhất cho spectrum chart: `telemetry:spectrum` đã chuẩn hoá từ server.
2. Giữ raw-frame FFT trên web chỉ cho mục đích debug nội bộ, không dùng so sánh production.
3. Version hoá contract spectrum (ví dụ `spectrum_contract_version`) để tránh drift khi firmware đổi format.

