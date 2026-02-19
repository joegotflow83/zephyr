/**
 * Unit tests for logging service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setupLogging,
  getLogger,
  setLogLevel,
  getLogLevel,
  getLogDir,
  type LogLevel,
  type Subsystem,
} from '../../src/services/logging';
import log from 'electron-log';
import { app } from 'electron';

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    transports: {
      file: {
        level: 'info',
        resolvePathFn: vi.fn(),
        maxSize: 0,
        format: '',
      },
      console: {
        level: 'info',
        format: '',
      },
    },
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
    silly: vi.fn(),
  },
}));

// Mock electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'logs') return '/mock/logs';
      return '/mock';
    }),
  },
}));

describe('Logging Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset log levels
    log.transports.file.level = 'info';
    log.transports.console.level = 'info';
  });

  describe('setupLogging', () => {
    it('should configure logging with default level', () => {
      setupLogging();

      expect(log.transports.file.level).toBe('info');
      expect(log.transports.console.level).toBe('info');
      expect(log.info).toHaveBeenCalledWith(
        '[main] Logging initialized',
        expect.objectContaining({ level: 'info' })
      );
    });

    it('should configure logging with custom level', () => {
      setupLogging('debug');

      expect(log.transports.file.level).toBe('debug');
      expect(log.transports.console.level).toBe('debug');
      expect(log.info).toHaveBeenCalledWith(
        '[main] Logging initialized',
        expect.objectContaining({ level: 'debug' })
      );
    });

    it('should configure logging with custom log directory', () => {
      const customDir = '/custom/logs';
      setupLogging('info', customDir);

      expect(log.transports.file.resolvePathFn).toBeDefined();
      const resolvedPath = (log.transports.file.resolvePathFn as () => string)();
      expect(resolvedPath).toContain('zephyr.log');
    });

    it('should set file rotation max size to 10 MB', () => {
      setupLogging();

      expect(log.transports.file.maxSize).toBe(10 * 1024 * 1024);
    });

    it('should configure console format', () => {
      setupLogging();

      expect(log.transports.console.format).toBeDefined();
      expect(log.transports.console.format).toContain('[{level}]');
    });

    it('should configure file format', () => {
      setupLogging();

      expect(log.transports.file.format).toBeDefined();
      expect(log.transports.file.format).toContain('[{level}]');
    });

    it('should support all log levels', () => {
      const levels: LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];

      levels.forEach((level) => {
        vi.clearAllMocks();
        setupLogging(level);
        expect(log.transports.file.level).toBe(level);
      });
    });
  });

  describe('getLogger', () => {
    const subsystems: Subsystem[] = ['docker', 'loop', 'terminal', 'ui', 'main', 'ipc'];

    beforeEach(() => {
      setupLogging();
      vi.clearAllMocks();
    });

    it('should return a logger for each subsystem', () => {
      subsystems.forEach((subsystem) => {
        const logger = getLogger(subsystem);
        expect(logger).toBeDefined();
        expect(logger.info).toBeDefined();
        expect(logger.error).toBeDefined();
        expect(logger.warn).toBeDefined();
      });
    });

    it('should cache loggers for reuse', () => {
      const logger1 = getLogger('docker');
      const logger2 = getLogger('docker');

      expect(logger1).toBe(logger2);
    });

    it('should prefix messages with subsystem name', () => {
      const dockerLogger = getLogger('docker');
      dockerLogger.info('Test message');

      expect(log.info).toHaveBeenCalledWith('[docker] Test message');
    });

    it('should support error level', () => {
      const logger = getLogger('docker');
      logger.error('Error message', { code: 123 });

      expect(log.error).toHaveBeenCalledWith('[docker] Error message', { code: 123 });
    });

    it('should support warn level', () => {
      const logger = getLogger('loop');
      logger.warn('Warning message');

      expect(log.warn).toHaveBeenCalledWith('[loop] Warning message');
    });

    it('should support info level', () => {
      const logger = getLogger('terminal');
      logger.info('Info message');

      expect(log.info).toHaveBeenCalledWith('[terminal] Info message');
    });

    it('should support verbose level', () => {
      const logger = getLogger('ui');
      logger.verbose('Verbose message');

      expect(log.verbose).toHaveBeenCalledWith('[ui] Verbose message');
    });

    it('should support debug level', () => {
      const logger = getLogger('main');
      logger.debug('Debug message');

      expect(log.debug).toHaveBeenCalledWith('[main] Debug message');
    });

    it('should support silly level', () => {
      const logger = getLogger('ipc');
      logger.silly('Silly message');

      expect(log.silly).toHaveBeenCalledWith('[ipc] Silly message');
    });

    it('should pass additional arguments to log methods', () => {
      const logger = getLogger('docker');
      const metadata = { containerId: 'abc123', status: 'running' };
      logger.info('Container started', metadata);

      expect(log.info).toHaveBeenCalledWith('[docker] Container started', metadata);
    });

    it('should handle multiple arguments', () => {
      const logger = getLogger('loop');
      logger.error('Failed to start', 'reason', 404, { details: 'not found' });

      expect(log.error).toHaveBeenCalledWith(
        '[loop] Failed to start',
        'reason',
        404,
        { details: 'not found' }
      );
    });
  });

  describe('setLogLevel', () => {
    beforeEach(() => {
      setupLogging('info');
      vi.clearAllMocks();
    });

    it('should change log level for both file and console', () => {
      setLogLevel('debug');

      expect(log.transports.file.level).toBe('debug');
      expect(log.transports.console.level).toBe('debug');
    });

    it('should log the level change', () => {
      setLogLevel('error');

      expect(log.info).toHaveBeenCalledWith('[main] Log level changed', { level: 'error' });
    });

    it('should support changing to all log levels', () => {
      const levels: LogLevel[] = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'];

      levels.forEach((level) => {
        vi.clearAllMocks();
        setLogLevel(level);
        expect(log.transports.file.level).toBe(level);
        expect(log.transports.console.level).toBe(level);
      });
    });
  });

  describe('getLogLevel', () => {
    it('should return current log level', () => {
      setupLogging('info');
      expect(getLogLevel()).toBe('info');
    });

    it('should reflect changes from setLogLevel', () => {
      setupLogging('info');
      setLogLevel('debug');
      expect(getLogLevel()).toBe('debug');
    });

    it('should return info as default when not set', () => {
      log.transports.file.level = undefined as unknown as string;
      expect(getLogLevel()).toBe('info');
    });
  });

  describe('getLogDir', () => {
    it('should return app logs path when app is available', () => {
      const logDir = getLogDir();
      expect(logDir).toBe('/mock/logs');
      expect(app.getPath).toHaveBeenCalledWith('logs');
    });
  });

  describe('integration scenarios', () => {
    it('should support multiple subsystems logging at different levels', () => {
      setupLogging('info');
      vi.clearAllMocks();

      const dockerLogger = getLogger('docker');
      const loopLogger = getLogger('loop');
      const uiLogger = getLogger('ui');

      dockerLogger.info('Docker connected');
      loopLogger.warn('Loop slow');
      uiLogger.error('UI crashed');

      expect(log.info).toHaveBeenCalledWith('[docker] Docker connected');
      expect(log.warn).toHaveBeenCalledWith('[loop] Loop slow');
      expect(log.error).toHaveBeenCalledWith('[ui] UI crashed');
    });

    it('should clear logger cache when reconfiguring', () => {
      setupLogging('info');
      const logger1 = getLogger('docker');

      // Reconfigure
      setupLogging('debug');
      const logger2 = getLogger('docker');

      // Cache is cleared during setupLogging, so we get a new instance
      expect(logger1).not.toBe(logger2);
    });

    it('should support runtime log level changes affecting all subsystems', () => {
      setupLogging('info');
      vi.clearAllMocks();

      setLogLevel('debug');

      const logger = getLogger('docker');
      logger.debug('Debug message');

      // Message should be logged since level is now debug
      expect(log.debug).toHaveBeenCalledWith('[docker] Debug message');
    });
  });
});
