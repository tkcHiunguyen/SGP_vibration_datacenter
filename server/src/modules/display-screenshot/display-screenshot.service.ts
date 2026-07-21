import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const DISPLAY_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024;

const METADATA_FILE_NAME = 'latest.json';

export type DisplayScreenshotRecord = {
  clientId: string;
  displayName: string;
  capturedAt: string;
  receivedAt: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  fileName: string;
  sizeBytes: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  pagePath: string;
  clientIp?: string;
  userAgent?: string;
};

type DisplayScreenshotServiceOptions = {
  baseDir?: string;
};

type StoreDisplayScreenshotInput = Omit<
  DisplayScreenshotRecord,
  'receivedAt' | 'contentType' | 'fileName' | 'sizeBytes'
> & {
  contentType: string;
  buffer: Buffer;
};

function normalizeContentType(value: string): DisplayScreenshotRecord['contentType'] | null {
  const normalized = value.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') {
    return normalized;
  }
  return null;
}

function extensionFor(contentType: DisplayScreenshotRecord['contentType']): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

export class DisplayScreenshotService {
  private readonly baseDir: string;

  constructor(options: DisplayScreenshotServiceOptions = {}) {
    this.baseDir = options.baseDir ?? join(process.cwd(), 'storage', 'display-screenshots');
  }

  async store(input: StoreDisplayScreenshotInput): Promise<DisplayScreenshotRecord> {
    const contentType = normalizeContentType(input.contentType);
    if (!contentType) {
      throw new Error('display_screenshot_content_type_invalid');
    }
    if (input.buffer.length === 0) {
      throw new Error('display_screenshot_file_empty');
    }
    if (input.buffer.length > DISPLAY_SCREENSHOT_MAX_BYTES) {
      throw new Error('display_screenshot_file_too_large');
    }

    const receivedAt = new Date().toISOString();
    const capturedAtMs = Date.parse(input.capturedAt);
    const capturedAt = Number.isFinite(capturedAtMs) ? new Date(capturedAtMs).toISOString() : receivedAt;
    const displayDir = this.displayDir(input.clientId);
    const fileName = `latest.${extensionFor(contentType)}`;
    const previous = await this.getLatest(input.clientId);
    const record: DisplayScreenshotRecord = {
      clientId: input.clientId,
      displayName: input.displayName,
      capturedAt,
      receivedAt,
      contentType,
      fileName,
      sizeBytes: input.buffer.length,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      devicePixelRatio: input.devicePixelRatio,
      pagePath: input.pagePath,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
    };

    await mkdir(displayDir, { recursive: true });
    await writeFile(join(displayDir, fileName), input.buffer);
    await writeFile(join(displayDir, METADATA_FILE_NAME), JSON.stringify(record, null, 2), 'utf8');
    if (previous && previous.fileName !== fileName) {
      await unlink(join(displayDir, previous.fileName)).catch(() => undefined);
    }
    return record;
  }

  async listLatest(): Promise<DisplayScreenshotRecord[]> {
    let entries;
    try {
      entries = await readdir(this.baseDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const records = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.getLatest(entry.name)),
    );
    return records
      .filter((record): record is DisplayScreenshotRecord => Boolean(record))
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
  }

  async getLatest(clientId: string): Promise<DisplayScreenshotRecord | null> {
    try {
      const raw = await readFile(join(this.displayDir(clientId), METADATA_FILE_NAME), 'utf8');
      const parsed = JSON.parse(raw) as Partial<DisplayScreenshotRecord>;
      if (
        parsed.clientId !== clientId
        || typeof parsed.displayName !== 'string'
        || typeof parsed.capturedAt !== 'string'
        || typeof parsed.receivedAt !== 'string'
        || typeof parsed.contentType !== 'string'
        || typeof parsed.fileName !== 'string'
        || basename(parsed.fileName) !== parsed.fileName
        || typeof parsed.sizeBytes !== 'number'
        || typeof parsed.viewportWidth !== 'number'
        || typeof parsed.viewportHeight !== 'number'
        || typeof parsed.devicePixelRatio !== 'number'
        || typeof parsed.pagePath !== 'string'
      ) {
        return null;
      }
      const contentType = normalizeContentType(parsed.contentType);
      if (!contentType) {
        return null;
      }
      return { ...parsed, contentType } as DisplayScreenshotRecord;
    } catch {
      return null;
    }
  }

  async readLatest(clientId: string): Promise<{ record: DisplayScreenshotRecord; buffer: Buffer } | null> {
    const record = await this.getLatest(clientId);
    if (!record) {
      return null;
    }
    try {
      const buffer = await readFile(join(this.displayDir(clientId), record.fileName));
      return { record, buffer };
    } catch {
      return null;
    }
  }

  private displayDir(clientId: string): string {
    return join(this.baseDir, clientId);
  }
}
