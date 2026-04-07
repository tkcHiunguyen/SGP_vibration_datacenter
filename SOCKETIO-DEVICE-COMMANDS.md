# SOCKET.IO Device Commands (ESP Firmware Spec)

Tài liệu này mô tả hành vi firmware hiện tại trong [src/main.cpp](/Users/ruby/Documents/PlatformIO/Projects/vibration/src/main.cpp) để team backend tích hợp.

## 1. Kết nối Socket.IO

- URL cấu hình: `http(s)://<host>:<port>`
- Path mặc định: `/socket.io/`
- Transport: `websocket` (`EIO=4`)
- Namespace: `/`

Firmware kết nối với query string:

- `EIO=4`
- `transport=websocket`
- `clientType=device`
- `deviceId=<socketDeviceId>`
- `token=<socketToken>` có thể rỗng

Ví dụ:

`ws://192.168.224.47:8080/socket.io/?EIO=4&transport=websocket&clientType=device&deviceId=ESP-462F82&token=`

## 2. Event Device -> Server

| Event | Chu kỳ | Mô tả |
|---|---|---|
| `device:heartbeat` | mỗi `30s` | trạng thái kết nối thiết bị |
| `device:telemetry` | mặc định `10s`, min `10s`, khi `telemetryEnabled=true` | telemetry gọn |
| `device:telemetry:xspectrum` | gửi ngay sau `device:telemetry` thành công, chỉ khi có frame mới chưa từng gửi phổ | phổ trục X |
| `device:telemetry:yspectrum` | gửi sau `device:telemetry:xspectrum` | phổ trục Y |
| `device:telemetry:zspectrum` | gửi sau `device:telemetry:yspectrum` | phổ trục Z |
| `device:metadata` | mặc định `60s`, min `10s`, khi `metadataEnabled=true` | metadata thiết bị |
| `device:command:ack` | gửi ngay khi nhận `device:command` hợp lệ | ACK command |

Lưu ý:

- `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum` không chạy theo timer riêng, mà bám theo lần gửi `device:telemetry`.
- Với cùng một `telemetryUuid`, firmware chỉ gửi phổ một lần. Nếu chưa có frame mới thì sẽ không phát lại phổ cũ.
- Firmware không còn dùng `device:telemetry:xraw`, `device:telemetry:yraw`, `device:telemetry:zraw` qua Socket.IO.
- Mỗi event spectrum là `Socket.IO binary event`, gồm:
  - `1` object metadata
  - `1` binary attachment `uint16[512]` little-endian

## 3. Payload chi tiết

### 3.1 `device:heartbeat`

```json
{
  "socketConnected": true,
  "staConnected": true,
  "signal": -58,
  "uptimeSec": 1234
}
```

### 3.2 `device:telemetry`

```json
{
  "deviceId": "ESP-462F82",
  "uuid": "462F82AA-BBCC-4DEE-8F11-223344556677",
  "telemetryUuid": "F7A1C490-1C7B-5F66-92B4-78D7A64B9E11",
  "available": true,
  "sample_count": 1024,
  "sample_rate_hz": 3198.44,
  "lsb_per_g": 256.0,
  "vibration": 0.62,
  "temperature": 24.13,
  "ax": 0.15,
  "ay": -0.08,
  "az": 9.71,
  "signal": -58
}
```

Ý nghĩa:

- `deviceId`: định danh dễ đọc cho con người, có thể là hostname hoặc tên thiết bị.
- `uuid`: định danh ổn định của thiết bị; backend nên dùng khóa này để xác định gói thuộc thiết bị nào.
- `telemetryUuid`: UUID của bundle telemetry/spectrum hiện tại, dùng để ghép 3 gói spectrum về đúng telemetry.
- `sample_count`: số mẫu raw nguồn của frame hiện tại; hiện tại là `1024`.
- `sample_rate_hz`: tần số lấy mẫu thực đo của frame hiện tại.
- `lsb_per_g`: hệ số quy đổi raw sang `g`; hiện tại là `256`.
- `vibration`, `ax`, `ay`, `az`: đơn vị `m/s2`.
- `temperature`: đơn vị `degC`.
- `signal`: RSSI Wi-Fi.

### 3.3 `device:telemetry:xspectrum`

