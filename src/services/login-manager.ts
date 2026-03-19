/**
 * LoginManager — browser-based OAuth login using Electron BrowserWindow.
 *
 * Provides browser-based authentication as an alternative to API keys.
 * Opens a BrowserWindow for the user to authenticate with LLM provider
 * services, then captures session cookies/tokens for reuse via CredentialManager.
 *
 * Services supported: Anthropic, GitHub
 */

import crypto from 'crypto';
import { BrowserWindow } from 'electron';
import type { CredentialManager, CredentialService } from './credential-manager';

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
  github: 'https://github.com/login',
  'claude-code': 'https://claude.ai/login',
};

// Default cookie domains per service
const SERVICE_COOKIE_DOMAINS: Record<string, string> = {
  anthropic: '.anthropic.com',
  github: '.github.com',
  'claude-code': '.claude.ai',
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
   * @param service - Service identifier (e.g. 'anthropic', 'github')
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
              `${SESSION_KEY_PREFIX}${service}` as unknown as CredentialService,
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

  /**
   * Open a browser login window and complete the Claude Code OAuth PKCE flow.
   *
   * Uses the same OAuth client as the Claude Code CLI to obtain real access and
   * refresh tokens. The tokens are stored under 'anthropic_session' in the
   * credential manager in the same format Claude Code writes to
   * ~/.claude/.credentials.json, so loop-handlers can inject them directly into
   * containers.
   *
   * @returns Promise resolving to LoginResult
   */
  async openClaudeCodeLoginSession(): Promise<LoginResult> {
    // Claude Code CLI OAuth application constants
    const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
    const AUTH_URL = 'https://claude.ai/oauth/authorize';
    const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
    const SCOPES = 'user:inference user:mcp_servers user:profile user:sessions:claude_code';
    const timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS;

    // PKCE parameters
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    // Use a random high port for the redirect URI; we intercept with will-navigate/will-redirect
    // before Electron actually tries to connect, so no server needs to listen there.
    const port = Math.floor(Math.random() * 40000) + 10000;
    const redirectUri = `http://localhost:${port}/callback`;

    return new Promise<LoginResult>((resolve) => {
      let resolved = false;

      const loginWindow = new BrowserWindow({
        width: 900,
        height: 700,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          partition: 'persist:login-claude-code',
        },
        title: 'Login to Claude',
      });

      const resolveOnce = (result: LoginResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        if (!loginWindow.isDestroyed()) loginWindow.close();
        resolve(result);
      };

      const timeoutId = setTimeout(() => {
        resolveOnce({ success: false, service: 'claude-code', error: `Login timed out after ${timeoutMs}ms` });
      }, timeoutMs);

      // Handle the OAuth callback URL after interception
      const handleCallbackUrl = async (url: string) => {
        try {
          const parsed = new URL(url);
          const error = parsed.searchParams.get('error');
          if (error) {
            resolveOnce({ success: false, service: 'claude-code', error: `OAuth error: ${error}` });
            return;
          }

          const code = parsed.searchParams.get('code');
          const returnedState = parsed.searchParams.get('state');
          if (!code || returnedState !== state) {
            resolveOnce({ success: false, service: 'claude-code', error: 'Invalid OAuth callback: missing code or state mismatch' });
            return;
          }

          // Exchange authorization code for tokens
          const tokenResponse = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              client_id: CLIENT_ID,
              code_verifier: codeVerifier,
              state,
            }),
          });

          if (!tokenResponse.ok) {
            const errText = await tokenResponse.text();
            resolveOnce({ success: false, service: 'claude-code', error: `Token exchange failed: ${errText}` });
            return;
          }

          const tokens = await tokenResponse.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
            scope?: string;
            subscription_type?: string;
            rate_limit_tier?: string;
          };

          // Store in ~/.claude/.credentials.json format so containers can use it directly
          const credentialsData = JSON.stringify({
            claudeAiOauth: {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token ?? '',
              expiresAt: tokens.expires_in
                ? Date.now() + tokens.expires_in * 1000
                : Date.now() + 24 * 60 * 60 * 1000,
              scopes: tokens.scope ? tokens.scope.split(' ') : SCOPES.split(' '),
              subscriptionType: tokens.subscription_type ?? 'pro',
              rateLimitTier: tokens.rate_limit_tier ?? 'default_claude_ai',
            },
          });

          await this.credentialManager.storeApiKey('anthropic_session', credentialsData);
          resolveOnce({ success: true, service: 'claude-code' });
        } catch (err) {
          resolveOnce({
            success: false,
            service: 'claude-code',
            error: `Auth failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      };

      // Intercept client-side navigation to the localhost callback URL
      loginWindow.webContents.on('will-navigate', (event, url) => {
        if (url.includes(`localhost:${port}`)) {
          event.preventDefault();
          void handleCallbackUrl(url);
        }
      });

      // Also intercept server-side (HTTP 3xx) redirects to localhost
      loginWindow.webContents.on('will-redirect', (event, url) => {
        if (url.includes(`localhost:${port}`)) {
          event.preventDefault();
          void handleCallbackUrl(url);
        }
      });

      loginWindow.on('closed', () => {
        resolveOnce({ success: false, service: 'claude-code', error: 'Login window closed by user' });
      });

      const authParams = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      });

      loginWindow.loadURL(`${AUTH_URL}?${authParams.toString()}`).catch((err) => {
        resolveOnce({
          success: false,
          service: 'claude-code',
          error: `Failed to load login URL: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    });
  }
}
