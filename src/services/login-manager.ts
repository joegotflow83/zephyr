/**
 * LoginManager — browser-based OAuth login using Electron BrowserWindow.
 *
 * Provides browser-based authentication as an alternative to API keys.
 * Opens a BrowserWindow for the user to authenticate with LLM provider
 * services, then captures session cookies/tokens for reuse via CredentialManager.
 *
 * Services supported: Anthropic, OpenAI
 */

import { BrowserWindow } from 'electron';
import type { CredentialManager } from './credential-manager';

export interface LoginResult {
  success: boolean;
  service: string;
  error?: string;
}

interface LoginSessionOptions {
  url?: string;
  cookieDomain?: string;
  timeoutMs?: number;
  width?: number;
  height?: number;
}

// Known service login URLs
const SERVICE_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/login',
  openai: 'https://platform.openai.com/login',
};

// Default cookie domains per service
const SERVICE_COOKIE_DOMAINS: Record<string, string> = {
  anthropic: '.anthropic.com',
  openai: '.openai.com',
};

// Session key prefix in credential manager (stored as JSON string)
const SESSION_KEY_PREFIX = 'session:';

// Default timeout for login (5 minutes)
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;

export class LoginManager {
  private credentialManager: CredentialManager;

  /**
   * @param credentialManager - CredentialManager for persisting session data
   */
  constructor(credentialManager: CredentialManager) {
    this.credentialManager = credentialManager;
  }

  /**
   * Open a login session for a service.
   *
   * Opens a new BrowserWindow to the service's login URL, waits for the user
   * to complete authentication, then extracts session cookies matching the
   * service's domain and stores them via CredentialManager.
   *
   * @param service - Service identifier (e.g. 'anthropic', 'openai')
   * @param options - Optional configuration for login session
   * @returns Promise resolving to LoginResult
   */
  async openLoginSession(
    service: string,
    options: LoginSessionOptions = {}
  ): Promise<LoginResult> {
    const loginUrl = options.url || SERVICE_URLS[service];
    if (!loginUrl) {
      return {
        success: false,
        service,
        error: `No login URL known for service '${service}'. Provide a URL explicitly.`,
      };
    }

    const cookieDomain = options.cookieDomain || SERVICE_COOKIE_DOMAINS[service] || '';
    const timeoutMs = options.timeoutMs || DEFAULT_LOGIN_TIMEOUT_MS;
    const width = options.width || 800;
    const height = options.height || 600;

    return new Promise<LoginResult>((resolve) => {
      // eslint-disable-next-line prefer-const
      let timeoutId: NodeJS.Timeout | undefined;
      let resolved = false;

      // Helper to resolve once
      const resolveOnce = (result: LoginResult) => {
        if (resolved) return;
        resolved = true;

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Close window if still open
        if (loginWindow && !loginWindow.isDestroyed()) {
          loginWindow.close();
        }

        resolve(result);
      };

      // Create login window
      const loginWindow = new BrowserWindow({
        width,
        height,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          // Allow third-party cookies for OAuth flows
          partition: `persist:login-${service}`,
        },
        title: `Login to ${service}`,
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        resolveOnce({
          success: false,
          service,
          error: `Login timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      // Track initial URL to detect navigation away from login page
      const initialUrl = loginUrl;

      // Listen for navigation events
      loginWindow.webContents.on('did-navigate', async (_, url) => {
        // Check if user navigated away from login page (indicates success)
        if (url !== initialUrl && !url.includes('/login')) {
          try {
            // Extract cookies from the session
            const cookies = await loginWindow.webContents.session.cookies.get({
              domain: cookieDomain || undefined,
            });

            // Filter cookies by domain if specified
            const filteredCookies = cookieDomain
              ? cookies.filter((c) => c.domain && c.domain.includes(cookieDomain))
              : cookies;

            if (filteredCookies.length === 0) {
              resolveOnce({
                success: false,
                service,
                error: `No cookies captured for domain '${cookieDomain}'`,
              });
              return;
            }

            // Store session data in credential manager as JSON
            const sessionData = JSON.stringify({
              service,
              cookies: filteredCookies.map((c) => ({
                name: c.name,
                value: c.value,
                domain: c.domain,
                path: c.path,
                secure: c.secure,
                httpOnly: c.httpOnly,
                expirationDate: c.expirationDate,
              })),
            });

            // Store using the session key prefix
            await this.credentialManager.storeApiKey(
              `${SESSION_KEY_PREFIX}${service}` as any,
              sessionData
            );

            resolveOnce({
              success: true,
              service,
            });
          } catch (err) {
            resolveOnce({
              success: false,
              service,
              error: `Failed to capture session: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
      });

      // Handle window close (user cancelled)
      loginWindow.on('closed', () => {
        resolveOnce({
          success: false,
          service,
          error: 'Login window closed by user',
        });
      });

      // Load the login URL
      loginWindow.loadURL(loginUrl).catch((err) => {
        resolveOnce({
          success: false,
          service,
          error: `Failed to load login URL: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    });
  }
}
