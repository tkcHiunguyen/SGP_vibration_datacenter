# TELEMETRY SOCKET CONTRACT

Contract version: `1.0.0`
Owner/source of truth: firmware project `platformio/project/vibration`
Consumer: datacenter project `ruby/sgp_vibration_datacenter`

This document is the integration contract between firmware and server/dashboard. If either side changes payload fields, units, scaling, event names, binary format, or frequency formulas, update this file first.

---

## 1. Rules

- Firmware emits data according to this contract.
- Datacenter must decode/render according to this contract.
- Datacenter must not fake FFT/spectrum in production.
- Datacenter must not apply `value_scale` twice.
- Unit labels in UI must come from this contract/payload metadata.
- Any breaking change requires `contract_version` bump.

Breaking changes include:

- event rename
- field rename/removal
- unit change
- scale change
- endian/byte size/bin count change
- frequency axis formula change
- semantic change of `vibration`

---

## 2. Telemetry event

### Event name

```txt
device:telemetry
```

### Payload format

JSON object.

### Current semantic

```txt
vibration = velocity RMS, not acceleration
vibration_unit = mm/s RMS
```

Acceleration RMS remains available via explicit `*_mps2` fields.

### Required/core fields

```json
{
  "contract_version": "1.0.0",
  "telemetry_uuid": "string",
  "device_id": "string",
  "firmware_version": "string",
  "timestamp_ms": 123456,

  "vibration": 1.234,
  "vibration_unit": "mm/s RMS",

  "velocity_rms_mms": 1.234,
  "vx_rms_mms": 1.111,
  "vy_rms_mms": 1.222,
  "vz_rms_mms": 1.333,
  "velocity_rms_method": "max_axis",
  "velocity_rms_band_min_hz": 10,
  "velocity_rms_band_max_hz": 1000,
  "velocity_rms_effective_band_max_hz": 450,
  "velocity_rms_band_limited": true,

  "accel_unit": "m/s2 RMS",
  "accel_rms_mps2": 0.456,
  "ax_rms_mps2": 0.111,
  "ay_rms_mps2": 0.222,
  "az_rms_mps2": 0.333,

  "actual_sample_rate_hz": 1000.0,
  "sample_count": 1024,
  "range_g": 16,
  "lsb_per_g": 256.0,
  "scale_mps2_per_lsb": 0.0383072265625,

  "dropped_samples": 0,
  "dropped_samples_estimated": true,
  "fifo_overrun_count": 0,
  "capture_timeout_count": 0,
  "i2c_read_error_count": 0
}
```

### Field meanings

| Field | Unit | Meaning |
|---|---:|---|
| `vibration` | `mm/s RMS` | Same as `velocity_rms_mms`; overall velocity RMS |
| `velocity_rms_mms` | `mm/s RMS` | Overall velocity RMS |
| `vx_rms_mms` | `mm/s RMS` | X-axis velocity RMS |
| `vy_rms_mms` | `mm/s RMS` | Y-axis velocity RMS |
| `vz_rms_mms` | `mm/s RMS` | Z-axis velocity RMS |
| `velocity_rms_method` | text | Overall method; current: `max_axis` |
| `accel_rms_mps2` | `m/s2 RMS` | Overall acceleration RMS |
| `ax_rms_mps2` | `m/s2 RMS` | X-axis acceleration RMS |
| `ay_rms_mps2` | `m/s2 RMS` | Y-axis acceleration RMS |
| `az_rms_mps2` | `m/s2 RMS` | Z-axis acceleration RMS |
| `actual_sample_rate_hz` | Hz | Measured capture sample rate |
| `sample_count` | samples | Source samples per frame; current: `1024` |
| `lsb_per_g` | LSB/g | Current ADXL345 scale; current: `256` |
| `scale_mps2_per_lsb` | `m/s2/LSB` | `9.80665 / lsb_per_g` |

---

## 3. Spectrum events

### Event names

```txt
device:telemetry:xspectrum
device:telemetry:yspectrum
device:telemetry:zspectrum
```

### Payload structure

Each spectrum event has:

1. JSON metadata
2. binary payload

The binary payload is raw spectrum magnitudes.

### Metadata fields

```json
{
  "contract_version": "1.0.0",
  "telemetry_uuid": "string",
  "device_id": "string",
  "axis": "x",

  "data_format": "u16le",
  "byte_length": 1024,
  "bin_count": 512,
  "source_sample_count": 1024,
  "value_scale": 256.0,

  "magnitude_unit": "m/s2 RMS",
  "actual_sample_rate_hz": 1000.0,
  "bin_hz": 0.9765625,
  "dc_omitted": true
}
```

