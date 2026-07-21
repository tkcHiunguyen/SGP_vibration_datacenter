import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Transform, type Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { z } from 'zod';

import {
  sgpDataDeviceSchema,
  sgpDataManifestSchema,
  sgpDataSpectrumFrameSchema,
  sgpDataTelemetryPointSchema,
  type SgpDataPreview,
  type SgpDataStreamEntry,
} from './sgpdata.types.js';

const DEFAULT_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 50_000_000;
const DEFAULT_MAX_SPECTRUM_BYTES = 16 * 1024 * 1024;

type ParserLimits = {
  maxUncompressedBytes?: number;
  maxLineBytes?: number;
  maxRecords?: number;
  maxSpectrumBytes?: number;
};

type ParsedEnd = {
  checksumSha256: string;
};

const placementConfigSchema = z.object({
  deviceId: z.string().min(1),
  config: z.object({}).passthrough(),
});

const endSchema = z.object({ checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i) });

class ByteLimitTransform extends Transform {
  private total = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length;
    if (this.total > this.maxBytes) {
      callback(new Error('sgpdata_uncompressed_too_large'));
      return;
    }
    callback(null, chunk);
  }
}

async function isGzipFile(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(2);
    const { bytesRead } = await handle.read(header, 0, 2, 0);
    return bytesRead === 2 && header[0] === 0x1f && header[1] === 0x8b;
  } finally {
    await handle.close();
  }
}

async function createDecodedStream(filePath: string, maxUncompressedBytes: number): Promise<Readable> {
  const source = createReadStream(filePath);
  const decoded = (await isGzipFile(filePath)) ? source.pipe(createGunzip()) : source;
  return decoded.pipe(new ByteLimitTransform(maxUncompressedBytes));
}

async function readDecodedPrefix(filePath: string, maxUncompressedBytes: number): Promise<string> {
  const stream = await createDecodedStream(filePath, maxUncompressedBytes);
  let prefix = '';
  try {
    for await (const chunk of stream) {
      prefix += Buffer.from(chunk).toString('utf8');
      if (prefix.length >= 8_192 || prefix.trimStart().length >= 16) {
        break;
      }
    }
  } finally {
    stream.destroy();
  }
  return prefix.trimStart();
}

function parseV2Entry(type: unknown, data: unknown, maxSpectrumBytes: number): SgpDataStreamEntry | ParsedEnd | null {
  switch (type) {
    case 'manifest':
      return { type, data: sgpDataManifestSchema.parse(data) };
    case 'device':
      return { type, data: sgpDataDeviceSchema.parse(data) };
    case 'measurement':
      return { type, data: sgpDataTelemetryPointSchema.parse(data) };
    case 'spectrumFrame': {
      const frame = sgpDataSpectrumFrameSchema.parse(data);
      const estimatedBytes = Math.floor((frame.contentBase64.length * 3) / 4);
      if (estimatedBytes > maxSpectrumBytes) {
        throw new Error('sgpdata_spectrum_frame_too_large');
      }
      return { type, data: frame };
    }
    case 'placementConfig':
      return { type, data: placementConfigSchema.parse(data) };
    case 'end':
      return endSchema.parse(data);
    default:
      throw new Error('sgpdata_entry_type_invalid');
  }
}

async function* iterateV2Entries(filePath: string, limits: Required<ParserLimits>): AsyncGenerator<SgpDataStreamEntry> {
  const input = await createDecodedStream(filePath, limits.maxUncompressedBytes);
  const lines = createInterface({ input, crlfDelay: Infinity });
  const checksum = createHash('sha256');
  let recordCount = 0;
  let endRecord: ParsedEnd | null = null;
  let sawManifest = false;
  let manifest: Extract<SgpDataStreamEntry, { type: 'manifest' }>['data'] | null = null;

  try {
    for await (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (Buffer.byteLength(line, 'utf8') > limits.maxLineBytes) {
        throw new Error('sgpdata_line_too_large');
      }
      if (endRecord) {
        throw new Error('sgpdata_data_after_end');
      }
      let rawEntry: { type?: unknown; data?: unknown };
      try {
        rawEntry = JSON.parse(line) as { type?: unknown; data?: unknown };
      } catch {
        throw new Error('sgpdata_json_invalid');
      }
      const parsed = parseV2Entry(rawEntry.type, rawEntry.data, limits.maxSpectrumBytes);
      if (rawEntry.type === 'end') {
        endRecord = parsed as ParsedEnd;
        continue;
      }
      checksum.update(line).update('\n');
      recordCount += 1;
      if (recordCount > limits.maxRecords) {
        throw new Error('sgpdata_record_limit_exceeded');
      }
      const entry = parsed as SgpDataStreamEntry;
      if (entry.type === 'manifest') {
        if (sawManifest) {
          throw new Error('sgpdata_manifest_duplicate');
        }
        if (entry.data.version !== 2) {
          throw new Error('sgpdata_v2_manifest_required');
        }
        sawManifest = true;
        manifest = entry.data;
      }
      yield entry;
    }
  } finally {
    lines.close();
  }

  if (!sawManifest) {
    throw new Error('sgpdata_manifest_missing');
  }
  if (!endRecord) {
    throw new Error('sgpdata_end_missing');
  }
  const actualChecksum = checksum.digest('hex');
  if (actualChecksum !== endRecord.checksumSha256) {
    throw new Error('sgpdata_checksum_mismatch');
  }
  if (manifest) {
    manifest.checksumSha256 = endRecord.checksumSha256;
  }
}

