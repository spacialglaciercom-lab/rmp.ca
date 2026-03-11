/**
 * Centralized logging for TrashRoute.
 *
 * Usage:
 *   const log = createLogger("my-module");
 *   log.info("started", { count: 3 });
 *   log.error("failed", err);        // auto-fires Crashlytics on native
 *   log.error("failed", err, { id }); // with extra context
 *
 * Production level defaults to "warn". Override with LOG_LEVEL env var.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

// Dual-environment dev detection (mirrors lib/route-optimizer-v2/debug.ts)
const _isDev: boolean =
  typeof __DEV__ !== "undefined"
    ? __DEV__
    : typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

function _shouldLog(configLevel: LogLevel, msgLevel: LogLevel): boolean {
  return LEVELS.indexOf(msgLevel) >= LEVELS.indexOf(configLevel);
}

// Resolve level from LOG_LEVEL env var (server ops override) or dev/prod default
function _resolveLevel(): LogLevel {
  const env =
    typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined;
  if (env && LEVELS.includes(env as LogLevel)) return env as LogLevel;
  return _isDev ? "debug" : "warn";
}

// Crashlytics auto-wire — guarded; typeof __DEV__ guard avoids require() in Node.js
function _tryRecordCrashlytics(error: Error, namespace: string): void {
  if (typeof __DEV__ === "undefined") return; // server: skip
  try {
    const { recordErrorToCrashlytics } = require("./crashlytics-report");
    recordErrorToCrashlytics(error, namespace);
  } catch {
    // never throw from logging
  }
}

export interface NamespacedLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  // errorOrData: pass Error for Crashlytics wiring, or a plain data object
  error(
    message: string,
    errorOrData?: unknown,
    data?: Record<string, unknown>,
  ): void;
}

export function createLogger(namespace: string): NamespacedLogger {
  const level = _resolveLevel();
  const prefix = `[${namespace}]`;

  function _emit(
    lvl: LogLevel,
    fn: (...a: unknown[]) => void,
    message: string,
    a?: unknown,
    b?: Record<string, unknown>,
  ): void {
    if (!_shouldLog(level, lvl)) return;
    const label = `${prefix} ${message}`;
    if (a !== undefined && b !== undefined) fn(label, a, b);
    else if (a !== undefined) fn(label, a);
    else fn(label);
  }

  return {
    debug: (msg, data) => _emit("debug", console.debug, msg, data),
    info: (msg, data) => _emit("info", console.info, msg, data),
    warn: (msg, data) => _emit("warn", console.warn, msg, data),
    error(msg, errorOrData?, data?) {
      _emit("error", console.error, msg, errorOrData, data);
      if (errorOrData instanceof Error)
        _tryRecordCrashlytics(errorOrData, namespace);
    },
  };
}

// ── Backward-compat Logger class + singleton ──────────────────────────────────
interface LoggerConfig {
  enabled: boolean;
  level: LogLevel;
  includeTimestamp: boolean;
  includeContext: boolean;
}
const DEFAULT_CONFIG: LoggerConfig = {
  enabled: true,
  level: _resolveLevel(),
  includeTimestamp: true,
  includeContext: true,
};

export class Logger {
  private config: LoggerConfig;
  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  private shouldLog(l: LogLevel) {
    return this.config.enabled && _shouldLog(this.config.level, l);
  }
  private fmt(l: LogLevel, msg: string, ctx?: string) {
    const parts = [new Date().toISOString(), `[${l.toUpperCase()}]`];
    if (this.config.includeContext && ctx) parts.push(`[${ctx}]`);
    parts.push(msg);
    return parts.join(" ");
  }
  debug(msg: string, ctx?: string) {
    if (this.shouldLog("debug")) console.debug(this.fmt("debug", msg, ctx));
  }
  info(msg: string, ctx?: string) {
    if (this.shouldLog("info")) console.info(this.fmt("info", msg, ctx));
  }
  warn(msg: string, ctx?: string) {
    if (this.shouldLog("warn")) console.warn(this.fmt("warn", msg, ctx));
  }
  error(msg: string, err?: unknown, ctx?: string) {
    if (!this.shouldLog("error")) return;
    err !== undefined
      ? console.error(this.fmt("error", msg, ctx), err)
      : console.error(this.fmt("error", msg, ctx));
    if (err instanceof Error) _tryRecordCrashlytics(err, ctx ?? "app");
  }
  setConfig(c: Partial<LoggerConfig>) {
    this.config = { ...this.config, ...c };
  }
  getConfig(): LoggerConfig {
    return { ...this.config };
  }
}

export const logger = new Logger();
