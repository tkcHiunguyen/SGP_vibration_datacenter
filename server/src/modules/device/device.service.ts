import type { DeviceRepository } from './device.repository.js';
import type { DeviceMetadata, DeviceSession } from '../../shared/types.js';

type RegisterDeviceInput = {
  deviceId: string;
  name?: string;
  site?: string;
  zone?: string;
  firmwareVersion?: string;
  sensorVersion?: string;
  notes?: string;
};

type UpdateDeviceInput = Omit<RegisterDeviceInput, 'deviceId'>;

export type DeviceListItem = {
  deviceId: string;
  online: boolean;
  socketId?: string;
  connectedAt?: string;
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

  getMetadata(deviceId: string): DeviceMetadata | null {
    return this.repository.getMetadata(deviceId);
  }

  connect(deviceId: string, socketId: string): DeviceSession {
    if (!this.repository.getMetadata(deviceId)) {
      this.register({ deviceId });
    }
    const session: DeviceSession = {
      deviceId,
      socketId,
      connectedAt: new Date().toISOString(),
    };
    this.repository.upsertSession(session);
    return session;
  }

  heartbeat(deviceId: string): void {
    this.repository.touch(deviceId, new Date().toISOString());
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
        connectedAt: session?.connectedAt,
        metadata: item,
      };
    });

    for (const session of this.repository.listSessions()) {
      if (!merged.find((item) => item.deviceId === session.deviceId)) {
        merged.push({
          deviceId: session.deviceId,
          online: true,
          socketId: session.socketId,
          connectedAt: session.connectedAt,
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
      item.metadata?.name,
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
}