### Binary format

```txt
format: uint16 little-endian
byte_length: 1024
bin_count: 512
bytes per bin: 2
```

Decode:

```txt
raw_u16 = readUInt16LE(buffer, i * 2)
amplitude_mps2_rms = raw_u16 / value_scale
```

Current scale:

```txt
value_scale = 256.0
```

Important:

```txt
Server decodes raw_u16 / 256.0 exactly once.
Frontend must not divide again.
```

---

## 4. Frequency axis

DC bin is omitted.

Formula:

```txt
bin_hz = actual_sample_rate_hz / source_sample_count
freq_hz(i) = bin_hz * (i + 1)
```

Where:

```txt
i = 0..511
source_sample_count = 1024
bin_count = 512
```

Example with `actual_sample_rate_hz = 1000`:

```txt
bin_hz = 1000 / 1024 = 0.9765625 Hz
freq_hz(0) = 0.9765625 Hz
freq_hz(1) = 1.953125 Hz
freq_hz(511) = 500 Hz
```

---

## 5. Units summary

| Data | Unit | Domain |
|---|---:|---|
| `vibration` | `mm/s RMS` | velocity |
| `velocity_*_mms` | `mm/s RMS` | velocity |
| `accel_*_mps2` | `m/s2 RMS` | acceleration |
| spectrum amplitude | `m/s2 RMS` | acceleration spectrum |
| frequency | Hz | spectrum x-axis |
| displacement trend, if derived by UI | µm or mm | derived from acceleration spectrum |

---

## 6. Server/datacenter implementation requirements

### Must do

- Listen to telemetry event: `device:telemetry`.
- Store/display `vibration` as `mm/s RMS`.
- Store/display acceleration separately as `m/s2 RMS`.
- Listen to spectrum events:
  - `device:telemetry:xspectrum`
  - `device:telemetry:yspectrum`
  - `device:telemetry:zspectrum`
- Decode spectrum binary as `uint16 little-endian`.
- Convert amplitude with `raw_u16 / value_scale`.
- Build frequency axis using metadata formula.
- Render actual decoded spectrum payload.

### Must not do

- Do not generate fake FFT/spectrum for real device data.
- Do not treat `vibration` as acceleration.
- Do not label `vibration` as `m/s2` or `g`.
- Do not divide by `value_scale` twice.
- Do not assume fixed sample rate if `actual_sample_rate_hz` exists.

---

## 7. Backward compatibility

For old datacenter code:

```txt
old meaning: vibration = acceleration-ish
new meaning: vibration = velocity_rms_mms
```

Therefore datacenter must prefer explicit fields:

```txt
velocity_rms_mms → velocity display/trend
accel_rms_mps2 → acceleration display/trend
vibration → legacy alias for velocity_rms_mms only
```

Recommended UI labels:

```txt
Vibration velocity RMS: <velocity_rms_mms> mm/s RMS
Acceleration RMS: <accel_rms_mps2> m/s² RMS
Spectrum: m/s² RMS vs Hz
```

---

## 8. Test vector

Example spectrum buffer first 4 bins:

```txt
raw_u16: [256, 512, 1024, 0]
value_scale: 256.0
actual_sample_rate_hz: 1000
source_sample_count: 1024
```

Expected decode:

```txt
amplitudes_mps2_rms: [1.0, 2.0, 4.0, 0.0]
freq_hz: [0.9765625, 1.953125, 2.9296875, 3.90625]
```

---

## 9. Change procedure

When firmware changes payload:

1. Update this contract.
2. Bump `contract_version`.
3. Keep old fields if possible.
4. Add explicit new fields with unit suffix.
5. Add/adjust test vector.
6. Update datacenter decode.
7. Update datacenter UI labels.
8. Verify with real socket payload logs.

When datacenter changes decode/render:

1. Read this contract first.
2. Do not infer unit/scale from chart names.
3. Confirm event name + binary format + scale.
4. Add decode tests using section 8.

---

## 10. Definition of done

Integration is correct when:

- Datacenter receives `device:telemetry`.
- Datacenter displays velocity RMS in `mm/s RMS`.
- Datacenter displays acceleration RMS in `m/s2 RMS`.
- Datacenter receives 3 spectrum events per frame.
- Each spectrum binary length is `1024` bytes.
- Each decoded spectrum has `512` bins.
- First spectrum bin frequency is `actual_sample_rate_hz / 1024`.
- Spectrum y-axis is `m/s2 RMS`.
- No fake FFT is shown for real devices.
- No double scaling occurs.
