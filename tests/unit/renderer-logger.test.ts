import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../../src/renderer/utils/logger';

describe('renderer logger', () => {
  const originalApi = (globalThis.window as unknown as { api?: unknown }).api;

  afterEach(() => {
    (globalThis.window as unknown as { api?: unknown }).api = originalApi;
  });

  describe('with window.api present', () => {
    let write: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      write = vi.fn();
      (globalThis.window as unknown as { api: { logs: { write: typeof write } } }).api = {
        logs: { write },
      };
    });

    it('forwards error() with level "error"', () => {
      logger.error('boom', { detail: 1 });
      expect(write).toHaveBeenCalledWith('error', 'boom', { detail: 1 });
    });

    it('forwards warn() with level "warn"', () => {
      logger.warn('careful');
      expect(write).toHaveBeenCalledWith('warn', 'careful');
    });

    it('forwards info() with level "info"', () => {
      logger.info('fyi');
      expect(write).toHaveBeenCalledWith('info', 'fyi');
    });

    it('forwards debug() with level "debug"', () => {
      logger.debug('trace', 1, 2);
      expect(write).toHaveBeenCalledWith('debug', 'trace', 1, 2);
    });
  });

  describe('with window.api absent', () => {
    beforeEach(() => {
      (globalThis.window as unknown as { api?: unknown }).api = undefined;
    });

    it('is a silent no-op for every level', () => {
      expect(() => {
        logger.error('boom');
        logger.warn('careful');
        logger.info('fyi');
        logger.debug('trace');
      }).not.toThrow();
    });
  });
});
