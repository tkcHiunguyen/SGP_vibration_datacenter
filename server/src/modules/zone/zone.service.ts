import type { MySqlAccess } from '../persistence/mysql-access.js';
import { getSharedMySqlAccess } from '../persistence/mysql-access.js';

type ZoneRow = {
  id: number | string;
  code: string;
  name: string;
  description: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export type ZoneRecord = {
  id: number;
  code: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type ZoneCreateInput = {
  code?: string;
  name: string;
  description?: string;
};

export type ZoneUpdateInput = {
  code?: string;
  name?: string;
  description?: string | null;
};

export type ZoneDescriptionFilter = 'all' | 'with-description' | 'without-description';
export type ZoneSortOption = 'updated-desc' | 'name-asc' | 'code-asc';

export type ZoneListOptions = {
  search?: string;
  descriptionFilter?: ZoneDescriptionFilter;
  sortBy?: ZoneSortOption;
  page?: number;
  pageSize?: number;
};

export type ZoneListResult = {
  items: ZoneRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ZoneSummary = {
  total: number;
  withDescription: number;
  updatedToday: number;
  latestUpdatedAt?: string;
};

const DEFAULT_ZONE_PAGE = 1;
const DEFAULT_ZONE_PAGE_SIZE = 20;
const MAX_ZONE_PAGE_SIZE = 200;

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return normalized.endsWith('Z') ? normalized : `${normalized}Z`;
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeZoneCode(value?: string): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return undefined;
  }

  const code = normalized
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  return code || undefined;
}

function toZoneRecord(row: ZoneRow): ZoneRecord {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

export class ZoneService {
  private readonly fallback = new Map<number, ZoneRecord>();
  private fallbackId = 1;

  constructor(private readonly mysql: MySqlAccess | null = getSharedMySqlAccess()) {}

  async list(search?: string): Promise<ZoneRecord[]> {
    const result = await this.listPage({
      search,
      page: DEFAULT_ZONE_PAGE,
      pageSize: MAX_ZONE_PAGE_SIZE,
      sortBy: 'code-asc',
      descriptionFilter: 'all',
    });
    return result.items;
  }

  async listPage(options: ZoneListOptions = {}): Promise<ZoneListResult> {
    const page = this.normalizePage(options.page);
    const pageSize = this.normalizePageSize(options.pageSize);
    const search = normalizeOptionalText(options.search);
    const descriptionFilter = options.descriptionFilter ?? 'all';
    const sortBy = options.sortBy ?? 'updated-desc';
    const offset = (page - 1) * pageSize;

    if (!this.mysql) {
      let rows = [...this.fallback.values()];
      rows = this.applySearch(rows, search);
      rows = this.applyDescriptionFilter(rows, descriptionFilter);
      rows = this.sortRows(rows, sortBy);

      const total = rows.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const normalizedPage = Math.min(page, totalPages);
      const start = (normalizedPage - 1) * pageSize;
      const items = rows.slice(start, start + pageSize);

      return {
        items,
        total,
        page: normalizedPage,
        pageSize,
        totalPages,
      };
    }

    const whereClauses: string[] = [];
    const whereParams: Array<string> = [];

    if (search) {
      const like = `%${search}%`;
      whereClauses.push('(code LIKE ? OR name LIKE ? OR description LIKE ?)');
      whereParams.push(like, like, like);
    }

    if (descriptionFilter === 'with-description') {
      whereClauses.push('description IS NOT NULL AND TRIM(description) <> \'\'');
    } else if (descriptionFilter === 'without-description') {
      whereClauses.push('(description IS NULL OR TRIM(description) = \'\')');
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const orderSql = this.resolveOrderSql(sortBy);
    const totalRows = await this.mysql.query<{ total: number | string }>(
      `
        SELECT COUNT(*) AS total
        FROM zones
        ${whereSql}
      `,
      whereParams,
    );
    const total = Number(totalRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const normalizedPage = Math.min(page, totalPages);
    const normalizedOffset = (normalizedPage - 1) * pageSize;

    const rows = await this.mysql.query<ZoneRow>(
      `
        SELECT id, code, name, description, created_at, updated_at
        FROM zones
        ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ? OFFSET ?
      `,
      [...whereParams, pageSize, normalizedOffset],
    );

    return {
      items: rows.map(toZoneRecord),
      total,
      page: normalizedPage,
      pageSize,
      totalPages,
    };
  }

  async summary(): Promise<ZoneSummary> {
    if (!this.mysql) {
      const rows = [...this.fallback.values()];
      const withDescription = rows.filter((row) => Boolean(normalizeOptionalText(row.description))).length;
      const latestUpdatedAt = rows
        .map((row) => row.updatedAt)
        .sort((left, right) => right.localeCompare(left))[0];
      const updatedToday = rows.filter((row) => this.isToday(row.updatedAt)).length;

      return {
        total: rows.length,
        withDescription,
        updatedToday,
        latestUpdatedAt,
      };
    }

    const [totals] = await this.mysql.query<{ total: number | string; with_description: number | string }>(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN description IS NOT NULL AND TRIM(description) <> '' THEN 1 ELSE 0 END) AS with_description
        FROM zones
      `,
    );
    const [updatedTodayRow] = await this.mysql.query<{ total: number | string }>(
      `
        SELECT COUNT(*) AS total
        FROM zones
        WHERE DATE(updated_at) = CURRENT_DATE()
      `,
    );
    const [latestRow] = await this.mysql.query<{ latest_updated_at: string | Date | null }>(
      `
        SELECT MAX(updated_at) AS latest_updated_at
        FROM zones
      `,
    );

    const latestRaw = latestRow?.latest_updated_at;
    return {
      total: Number(totals?.total ?? 0),
      withDescription: Number(totals?.with_description ?? 0),
      updatedToday: Number(updatedTodayRow?.total ?? 0),
      latestUpdatedAt: latestRaw ? toIsoTimestamp(latestRaw) : undefined,
    };
  }

  async get(zoneId: number): Promise<ZoneRecord | null> {
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      return null;
    }

    if (!this.mysql) {
      return this.fallback.get(zoneId) ?? null;
    }

    const rows = await this.mysql.query<ZoneRow>(
      `
        SELECT id, code, name, description, created_at, updated_at
        FROM zones
        WHERE id = ?
        LIMIT 1
      `,
      [zoneId],
    );

    const row = rows[0];
    return row ? toZoneRecord(row) : null;
  }

  async create(input: ZoneCreateInput): Promise<ZoneRecord> {
    const name = normalizeOptionalText(input.name);
    if (!name) {
      throw new Error('zone_name_required');
    }

    const codeBase = normalizeZoneCode(input.code) ?? normalizeZoneCode(name) ?? 'ZONE';
    const description = normalizeOptionalText(input.description);
    const now = new Date().toISOString();

    if (!this.mysql) {
      const code = this.ensureUniqueFallbackCode(codeBase);
      const record: ZoneRecord = {
        id: this.fallbackId++,
        code,
        name,
        description,
        createdAt: now,
        updatedAt: now,
      };
      this.fallback.set(record.id, record);
      return record;
    }

    const code = await this.ensureUniqueCode(codeBase);
    await this.mysql.execute(
      `
        INSERT INTO zones (code, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      [code, name, description ?? null, now, now],
    );

    const rows = await this.mysql.query<ZoneRow>(
      `
        SELECT id, code, name, description, created_at, updated_at
        FROM zones
        WHERE code = ?
        ORDER BY id DESC
        LIMIT 1
      `,
      [code],
    );

    const created = rows[0];
    if (!created) {
      throw new Error('zone_create_failed');
    }

    return toZoneRecord(created);
  }

  async update(zoneId: number, input: ZoneUpdateInput): Promise<ZoneRecord | null> {
    const existing = await this.get(zoneId);
    if (!existing) {
      return null;
    }

    const nextName = normalizeOptionalText(input.name) ?? existing.name;
    const nextDescription =
      input.description === null ? undefined : normalizeOptionalText(input.description) ?? existing.description;
    const nextCodeBase = normalizeZoneCode(input.code) ?? existing.code;
    const now = new Date().toISOString();

    if (!this.mysql) {
      const nextCode = this.ensureUniqueFallbackCode(nextCodeBase, zoneId);
      const updated: ZoneRecord = {
        ...existing,
        code: nextCode,
        name: nextName,
        description: nextDescription,
        updatedAt: now,
      };
      this.fallback.set(zoneId, updated);
      return updated;
    }

    const nextCode = await this.ensureUniqueCode(nextCodeBase, zoneId);
    await this.mysql.execute(
      `
        UPDATE zones
        SET code = ?, name = ?, description = ?, updated_at = ?
        WHERE id = ?
      `,
      [nextCode, nextName, nextDescription ?? null, now, zoneId],
    );

    return this.get(zoneId);
  }

  async remove(zoneId: number): Promise<boolean> {
    if (!Number.isFinite(zoneId) || zoneId <= 0) {
      return false;
    }

    if (!this.mysql) {
      return this.fallback.delete(zoneId);
    }

    const affected = await this.mysql.execute('DELETE FROM zones WHERE id = ?', [zoneId]);
    return affected > 0;
  }

  private applySearch(rows: ZoneRecord[], search?: string): ZoneRecord[] {
    const needle = normalizeOptionalText(search)?.toLowerCase();
    if (!needle) {
      return rows;
    }

    return rows.filter((row) =>
      [row.code, row.name, row.description ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }

  private applyDescriptionFilter(rows: ZoneRecord[], descriptionFilter: ZoneDescriptionFilter): ZoneRecord[] {
    if (descriptionFilter === 'all') {
      return rows;
    }

    return rows.filter((row) => {
      const hasDescription = Boolean(normalizeOptionalText(row.description));
      return descriptionFilter === 'with-description' ? hasDescription : !hasDescription;
    });
  }

  private sortRows(rows: ZoneRecord[], sortBy: ZoneSortOption): ZoneRecord[] {
    const next = [...rows];
    if (sortBy === 'name-asc') {
      return next.sort((left, right) => left.name.localeCompare(right.name, 'vi') || left.id - right.id);
    }
    if (sortBy === 'code-asc') {
      return next.sort((left, right) => left.code.localeCompare(right.code, 'vi') || left.id - right.id);
    }
    return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id);
  }

  private normalizePage(value?: number): number {
    if (!Number.isFinite(value) || !value) {
      return DEFAULT_ZONE_PAGE;
    }
    return Math.max(1, Math.floor(value));
  }

  private normalizePageSize(value?: number): number {
    if (!Number.isFinite(value) || !value) {
      return DEFAULT_ZONE_PAGE_SIZE;
    }
    return Math.max(1, Math.min(MAX_ZONE_PAGE_SIZE, Math.floor(value)));
  }

  private resolveOrderSql(sortBy: ZoneSortOption): string {
    if (sortBy === 'name-asc') {
      return 'name ASC, id ASC';
    }
    if (sortBy === 'code-asc') {
      return 'code ASC, id ASC';
    }
    return 'updated_at DESC, id DESC';
  }

  private isToday(isoLike: string): boolean {
    const parsed = Date.parse(isoLike);
    if (Number.isNaN(parsed)) {
      return false;
    }
    const value = new Date(parsed);
    const now = new Date();
    return (
      value.getUTCFullYear() === now.getUTCFullYear() &&
      value.getUTCMonth() === now.getUTCMonth() &&
      value.getUTCDate() === now.getUTCDate()
    );
  }

  private ensureUniqueFallbackCode(codeBase: string, exceptId?: number): string {
    let candidate = codeBase;
    let suffix = 1;

    while (
      [...this.fallback.values()].some((zone) => zone.code === candidate && (exceptId === undefined || zone.id !== exceptId))
    ) {
      suffix += 1;
      candidate = `${codeBase}_${suffix}`;
    }

    return candidate;
  }

  private async ensureUniqueCode(codeBase: string, exceptId?: number): Promise<string> {
    if (!this.mysql) {
      return codeBase;
    }

    let candidate = codeBase;
    let suffix = 1;

    while (true) {
      const rows = await this.mysql.query<{ id: number | string }>(
        `
          SELECT id
          FROM zones
          WHERE code = ?
          LIMIT 1
        `,
        [candidate],
      );

      const row = rows[0];
      if (!row) {
        return candidate;
      }

      if (exceptId !== undefined && Number(row.id) === exceptId) {
        return candidate;
      }

      suffix += 1;
      candidate = `${codeBase}_${suffix}`;
    }
  }
}
