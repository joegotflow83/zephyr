// Renderer-side logger that forwards to the main process over IPC, landing in the
// same rotating zephyr.log file as main/service logs. See src/services/logging.ts
// for the shared Logger shape and src/main/ipc-handlers/log-handlers.ts for the
// receiving end.

type RendererLogLevel = 'error' | 'warn' | 'info' | 'debug';

interface RendererLogger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

function write(level: RendererLogLevel, message: string, ...args: unknown[]): void {
  if (typeof window === 'undefined' || !window.api) {
    return;
  }
  window.api.logs.write(level, message, ...args);
}

export const logger: RendererLogger = {
  error: (message, ...args) => write('error', message, ...args),
  warn: (message, ...args) => write('warn', message, ...args),
  info: (message, ...args) => write('info', message, ...args),
  debug: (message, ...args) => write('debug', message, ...args),
};