function resolveLimits(limits: ParserLimits = {}): Required<ParserLimits> {
  return {
    maxUncompressedBytes: limits.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES,
    maxLineBytes: limits.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
    maxRecords: limits.maxRecords ?? DEFAULT_MAX_RECORDS,
    maxSpectrumBytes: limits.maxSpectrumBytes ?? DEFAULT_MAX_SPECTRUM_BYTES,
  };
}

export async function* iterateSgpDataEntries(filePath: string, parserLimits: ParserLimits = {}): AsyncGenerator<SgpDataStreamEntry> {
  const limits = resolveLimits(parserLimits);
  const prefix = await readDecodedPrefix(filePath, limits.maxUncompressedBytes);
  if (prefix.startsWith('{') && !/^\{\s*"type"\s*:/.test(prefix)) {
    throw new Error('sgpdata_v1_unsupported');
  }
  yield* iterateV2Entries(filePath, limits);
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(Buffer.from(chunk));
  }
  return hash.digest('hex');
}

export async function inspectSgpDataFile(filePath: string, parserLimits: ParserLimits = {}): Promise<SgpDataPreview> {
  let manifest = sgpDataManifestSchema.parse({ format: 'sgpdata', version: 2 });
  const devices = new Map<string, SgpDataPreview['devices'][number]>();
  let measurementCount = 0;
  let spectrumCount = 0;
  let placementConfigCount = 0;

  for await (const entry of iterateSgpDataEntries(filePath, parserLimits)) {
    switch (entry.type) {
      case 'manifest':
        manifest = entry.data;
        break;
      case 'device':
        devices.set(entry.data.deviceId, {
          ...devices.get(entry.data.deviceId),
          deviceId: entry.data.deviceId,
          name: entry.data.name,
          site: entry.data.site,
          zone: entry.data.zone,
          firmwareVersion: entry.data.firmwareVersion,
          measurementsTotal: devices.get(entry.data.deviceId)?.measurementsTotal ?? 0,
          spectrumTotal: devices.get(entry.data.deviceId)?.spectrumTotal ?? 0,
        });
        break;
      case 'measurement': {
        measurementCount += 1;
        const current = devices.get(entry.data.deviceId);
        devices.set(entry.data.deviceId, {
          deviceId: entry.data.deviceId,
          ...current,
          measurementsTotal: (current?.measurementsTotal ?? 0) + 1,
          spectrumTotal: current?.spectrumTotal ?? 0,
        });
        break;
      }
      case 'spectrumFrame': {
        spectrumCount += 1;
        const current = devices.get(entry.data.deviceId);
        devices.set(entry.data.deviceId, {
          deviceId: entry.data.deviceId,
          ...current,
          measurementsTotal: current?.measurementsTotal ?? 0,
          spectrumTotal: (current?.spectrumTotal ?? 0) + 1,
        });
        break;
      }
      case 'placementConfig':
        placementConfigCount += 1;
        if (!devices.has(entry.data.deviceId)) {
          devices.set(entry.data.deviceId, {
            deviceId: entry.data.deviceId,
            measurementsTotal: 0,
            spectrumTotal: 0,
          });
        }
        break;
    }
  }

  return {
    manifest,
    metadata: {
      deviceCount: devices.size,
      measurementCount,
      spectrumCount,
      placementConfigCount,
      dateFrom: manifest.dateRange?.from,
      dateTo: manifest.dateRange?.to,
      checksumSha256: manifest.checksumSha256,
      checksumValid: true,
    },
    dateRange: manifest.dateRange,
    devices: [...devices.values()],
    measurements: measurementCount,
    spectra: spectrumCount,
  };
}
