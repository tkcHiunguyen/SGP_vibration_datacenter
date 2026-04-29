import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  OTA_PUBLIC_BASE_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),
  DATABASE_URL: z.string().optional(),
  MYSQL_URL: z.string().optional(),
  MYSQL_HOST: z.string().optional(),
  MYSQL_PORT: z.coerce.number().int().positive().optional(),
  MYSQL_USER: z.string().optional(),
  MYSQL_PASSWORD: z.string().optional(),
  MYSQL_DATABASE: z.string().optional(),
  MYSQL_CONNECTION_LIMIT: z.coerce.number().int().positive().default(10),
  DB_AUTO_INIT: z.coerce.boolean().default(true),
  DB_FALLBACK_ON_UNAVAILABLE: envBoolean.default(true),
  DEVICE_AUTH_TOKEN: z.string().optional(),
  AUTH_DEFAULT_ROLE: z.enum(['admin', 'approver', 'release_manager', 'operator', 'viewer']).default('viewer'),
  AUTH_STATIC_TOKENS: z.string().optional(),
  AUTH_ADMIN_TOKEN: z.string().default('admin-local-key'),
  AUTH_APPROVER_TOKEN: z.string().default('approver-local-key'),
  AUTH_RELEASE_MANAGER_TOKEN: z.string().default('release-manager-local-key'),
  AUTH_OPERATOR_TOKEN: z.string().default('operator-local-key'),
  AUTH_VIEWER_TOKEN: z.string().default('viewer-local-key'),
  AUTH_BYPASS_GATING: envBoolean.default(true),
  GOVERNANCE_HIGH_RISK_TARGET_COUNT: z.coerce.number().int().positive().default(200),
  GOVERNANCE_APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  COMMAND_TIMEOUT_SWEEP_MS: z.coerce.number().int().positive().default(1000),
  TELEMETRY_DEDUPE_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  TELEMETRY_MAX_PER_DEVICE_PER_MINUTE: z.coerce.number().int().positive().default(600),
  TELEMETRY_MAX_GLOBAL_PER_MINUTE: z.coerce.number().int().positive().default(50000),
  TELEMETRY_RETENTION_HOURS: z.coerce.number().positive().default(168),
  SPECTRUM_STORAGE_DIR: z.string().default('storage/spectrum'),
  SPECTRUM_FRAME_FLUSH_MS: z.coerce.number().int().positive().default(700),
  SPECTRUM_MATCH_WINDOW_MS: z.coerce.number().int().positive().default(500),
});

export const env = envSchema.parse(process.env);
