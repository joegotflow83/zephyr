/**
 * Unit tests for LoginManager service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoginManager } from '../../src/services/login-manager';
import type { CredentialManager } from '../../src/services/credential-manager';

// Mock Electron BrowserWindow - using vi.hoisted for proper initialization
const { mockLoadURL, mockClose, mockIsDestroyed, mockOn, mockWebContentsOn, mockCookiesGet, MockBrowserWindow } = vi.hoisted(() => {
  const mockLoadURL = vi.fn();
  const mockClose = vi.fn();
  const mockIsDestroyed = vi.fn();
  const mockOn = vi.fn();
  const mockWebContentsOn = vi.fn();
  const mockCookiesGet = vi.fn();

  class MockBrowserWindow {
    loadURL = mockLoadURL;
    close = mockClose;
    isDestroyed = mockIsDestroyed;
    on = mockOn;
    webContents = {
      on: mockWebContentsOn,
      session: {
        cookies: {
          get: mockCookiesGet,
        },
      },
    };

    constructor(_options: any) {
      // Constructor does nothing
    }
  }

  return { mockLoadURL, mockClose, mockIsDestroyed, mockOn, mockWebContentsOn, mockCookiesGet, MockBrowserWindow };
});

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
}));

describe('LoginManager', () => {
  let loginManager: LoginManager;
  let mockCredentialManager: CredentialManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    mockLoadURL.mockResolvedValue(undefined);
    mockClose.mockImplementation(() => {});
    mockIsDestroyed.mockReturnValue(false);

    // Mock credential manager
    mockCredentialManager = {
      storeApiKey: vi.fn().mockResolvedValue(undefined),
      getApiKey: vi.fn().mockResolvedValue(null),
      deleteApiKey: vi.fn().mockResolvedValue(undefined),
      listStoredServices: vi.fn().mockResolvedValue([]),
    } as any;

    loginManager = new LoginManager(mockCredentialManager);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('openLoginSession', () => {
    describe('known services', () => {
      it('should use correct URL for Anthropic', async () => {
        // Start login
        const promise = loginManager.openLoginSession('anthropic');

        // Wait a tick for event handlers to be registered
        await new Promise(resolve => setImmediate(resolve));

        // Simulate user cancelling
        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        const result = await promise;

        expect(mockLoadURL).toHaveBeenCalledWith(
          'https://console.anthropic.com/login'
        );
        expect(result.success).toBe(false);
        expect(result.service).toBe('anthropic');
      });

      it('should use correct URL for GitHub', async () => {
        const promise = loginManager.openLoginSession('github');

        // Wait a tick for event handlers to be registered
        await new Promise(resolve => setImmediate(resolve));

        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        const result = await promise;

        expect(mockLoadURL).toHaveBeenCalledWith(
          'https://github.com/login'
        );
        expect(result.success).toBe(false);
        expect(result.service).toBe('github');
      });
    });

    describe('custom URL', () => {
      it('should use custom URL when provided', async () => {
        const promise = loginManager.openLoginSession('custom', {
          url: 'https://example.com/custom-login',
        });

        // Wait a tick for event handlers to be registered
        await new Promise(resolve => setImmediate(resolve));

        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        await promise;

        expect(mockLoadURL).toHaveBeenCalledWith(
          'https://example.com/custom-login'
        );
      });
    });

    describe('unknown service', () => {
      it('should return error for unknown service without URL', async () => {
        const result = await loginManager.openLoginSession('unknown');

        expect(result.success).toBe(false);
        expect(result.error).toContain('No login URL known');
        expect(result.service).toBe('unknown');
      });
    });

    describe('successful login', () => {
      it('should capture cookies on successful navigation', async () => {
        vi.useFakeTimers();

        const mockCookies = [
          {
            name: 'session_token',
            value: 'abc123',
            domain: '.anthropic.com',
            path: '/',
            secure: true,
            httpOnly: true,
            expirationDate: Date.now() / 1000 + 3600,
          },
          {
            name: 'refresh_token',
            value: 'def456',
            domain: '.anthropic.com',
            path: '/',
            secure: true,
            httpOnly: true,
            expirationDate: Date.now() / 1000 + 7200,
          },
        ];

        mockCookiesGet.mockResolvedValue(mockCookies);

        // Find the did-navigate handler
        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        // Simulate navigation to dashboard (success)
        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(true);
        expect(result.service).toBe('anthropic');
        expect(mockCredentialManager.storeApiKey).toHaveBeenCalledWith(
          'session:anthropic',
          expect.stringContaining('session_token')
        );

        // Verify stored data structure
        const storedData = (mockCredentialManager.storeApiKey as any).mock.calls[0][1];
        const parsed = JSON.parse(storedData);
        expect(parsed.service).toBe('anthropic');
        expect(parsed.cookies).toHaveLength(2);
        expect(parsed.cookies[0].name).toBe('session_token');

        vi.useRealTimers();
      });

      it('should filter cookies by domain', async () => {
        vi.useFakeTimers();

        const mockCookies = [
          {
            name: 'session',
            value: 'valid',
            domain: '.anthropic.com',
            path: '/',
            secure: true,
            httpOnly: true,
          },
          {
            name: 'tracking',
            value: 'invalid',
            domain: '.example.com',
            path: '/',
            secure: false,
            httpOnly: false,
          },
        ];

        mockCookiesGet.mockResolvedValue(mockCookies);

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(true);

        const storedData = (mockCredentialManager.storeApiKey as any).mock.calls[0][1];
        const parsed = JSON.parse(storedData);
        // Only the .anthropic.com cookie should be stored
        expect(parsed.cookies).toHaveLength(1);
        expect(parsed.cookies[0].domain).toBe('.anthropic.com');

        vi.useRealTimers();
      });

      it('should close window after successful login', async () => {
        vi.useFakeTimers();

        mockCookiesGet.mockResolvedValue([
          {
            name: 'session',
            value: 'token',
            domain: '.anthropic.com',
            path: '/',
          },
        ]);

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        await promise;

        expect(mockClose).toHaveBeenCalled();

        vi.useRealTimers();
      });
    });

    describe('user cancellation', () => {
      it('should return error when user closes window', async () => {
        const promise = loginManager.openLoginSession('anthropic');

        // Wait a tick for event handlers to be registered
        await new Promise(resolve => setImmediate(resolve));

        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('closed by user');
      });
    });

    describe('timeout', () => {
      it('should timeout if user takes too long', async () => {
        vi.useFakeTimers();

        const promise = loginManager.openLoginSession('anthropic', {
          timeoutMs: 1000,
        });

        // Fast-forward past timeout
        vi.advanceTimersByTime(1001);

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');

        vi.useRealTimers();
      });

      it('should clear timeout on success', async () => {
        vi.useFakeTimers();

        mockCookiesGet.mockResolvedValue([
          {
            name: 'session',
            value: 'token',
            domain: '.anthropic.com',
            path: '/',
          },
        ]);

        const promise = loginManager.openLoginSession('anthropic', {
          timeoutMs: 5000,
        });

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        // Succeed before timeout
        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(true);

        // Fast-forward past what would have been timeout
        vi.advanceTimersByTime(6000);

        // Should not trigger timeout error after success
        expect(mockClose).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
      });
    });

    describe('error handling', () => {
      it('should handle loadURL failure', async () => {
        mockLoadURL.mockRejectedValue(new Error('Network error'));

        const result = await loginManager.openLoginSession('anthropic');

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to load login URL');
        expect(result.error).toContain('Network error');
      });

      it('should handle cookie capture failure', async () => {
        vi.useFakeTimers();

        mockCookiesGet.mockRejectedValue(
          new Error('Cookie error')
        );

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to capture session');
        expect(result.error).toContain('Cookie error');

        vi.useRealTimers();
      });

      it('should handle credential storage failure', async () => {
        vi.useFakeTimers();

        mockCookiesGet.mockResolvedValue([
          {
            name: 'session',
            value: 'token',
            domain: '.anthropic.com',
            path: '/',
          },
        ]);

        (mockCredentialManager.storeApiKey as any).mockRejectedValue(
          new Error('Storage error')
        );

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to capture session');
        expect(result.error).toContain('Storage error');

        vi.useRealTimers();
      });

      it('should return error when no cookies captured', async () => {
        vi.useFakeTimers();

        // Return empty cookie list
        mockCookiesGet.mockResolvedValue([]);

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('No cookies captured');

        vi.useRealTimers();
      });
    });

    describe('navigation detection', () => {
      it('should not trigger on navigation to login URL itself', async () => {
        vi.useFakeTimers();

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        // Navigate to same login URL (should not trigger success)
        await navigateHandler?.(null, 'https://console.anthropic.com/login');

        // Should not have stored anything yet
        expect(mockCredentialManager.storeApiKey).not.toHaveBeenCalled();

        // Cancel to resolve promise
        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        await promise;

        vi.useRealTimers();
      });

      it('should not trigger on navigation to other login pages', async () => {
        vi.useFakeTimers();

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        // Navigate to another login URL (should not trigger success)
        await navigateHandler?.(null, 'https://console.anthropic.com/login/verify');

        // Should not have stored anything yet
        expect(mockCredentialManager.storeApiKey).not.toHaveBeenCalled();

        // Cancel to resolve promise
        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];
        closedHandler?.();

        await promise;

        vi.useRealTimers();
      });
    });

    describe('custom options', () => {
      it('should use custom cookie domain', async () => {
        vi.useFakeTimers();

        const mockCookies = [
          {
            name: 'session',
            value: 'token',
            domain: '.custom.com',
            path: '/',
          },
        ];

        mockCookiesGet.mockResolvedValue(mockCookies);

        const promise = loginManager.openLoginSession('custom', {
          url: 'https://custom.com/login',
          cookieDomain: '.custom.com',
        });

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];

        await navigateHandler?.(null, 'https://custom.com/dashboard');

        const result = await promise;

        expect(result.success).toBe(true);

        vi.useRealTimers();
      });

      it('should use custom timeout', async () => {
        vi.useFakeTimers();

        const promise = loginManager.openLoginSession('anthropic', {
          timeoutMs: 500,
        });

        vi.advanceTimersByTime(501);

        const result = await promise;

        expect(result.success).toBe(false);
        expect(result.error).toContain('500ms');

        vi.useRealTimers();
      });
    });

    describe('multiple resolution prevention', () => {
      it('should only resolve once even if multiple events fire', async () => {
        vi.useFakeTimers();

        mockCookiesGet.mockResolvedValue([
          {
            name: 'session',
            value: 'token',
            domain: '.anthropic.com',
            path: '/',
          },
        ]);

        const promise = loginManager.openLoginSession('anthropic');

        const navigateHandler = mockWebContentsOn.mock.calls.find(
          (call) => call[0] === 'did-navigate'
        )?.[1];
        const closedHandler = mockOn.mock.calls.find(
          (call) => call[0] === 'closed'
        )?.[1];

        // Trigger success
        await navigateHandler?.(null, 'https://console.anthropic.com/dashboard');

        // Try to trigger close after success (should be ignored)
        closedHandler?.();

        const result = await promise;

        // Should be success, not cancellation
        expect(result.success).toBe(true);

        // Should only close window once
        expect(mockClose).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
      });
    });
  });
});
