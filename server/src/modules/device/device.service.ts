import type { DeviceRepository } from './device.repository.js';
import type { DeviceHeartbeat, DeviceMetadata, DeviceSession } from '../../shared/types.js';

type RegisterDeviceInput = {
  deviceId: string;
  uuid?: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  sensorVersion?: string;
  notes?: string;
};

type UpdateDeviceInput = Omit<RegisterDeviceInput, 'deviceId'>;
type SocketMetadataInput = {
  uuid?: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  sensorVersion?: string;
  notes?: string;
};

export type DeviceListItem = {
  deviceId: string;
  online: boolean;
  socketId?: string;
  clientIp?: string;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  heartbeat?: DeviceHeartbeat;
  metadata?: DeviceMetadata;
};

export type DeviceListFilters = {
  site?: string;
  zone?: string;
  status?: 'online' | 'offline';
  search?: string;
};

export class DeviceService {
  constructor(private readonly repository: DeviceRepository) {}

  register(input: RegisterDeviceInput): DeviceMetadata {
    const now = new Date().toISOString();
    const existing = this.repository.getMetadata(input.deviceId);
    const metadata: DeviceMetadata = {
      deviceId: input.deviceId,
      uuid: input.uuid ?? existing?.uuid,
      name: input.name ?? existing?.name,
      site: input.site ?? existing?.site,
      zone: input.zone ?? existing?.zone,
      firmwareVersion: input.firmwareVersion ?? existing?.firmwareVersion,
      sensorVersion: input.sensorVersion ?? existing?.sensorVersion,
      notes: input.notes ?? existing?.notes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.repository.upsertMetadata(metadata);
    return metadata;
  }

  update(deviceId: string, input: UpdateDeviceInput): DeviceMetadata | null {
    const existing = this.repository.getMetadata(deviceId);
    if (!existing) {
      return null;
    }
    const metadata: DeviceMetadata = {
      ...existing,
      ...input,
      deviceId,
      updatedAt: new Date().toISOString(),
    };
    this.repository.upsertMetadata(metadata);
    return metadata;
  }

  upsertFromSocket(deviceId: string, input: SocketMetadataInput): { metadata: DeviceMetadata; updated: boolean } {
    const existing = this.repository.getMetadata(deviceId);
    const normalized = this.normalizeSocketMetadata(input);

    if (!existing) {
      return {
        metadata: this.register({
          deviceId,
          ...normalized,
        }),
        updated: true,
      };
    }

    const next: DeviceMetadata = {
      ...existing,
      ...normalized,
      deviceId,
      updatedAt: new Date().toISOString(),
    };

    const hasChanged =
      next.uuid !== existing.uuid ||
      next.name !== existing.name ||
      next.site !== existing.site ||
      next.zone !== existing.zone ||
      next.firmwareVersion !== existing.firmwareVersion ||
      next.sensorVersion !== existing.sensorVersion ||
      next.notes !== existing.notes;

    if (!hasChanged) {
      return { metadata: existing, updated: false };
    }

    this.repository.upsertMetadata(next);
    return { metadata: next, updated: true };
  }

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.repository.getMetadata(deviceId);
  }

  connect(deviceId: string, socketId: string, clientIp?: string): DeviceSession {
    if (!this.repository.getMetadata(deviceId)) {
      this.register({ deviceId });
    }
    const now = new Date().toISOString();
    const session: DeviceSession = {
      deviceId,
      socketId,
      clientIp,
      connectedAt: now,
      lastHeartbeatAt: now,
    };
    this.repository.upsertSession(session);
    return session;
  }

  heartbeat(deviceId: string, heartbeat?: DeviceHeartbeat): DeviceSession | null {
    return this.repository.touch(deviceId, new Date().toISOString(), this.normalizeHeartbeat(heartbeat));
  }

  disconnect(deviceId: string, socketId: string): boolean {
    return this.repository.removeIfSocketMatches(deviceId, socketId);
  }

  get(deviceId: string): DeviceSession | null {
    return this.repository.getSession(deviceId);
  }