```json
{
  "deviceId": "ESP-462F82",
  "uuid": "462F82AA-BBCC-4DEE-8F11-223344556677",
  "telemetryUuid": "F7A1C490-1C7B-5F66-92B4-78D7A64B9E11",
  "source_sample_count": 1024,
  "sample_rate_hz": 3198.44,
  "bin_count": 512,
  "bin_hz": 3.123477,
  "value_scale": 256.0,
  "magnitude_unit": "m/s2",
  "data_format": "u16le",
  "byte_length": 1024,
  "axis": "x",
  "data": "<Buffer 00 00 01 00 02 00 ...>"
}
```

### 3.4 `device:telemetry:yspectrum`

```json
{
  "deviceId": "ESP-462F82",
  "uuid": "462F82AA-BBCC-4DEE-8F11-223344556677",
  "telemetryUuid": "F7A1C490-1C7B-5F66-92B4-78D7A64B9E11",
  "source_sample_count": 1024,
  "sample_rate_hz": 3198.44,
  "bin_count": 512,
  "bin_hz": 3.123477,
  "value_scale": 256.0,
  "magnitude_unit": "m/s2",
  "data_format": "u16le",
  "byte_length": 1024,
  "axis": "y",
  "data": "<Buffer 00 00 01 00 01 00 ...>"
}
```

### 3.5 `device:telemetry:zspectrum`

```json
{
  "deviceId": "ESP-462F82",
  "uuid": "462F82AA-BBCC-4DEE-8F11-223344556677",
  "telemetryUuid": "F7A1C490-1C7B-5F66-92B4-78D7A64B9E11",
  "source_sample_count": 1024,
  "sample_rate_hz": 3198.44,
  "bin_count": 512,
  "bin_hz": 3.123477,
  "value_scale": 256.0,
  "magnitude_unit": "m/s2",
  "data_format": "u16le",
  "byte_length": 1024,
  "axis": "z",
  "data": "<Buffer 03 00 05 00 02 00 ...>"
}
```

Ý nghĩa chung cho 3 event spectrum:

- `deviceId`: phải trùng với `deviceId` trong `device:telemetry`.
- `uuid`: phải trùng với `uuid` của thiết bị trong `device:telemetry`.
- `telemetryUuid`: phải trùng với `telemetryUuid` trong `device:telemetry` mà spectrum này thuộc về.
- `source_sample_count`: số mẫu raw nguồn dùng để tính phổ; hiện tại là `1024`.
- `sample_rate_hz`: tần số lấy mẫu của frame này.
- `bin_count`: số cột phổ của mỗi trục; hiện tại là `512`.
- `bin_hz`: độ rộng tần số của mỗi cột FFT dương; hiện tại bằng `sample_rate_hz / 1024`.
- `value_scale`: spectrum được lượng tử hóa thành `uint16`; backend đổi lại bằng công thức `value / value_scale`.
- `magnitude_unit`: biên độ phổ sau giải mã là `m/s2`.
- `data_format`: hiện tại là `u16le` (tức `uint16 little-endian`).
- `byte_length`: độ dài attachment binary; hiện tại là `1024`.
- `axis`: trục của spectrum (`x`, `y`, `z`).
- `data`: `Buffer`/binary attachment của Socket.IO, chứa đúng `512` giá trị `uint16`.
- Phổ được tính bằng FFT `1024` điểm trên ESP và chỉ gửi nửa phổ dương (bỏ DC).

Công thức tần số của cột phổ thứ `i`:

- `freq_hz(i) = bin_hz * (i + 1)`

Công thức đổi biên độ:

- `amplitude_mps2 = spectrum_value / 256.0`

### 3.6 `device:metadata`

```json
{
  "firmware": "esp-462F82",
  "sensorVersion": "1.1.0",
  "site": "s9-site-1774410483072",
  "zone": "rollout",
  "uuid": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "deviceId": "ESP-462F82"
}
```

### 3.7 `device:command:ack`

```json
{
  "commandId": "cmd-2026-04-01-0001"
}
```

## 4. Event Server -> Device

Firmware hiện tại chỉ xử lý:

| Event | Yêu cầu payload | Hành vi firmware |
|---|---|---|
| `device:command` | có `commandId` kiểu string | queue ACK và gửi `device:command:ack` |

