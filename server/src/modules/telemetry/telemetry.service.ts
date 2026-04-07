import { z } from 'zod';
import type { TelemetryPayload, TelemetryMessage } from '../../shared/types.js';
import type {
  TelemetryHistoryQuery,
  TelemetryHistoryResult,
  TelemetryRepository,
} from './telemetry.repository.js';
import { DeviceService } from '../device/device.service.js';

const telemetrySchema = z.object({
  vibration: z.number().optional(),
  temperature: z.number().optional(),
}).passthrough();

export class TelemetryService {
  constructor(
    private readonly repository: TelemetryRepository,
    private readonly deviceService: DeviceService,
  ) {}

  ingest(deviceId: string, rawPayload: unknown): TelemetryMessage {
    const payload: TelemetryPayload = telemetrySchema.parse(rawPayload);
    const message: TelemetryMessage = {
      deviceId,
      receivedAt: new Date().toISOString(),
      payload,
    };

    this.deviceService.heartbeat(deviceId);
    this.repository.setLast(message);
    return message;
  }

  getLast(): TelemetryMessage | null {
    return this.repository.getLast();
  }

  async listHistory(query: TelemetryHistoryQuery): Promise<TelemetryHistoryResult> {
    return await this.repository.listHistory(query);
  }

  async applyRetention(): Promise<{ removed: number; kept: number; cutoffAt: string } | null> {
    return await this.repository.applyRetention();
  }
}
