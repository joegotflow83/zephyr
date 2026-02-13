"""Playwright-based login manager for Zephyr Desktop.

Provides browser-based authentication as an alternative to API keys.
Launches a Chromium browser window for the user to authenticate with
LLM provider services, then captures session cookies/tokens for reuse.
"""

import json
import logging
from typing import Callable, Optional

from playwright.sync_api import sync_playwright, BrowserContext, TimeoutError as PlaywrightTimeout

from src.lib.credential_manager import CredentialManager

logger = logging.getLogger(__name__)

# Known service login URLs
SERVICE_URLS: dict[str, str] = {
    "anthropic": "https://console.anthropic.com/login",
    "openai": "https://platform.openai.com/login",
}

# Default cookie domains per service
SERVICE_COOKIE_DOMAINS: dict[str, str] = {
    "anthropic": ".anthropic.com",
    "openai": ".openai.com",
}

# Session key prefix in credential manager
SESSION_KEY_PREFIX = "session:"

# Default timeout for login (5 minutes)
DEFAULT_LOGIN_TIMEOUT_MS = 300_000


class LoginManager:
    """Manages browser-based login flows using Playwright.

    Launches a Chromium browser for the user to authenticate with
    LLM provider services, captures session cookies, and stores
    them via CredentialManager.

    Args:
        credential_manager: CredentialManager for persisting session data.
        playwright_launcher: Optional callable that returns a Playwright
            context manager. Defaults to ``sync_playwright``. Useful for
            testing with mocks.
    """

    def __init__(
        self,
        credential_manager: CredentialManager,
        playwright_launcher: Optional[Callable] = None,
    ):
        self._credential_manager = credential_manager
        self._playwright_launcher = playwright_launcher or sync_playwright

    def launch_login(
        self,
        service: str,
        url: Optional[str] = None,
        cookie_domain: Optional[str] = None,
        timeout_ms: int = DEFAULT_LOGIN_TIMEOUT_MS,
    ) -> Optional[dict]:
        """Launch a browser for the user to authenticate.

        Opens a Chromium browser to the service's login URL, waits for
        the user to complete authentication, then extracts session
        cookies matching the service's domain.

        Args:
            service: Service identifier (e.g. "anthropic", "openai").
            url: Login URL. Falls back to SERVICE_URLS mapping.
            cookie_domain: Cookie domain to filter. Falls back to
                SERVICE_COOKIE_DOMAINS mapping.
            timeout_ms: Maximum time in milliseconds to wait for the
                user to authenticate before timing out.

        Returns:
            A dict with ``"cookies"`` (list of cookie dicts) and
            ``"service"`` keys, or None if login was cancelled or
            timed out.

        Raises:
            ValueError: If service has no known URL and none provided.
        """
        login_url = url or SERVICE_URLS.get(service)
        if not login_url:
            raise ValueError(
                f"No login URL known for service {service!r}. "
                f"Provide a URL explicitly."
            )

        domain = cookie_domain or SERVICE_COOKIE_DOMAINS.get(service, "")

        logger.info("Launching login browser for %s at %s", service, login_url)

        try:
            pw_context = self._playwright_launcher()
            playwright = pw_context.__enter__()
            try:
                browser = playwright.chromium.launch(headless=False)
                try:
                    context = browser.new_context()
                    try:
                        page = context.new_page()
                        page.goto(login_url, wait_until="domcontentloaded")

                        # Wait for the user to navigate away from the login page,
                        # indicating authentication is complete. We detect this by
                        # waiting for a URL change from the original login URL.
                        try:
                            page.wait_for_url(
                                lambda u: u != login_url,
                                timeout=timeout_ms,
                            )
                        except PlaywrightTimeout:
                            logger.warning(
                                "Login timed out for %s after %d ms",
                                service,
                                timeout_ms,
                            )
                            return None

                        # Extract cookies from the browser context
                        all_cookies = context.cookies()
                        if domain:
                            filtered = [
                                c for c in all_cookies
                                if domain in c.get("domain", "")
                            ]
                        else:
                            filtered = all_cookies

                        session_data = {
                            "service": service,
                            "cookies": filtered,
                        }

                        logger.info(
                            "Login successful for %s, captured %d cookies",
                            service,
                            len(filtered),
                        )
                        return session_data

                    finally:
                        context.close()
                finally:
                    browser.close()
            finally:
                pw_context.__exit__(None, None, None)

        except Exception:
            logger.exception("Error during login for %s", service)
            return None

    def save_session(self, service: str, session_data: dict) -> None:
        """Store session data via CredentialManager.

        The session data is JSON-serialized and stored using the
        credential manager with a "session:" prefixed key.

        Args:
            service: Service identifier.
            session_data: Dict containing session cookies/tokens.
        """
        key = f"{SESSION_KEY_PREFIX}{service}"
        serialized = json.dumps(session_data)
        self._credential_manager.store_api_key(service, serialized)
        logger.info("Saved session for service: %s", service)

    def get_session(self, service: str) -> Optional[dict]:
        """Retrieve stored session data for a service.

        Args:
            service: Service identifier.

        Returns:
            The session data dict, or None if no session is stored.
        """
        stored = self._credential_manager.get_api_key(service)
        if stored is None:
            return None

        try:
            data = json.loads(stored)
            # Only return if it looks like session data (has cookies key)
            if isinstance(data, dict) and "cookies" in data:
                return data
        except (json.JSONDecodeError, TypeError):
            pass

        # Stored value is a plain API key, not session data
        return None

    def get_login_url(self, service: str) -> Optional[str]:
        """Return the known login URL for a service.

        Args:
            service: Service identifier.

        Returns:
            The login URL string, or None if not known.
        """
        return SERVICE_URLS.get(service)