  list(filters: DeviceListFilters = {}): DeviceListItem[] {
    const sessionMap = new Map(this.repository.listSessions().map((session) => [session.deviceId, session]));
    const metadata = this.repository.listMetadata();
    const merged: DeviceListItem[] = metadata.map((item) => {
      const session = sessionMap.get(item.deviceId);
      return {
        deviceId: item.deviceId,
        online: Boolean(session),
        socketId: session?.socketId,
        clientIp: session?.clientIp,
        connectedAt: session?.connectedAt,
        lastHeartbeatAt: session?.lastHeartbeatAt,
        heartbeat: session?.heartbeat,
        metadata: item,
      };
    });

    for (const session of this.repository.listSessions()) {
      if (!merged.find((item) => item.deviceId === session.deviceId)) {
        merged.push({
          deviceId: session.deviceId,
          online: true,
          socketId: session.socketId,
          clientIp: session.clientIp,
          connectedAt: session.connectedAt,
          lastHeartbeatAt: session.lastHeartbeatAt,
          heartbeat: session.heartbeat,
        });
      }
    }

    return merged.filter((item) => this.matchesFilters(item, filters));
  }

  isConnected(deviceId: string): boolean {
    return this.repository.isConnected(deviceId);
  }

  countConnected(): number {
    return this.repository.countConnected();
  }

  private matchesFilters(item: DeviceListItem, filters: DeviceListFilters): boolean {
    if (filters.status === 'online' && !item.online) {
      return false;
    }

    if (filters.status === 'offline' && item.online) {
      return false;
    }

    if (filters.site && this.normalizeText(item.metadata?.site) !== this.normalizeText(filters.site)) {
      return false;
    }

    if (filters.zone && this.normalizeText(item.metadata?.zone) !== this.normalizeText(filters.zone)) {
      return false;
    }

    if (filters.search && !this.matchesSearch(item, filters.search)) {
      return false;
    }

    return true;
  }

  private matchesSearch(item: DeviceListItem, search: string): boolean {
    const needle = this.normalizeText(search);
    if (!needle) {
      return true;
    }

    const haystack = [
      item.deviceId,
      item.socketId,
      item.connectedAt,
      item.lastHeartbeatAt,
      item.metadata?.name,
      item.metadata?.uuid,
      item.metadata?.site,
      item.metadata?.zone,
      item.metadata?.firmwareVersion,
      item.metadata?.sensorVersion,
      item.metadata?.notes,
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
      .join(' ');

    return haystack.includes(needle);
  }

  private normalizeText(value?: string): string | undefined {
    const normalized = value?.trim().toLowerCase();
    return normalized ? normalized : undefined;
  }

  private normalizeSocketMetadata(input: SocketMetadataInput): UpdateDeviceInput {
    const normalized: UpdateDeviceInput = {};

    const uuid = this.normalizeOptionalText(input.uuid);
    if (uuid !== undefined) {
      normalized.uuid = uuid;
    }

    const name = this.normalizeOptionalText(input.name);
    if (name !== undefined) {
      normalized.name = name;
    }

    const site = this.normalizeOptionalText(input.site);
    if (site !== undefined) {
      normalized.site = site;
    }

    const zone = this.normalizeOptionalText(input.zone);
    if (zone !== undefined) {
      normalized.zone = zone;
    }

    const firmwareVersion = this.normalizeOptionalText(input.firmwareVersion);
    if (firmwareVersion !== undefined) {
      normalized.firmwareVersion = firmwareVersion;
    }

    const sensorVersion = this.normalizeOptionalText(input.sensorVersion);
    if (sensorVersion !== undefined) {
      normalized.sensorVersion = sensorVersion;
    }

    const notes = this.normalizeOptionalText(input.notes);
    if (notes !== undefined) {
      normalized.notes = notes;
    }

    return normalized;
  }

  private normalizeOptionalText(value?: string): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const normalized = value.trim();
    return normalized ? normalized : undefined;
  }

  private normalizeHeartbeat(heartbeat?: DeviceHeartbeat): DeviceHeartbeat | undefined {
    if (!heartbeat) {
      return undefined;
    }

    const normalized: DeviceHeartbeat = {};

    if (heartbeat.socketConnected !== undefined) {
      normalized.socketConnected = Boolean(heartbeat.socketConnected);
    }

    if (heartbeat.staConnected !== undefined) {
      normalized.staConnected = Boolean(heartbeat.staConnected);
    }

    if (typeof heartbeat.signal === 'number' && Number.isFinite(heartbeat.signal)) {
      normalized.signal = Math.trunc(heartbeat.signal);
    }

    if (typeof heartbeat.uptimeSec === 'number' && Number.isFinite(heartbeat.uptimeSec) && heartbeat.uptimeSec >= 0) {
      normalized.uptimeSec = Math.trunc(heartbeat.uptimeSec);
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }
}
