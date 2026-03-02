/**
 * Server-only logger. Used so the server bundle does not pull in lib/logger.ts
 * (which uses __DEV__ and Crashlytics and can break esbuild).
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;
type LogLevel = (typeof LEVELS)[number];

function resolveLevel(): LogLevel {
  const env = process.env?.LOG_LEVEL;
  if (env && LEVELS.includes(env as LogLevel)) return env as LogLevel;
  return process.env?.NODE_ENV === "production" ? "warn" : "debug";
}

export interface NamespacedLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, errorOrData?: unknown, data?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): NamespacedLogger {
  const level = resolveLevel();
  const prefix = `[${namespace}]`;

  function shouldLog(msgLevel: LogLevel): boolean {
    return LEVELS.indexOf(msgLevel) >= LEVELS.indexOf(level);
  }

  function emit(
    lvl: LogLevel,
    fn: (...a: unknown[]) => void,
    message: string,
    a?: unknown,
    b?: Record<string, unknown>,
  ): void {
    if (!shouldLog(lvl)) return;
    const label = `${prefix} ${message}`;
    if (a !== undefined && b !== undefined) fn(label, a, b);
    else if (a !== undefined) fn(label, a);
    else fn(label);
  }

  return {
    debug: (msg, data) => emit("debug", console.debug, msg, data),
    info: (msg, data) => emit("info", console.info, msg, data),
    warn: (msg, data) => emit("warn", console.warn, msg, data),
    error: (msg, errorOrData?, data?) => emit("error", console.error, msg, errorOrData, data),
  };
}
