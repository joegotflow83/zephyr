/**
 * Logging service for structured logging across the application.
 * Uses electron-log for file rotation and console output.
 */

import log from 'electron-log';
import path from 'path';
import { app } from 'electron';

export type LogLevel = 'error' | 'warn' | 'info' | 'verbose' | 'debug' | 'silly';
export type Subsystem = 'docker' | 'loop' | 'terminal' | 'ui' | 'main' | 'ipc' | 'updater' | 'cleanup';

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  verbose(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  silly(message: string, ...args: unknown[]): void;
}

/**
 * Subsystem-specific logger that prefixes all messages with [subsystem]
 */
class SubsystemLogger implements Logger {
  constructor(
    private subsystem: Subsystem,
    private baseLogger: typeof log
  ) {}

  error(message: string, ...args: unknown[]): void {
    this.baseLogger.error(`[${this.subsystem}] ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.baseLogger.warn(`[${this.subsystem}] ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.baseLogger.info(`[${this.subsystem}] ${message}`, ...args);
  }

  verbose(message: string, ...args: unknown[]): void {
    this.baseLogger.verbose(`[${this.subsystem}] ${message}`, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.baseLogger.debug(`[${this.subsystem}] ${message}`, ...args);
  }

  silly(message: string, ...args: unknown[]): void {
    this.baseLogger.silly(`[${this.subsystem}] ${message}`, ...args);
  }
}

// Cache for subsystem loggers
const subsystemLoggers = new Map<Subsystem, Logger>();

/**
 * Configure logging for the application.
 * Sets up file rotation and console output.
 *
 * @param level - Log level (error, warn, info, verbose, debug, silly)
 * @param logDir - Optional custom log directory (defaults to app logs path)
 */
export function setupLogging(level: LogLevel = 'info', logDir?: string): void {
  // Set log level
  log.transports.file.level = level;
  log.transports.console.level = level;

  // Configure file transport with rotation
  const logsPath = logDir || (app ? app.getPath('logs') : path.join(process.cwd(), 'logs'));
  log.transports.file.resolvePathFn = () => path.join(logsPath, 'zephyr.log');
  log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB

  // electron-log doesn't directly support backup count, but it auto-rotates
  // Files are named zephyr.log, zephyr.old.log, etc.
  // We'll implement manual cleanup for old files

  // Configure console transport with colors
  log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // Set default format for file transport
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // Clear subsystem logger cache when reconfiguring
  subsystemLoggers.clear();

  log.info('[main] Logging initialized', { level, logsPath });
}

/**
 * Get a logger for a specific subsystem.
 * Loggers are cached and reused.
 *
 * @param subsystem - The subsystem identifier (docker, loop, terminal, ui, main, ipc)
 * @returns A logger instance for the subsystem
 */
export function getLogger(subsystem: Subsystem): Logger {
  if (!subsystemLoggers.has(subsystem)) {
    subsystemLoggers.set(subsystem, new SubsystemLogger(subsystem, log));
  }
  return subsystemLoggers.get(subsystem)!;
}

/**
 * Change the log level at runtime.
 * Affects both file and console transports.
 *
 * @param level - New log level
 */
export function setLogLevel(level: LogLevel): void {
  log.transports.file.level = level;
  log.transports.console.level = level;
  log.info('[main] Log level changed', { level });
}

/**
 * Get the current log level.
 *
 * @returns Current log level
 */
export function getLogLevel(): LogLevel {
  return (log.transports.file.level || 'info') as LogLevel;
}

/**
 * Get the path to the log directory.
 *
 * @returns Absolute path to log directory
 */
export function getLogDir(): string {
  if (app) {
    return app.getPath('logs');
  }
  return path.join(process.cwd(), 'logs');
}

// Export the base logger for direct use if needed
export { log as baseLogger };