## 4.1 HTTP config command (Web UI -> ESP)

Firmware có endpoint:

- `POST /api/data-packages`

`Content-Type`: `application/x-www-form-urlencoded`

Field firmware nhận:

- package enable:
  - `telemetry_enabled`, `connection_enabled`, `metadata_enabled` (`0|1`)
- package interval (giây):
  - `telemetry_interval_sec`, `connection_interval_sec`, `metadata_interval_sec`
- telemetry field:
  - `vibration`, `temperature`, `ax`, `ay`, `az`, `signal`, `spectrum_x`, `spectrum_y`, `spectrum_z`
- metadata field toggle:
  - `meta_firmware`, `meta_sensor`, `meta_site`, `meta_zone`, `meta_uuid`, `meta_device_id`
- metadata value (mới, lưu bền):
  - `metadata_firmware_value`
  - `metadata_sensor_value`
  - `metadata_site_value`
  - `metadata_zone_value`

Ví dụ request body:

`telemetry_enabled=1&connection_enabled=1&metadata_enabled=1&telemetry_interval_sec=10&connection_interval_sec=30&metadata_interval_sec=60&vibration=1&temperature=1&ax=1&ay=1&az=1&signal=1&spectrum_x=1&spectrum_y=1&spectrum_z=1&meta_firmware=1&meta_sensor=1&meta_site=1&meta_zone=1&meta_uuid=1&meta_device_id=1&metadata_firmware_value=vibration-monitor&metadata_sensor_value=1.1.0&metadata_site_value=s9-site-1774410483072&metadata_zone_value=rollout`

Response thành công:

```json
{
  "ok": true,
  "message": "saved"
}
```

## 5. Trình tự gửi spectrum

Khi có một frame mới và đến chu kỳ telemetry:

1. firmware gửi `device:telemetry`
2. firmware queue spectrum theo `telemetryUuid`
3. firmware tính FFT `1024` điểm cho từng trục khi đến lượt gửi trục đó
4. firmware gửi lần lượt binary event:
   - `device:telemetry:xspectrum`
   - `device:telemetry:yspectrum`
   - `device:telemetry:zspectrum`

Mỗi event spectrum có `1` metadata object và `1` attachment binary `1024` bytes.

## 6. Gợi ý xử lý phía server

Server nên:

1. nhận `device:telemetry` và lấy `uuid`, `telemetryUuid`
2. tạo context theo cặp khóa `uuid + telemetryUuid`
3. nhận `device:telemetry:xspectrum`, `device:telemetry:yspectrum`, `device:telemetry:zspectrum`
4. chỉ chấp nhận spectrum nếu `uuid` và `telemetryUuid` khớp với telemetry đã nhận
5. ghép lại theo `uuid + telemetryUuid` thành:
   - `x.data` -> `uint16[512]`
   - `y.data` -> `uint16[512]`
   - `z.data` -> `uint16[512]`
6. đổi biên độ: 
   - `value / 256.0 => m/s2`
7. tính trục tần số:
   - `freq_hz(i) = bin_hz * (i + 1)`

## 7. Ghi chú quan trọng

- Đây là dữ liệu phổ, không phải raw time-domain.
- Trong lúc đang gửi bộ `xspectrum/yspectrum/zspectrum`, firmware giữ nguyên frame hiện tại để 3 event cùng thuộc một `telemetryUuid`.
- Để phân biệt thiết bị khi không dựa vào xác thực socket, backend nên ưu tiên đọc `uuid` ngay trong payload; `deviceId` chỉ nên dùng để hiển thị.
- Để biết spectrum thuộc telemetry nào, backend nên ưu tiên ghép theo `uuid + telemetryUuid`.
- Vì firmware lượng tử hóa phổ thành `uint16 little-endian`, backend cần đọc binary attachment theo `u16le`, rồi chia cho `256.0` nếu muốn dùng biên độ `m/s2` thực.
- Cấu hình package và metadata value được lưu vào flash (EEPROM emulation), reboot vẫn giữ.
- Firmware đọc cấu hình từ flash khi boot, sau đó dùng bản RAM trong runtime; không đọc flash liên tục theo chu kỳ gửi.
