type TelemetryIngressGuardOptions = {
  dedupeWindowMs: number;
  maxPerDevicePerMinute: number;
  maxGlobalPerMinute: number;
};

type TelemetryIngressDecision =
  | {
      accepted: true;
      duplicate: false;
      rateLimited: false;
      eventKey?: string;
    }
  | {
      accepted: false;
      duplicate: boolean;
      rateLimited: boolean;
      reason: 'duplicate' | 'rate_limited_device' | 'rate_limited_global';
      eventKey?: string;
    };

type TelemetryPayloadWithKey = Record<string, unknown> & {
  messageId?: string;
  sequence?: string | number;
  seq?: string | number;
};

export class TelemetryIngressGuard {
  private readonly seenKeys = new Map<string, number>();

  private readonly deviceTimestamps = new Map<string, number[]>();

  private readonly globalTimestamps: number[] = [];

  constructor(private readonly options: TelemetryIngressGuardOptions) {}

  evaluate(deviceId: string, rawPayload: unknown, now = Date.now()): TelemetryIngressDecision {
    this.prune(now);

    const eventKey = this.extractEventKey(deviceId, rawPayload);
    if (eventKey) {
      const seenAt = this.seenKeys.get(eventKey);
      if (seenAt !== undefined && now - seenAt <= this.options.dedupeWindowMs) {
        return {
          accepted: false,
          duplicate: true,
          rateLimited: false,
          reason: 'duplicate',
          eventKey,
        };
      }
    }

    const deviceEvents = this.deviceTimestamps.get(deviceId) ?? [];
    if (deviceEvents.length >= this.options.maxPerDevicePerMinute) {
      return {
        accepted: false,
        duplicate: false,
        rateLimited: true,
        reason: 'rate_limited_device',
        eventKey,
      };
    }

    if (this.globalTimestamps.length >= this.options.maxGlobalPerMinute) {
      return {
        accepted: false,
        duplicate: false,
        rateLimited: true,
        reason: 'rate_limited_global',
        eventKey,
      };
    }

    deviceEvents.push(now);
    this.deviceTimestamps.set(deviceId, deviceEvents);
    this.globalTimestamps.push(now);

    if (eventKey) {
      this.seenKeys.set(eventKey, now);
    }

    return {
      accepted: true,
      duplicate: false,
      rateLimited: false,
      eventKey,
    };
  }

  private extractEventKey(deviceId: string, rawPayload: unknown): string | undefined {
    if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      return undefined;
    }

    const payload = rawPayload as TelemetryPayloadWithKey;
    const key = payload.messageId ?? payload.sequence ?? payload.seq;
    if (key === undefined || key === null) {
      return undefined;
    }

    const normalized = String(key).trim();
    if (!normalized) {
      return undefined;
    }

    return `${deviceId}:${normalized}`;
  }

  private prune(now: number): void {
    const minAllowed = now - 60_000;
    const minSeenAt = now - this.options.dedupeWindowMs;

    while (this.globalTimestamps.length && this.globalTimestamps[0] < minAllowed) {
      this.globalTimestamps.shift();
    }

    for (const [deviceId, timestamps] of this.deviceTimestamps.entries()) {
      while (timestamps.length && timestamps[0] < minAllowed) {
        timestamps.shift();
      }

      if (timestamps.length === 0) {
        this.deviceTimestamps.delete(deviceId);
      }
    }

    for (const [eventKey, seenAt] of this.seenKeys.entries()) {
      if (seenAt < minSeenAt) {
        this.seenKeys.delete(eventKey);
      }
    }
  }
}
