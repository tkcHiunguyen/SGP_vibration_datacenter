import type {
  StructuredLogContext,
  StructuredLogEvent,
  StructuredLogLevel,
} from './observability.types.js';

export type StructuredLogSink = Record<
  StructuredLogLevel,
  (payload: Record<string, unknown>, message: string) => void
>;

export type StructuredLogger = {
  debug(message: string, fields?: StructuredLogContext): void;
  info(message: string, fields?: StructuredLogContext): void;
  warn(message: string, fields?: StructuredLogContext): void;
  error(message: string, fields?: StructuredLogContext): void;
  child(fields: StructuredLogContext): StructuredLogger;
};

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function createStructuredEvent(
  event: string,
  message?: string,
  context: StructuredLogContext = {},
  level: StructuredLogLevel = 'info',
): StructuredLogEvent {
  return {
    event,
    message,
    level,
    timestamp: new Date().toISOString(),
    ...context,
  };
}

export function createStructuredLogger(
  sink: StructuredLogSink,
  context: StructuredLogContext = {},
): StructuredLogger {
  const emit = (level: StructuredLogLevel, message: string, fields: StructuredLogContext = {}) => {
    sink[level](
      {
        ...context,
        ...fields,
        timestamp: new Date().toISOString(),
      },
      message,
    );
  };

  return {
    debug(message, fields) {
      emit('debug', message, fields);
    },
    info(message, fields) {
      emit('info', message, fields);
    },
    warn(message, fields) {
      emit('warn', message, fields);
    },
    error(message, fields) {
      emit('error', message, fields);
    },
    child(fields) {
      return createStructuredLogger(sink, { ...context, ...fields });
    },
  };
}

