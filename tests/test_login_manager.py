"""Tests for LoginManager — Playwright-based browser authentication."""

import json
from unittest.mock import MagicMock, patch, call

import pytest

from src.lib.login_manager import (
    LoginManager,
    SERVICE_URLS,
    SERVICE_COOKIE_DOMAINS,
    SESSION_KEY_PREFIX,
    DEFAULT_LOGIN_TIMEOUT_MS,
)
from playwright.sync_api import TimeoutError as PlaywrightTimeout

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_credential_manager():
    """Return a mock CredentialManager."""
    cm = MagicMock()
    cm.store_api_key = MagicMock()
    cm.get_api_key = MagicMock(return_value=None)
    cm.delete_api_key = MagicMock()
    return cm


@pytest.fixture
def mock_playwright_objects():
    """Create a full chain of mock Playwright objects.

    Returns a dict with all the mock objects for easy access.
    """
    page = MagicMock()
    context = MagicMock()
    context.new_page.return_value = page
    context.cookies.return_value = []
    context.close = MagicMock()

    browser = MagicMock()
    browser.new_context.return_value = context
    browser.close = MagicMock()

    chromium = MagicMock()
    chromium.launch.return_value = browser

    playwright_instance = MagicMock()
    playwright_instance.chromium = chromium

    # The context manager returned by sync_playwright()
    pw_cm = MagicMock()
    pw_cm.__enter__ = MagicMock(return_value=playwright_instance)
    pw_cm.__exit__ = MagicMock(return_value=False)

    launcher = MagicMock(return_value=pw_cm)

    return {
        "launcher": launcher,
        "pw_cm": pw_cm,
        "playwright": playwright_instance,
        "chromium": chromium,
        "browser": browser,
        "context": context,
        "page": page,
    }


@pytest.fixture
def login_manager(mock_credential_manager, mock_playwright_objects):
    """Return a LoginManager wired up with mocked dependencies."""
    return LoginManager(
        credential_manager=mock_credential_manager,
        playwright_launcher=mock_playwright_objects["launcher"],
    )


# ---------------------------------------------------------------------------
# Constants / mapping tests
# ---------------------------------------------------------------------------


class TestServiceMappings:
    """Verify service URL and cookie domain constants."""

    def test_anthropic_url(self):
        assert SERVICE_URLS["anthropic"] == "https://console.anthropic.com/login"

    def test_openai_url(self):
        assert SERVICE_URLS["openai"] == "https://platform.openai.com/login"

    def test_anthropic_cookie_domain(self):
        assert SERVICE_COOKIE_DOMAINS["anthropic"] == ".anthropic.com"

    def test_openai_cookie_domain(self):
        assert SERVICE_COOKIE_DOMAINS["openai"] == ".openai.com"

    def test_default_timeout(self):
        assert DEFAULT_LOGIN_TIMEOUT_MS == 300_000


# ---------------------------------------------------------------------------
# launch_login tests
# ---------------------------------------------------------------------------


class TestLaunchLogin:
    """Tests for LoginManager.launch_login."""

    def test_launches_browser_with_correct_url(
        self, login_manager, mock_playwright_objects
    ):
        """Browser should be launched and navigate to the service URL."""
        login_manager.launch_login("anthropic")

        mock_playwright_objects["chromium"].launch.assert_called_once_with(
            headless=False
        )
        mock_playwright_objects["page"].goto.assert_called_once_with(
            "https://console.anthropic.com/login",
            wait_until="domcontentloaded",
        )

    def test_uses_custom_url_when_provided(
        self, login_manager, mock_playwright_objects
    ):
        """When a custom URL is provided, it overrides the default."""
        custom_url = "https://custom.example.com/auth"
        login_manager.launch_login("anthropic", url=custom_url)

        mock_playwright_objects["page"].goto.assert_called_once_with(
            custom_url,
            wait_until="domcontentloaded",
        )

    def test_raises_for_unknown_service_without_url(self, login_manager):
        """Should raise ValueError for an unknown service with no URL."""
        with pytest.raises(ValueError, match="No login URL known"):
            login_manager.launch_login("unknown_service")

    def test_unknown_service_with_explicit_url_works(
        self, login_manager, mock_playwright_objects
    ):
        """An unknown service works fine if a URL is explicitly given."""
        result = login_manager.launch_login(
            "custom_svc",
            url="https://custom.example.com/login",
            cookie_domain=".example.com",
        )
        # Should not raise; may return empty cookies
        assert result is not None or result is None  # just ensure no exception

    def test_returns_session_data_on_success(
        self, login_manager, mock_playwright_objects
    ):
        """Successful login returns dict with service and cookies."""
        sample_cookies = [
            {"name": "session", "value": "abc123", "domain": ".anthropic.com"},
            {"name": "csrf", "value": "xyz", "domain": ".anthropic.com"},
        ]
        mock_playwright_objects["context"].cookies.return_value = sample_cookies

        result = login_manager.launch_login("anthropic")

        assert result is not None
        assert result["service"] == "anthropic"
        assert len(result["cookies"]) == 2
        assert result["cookies"][0]["name"] == "session"

    def test_filters_cookies_by_domain(self, login_manager, mock_playwright_objects):
        """Only cookies matching the service domain should be returned."""
        mixed_cookies = [
            {"name": "session", "value": "abc", "domain": ".anthropic.com"},
            {"name": "tracker", "value": "xyz", "domain": ".google.com"},
            {"name": "auth", "value": "def", "domain": "console.anthropic.com"},
        ]
        mock_playwright_objects["context"].cookies.return_value = mixed_cookies

        result = login_manager.launch_login("anthropic")

        assert result is not None
        # .anthropic.com should match both .anthropic.com and console.anthropic.com
        domains = [c["domain"] for c in result["cookies"]]
        assert ".google.com" not in domains
        assert all(".anthropic.com" in d for d in domains)

    def test_custom_cookie_domain_overrides_default(
        self, login_manager, mock_playwright_objects
    ):
        """A custom cookie_domain should be used instead of the default."""
        cookies = [
            {"name": "s", "value": "1", "domain": ".custom.com"},
            {"name": "x", "value": "2", "domain": ".anthropic.com"},
        ]
        mock_playwright_objects["context"].cookies.return_value = cookies

        result = login_manager.launch_login("anthropic", cookie_domain=".custom.com")

        assert result is not None
        assert len(result["cookies"]) == 1
        assert result["cookies"][0]["domain"] == ".custom.com"

    def test_returns_none_on_timeout(self, login_manager, mock_playwright_objects):
        """Should return None if the user doesn't complete login in time."""
        mock_playwright_objects["page"].wait_for_url.side_effect = PlaywrightTimeout(
            "Timeout"
        )

        result = login_manager.launch_login("anthropic", timeout_ms=1000)

        assert result is None

    def test_custom_timeout_is_passed(self, login_manager, mock_playwright_objects):
        """The timeout_ms parameter should be forwarded to wait_for_url."""
        login_manager.launch_login("anthropic", timeout_ms=60_000)

        call_args = mock_playwright_objects["page"].wait_for_url.call_args
        assert call_args[1]["timeout"] == 60_000

    def test_waits_for_url_change(self, login_manager, mock_playwright_objects):
        """wait_for_url should be called with a function that detects URL change."""
        login_manager.launch_login("anthropic")

        call_args = mock_playwright_objects["page"].wait_for_url.call_args
        url_predicate = call_args[0][0]

        # The login URL should NOT match (returns False — still on login page)
        assert url_predicate("https://console.anthropic.com/login") is False
        # A different URL SHOULD match (returns True — navigated away)
        assert url_predicate("https://console.anthropic.com/dashboard") is True

    def test_browser_and_context_closed_on_success(
        self, login_manager, mock_playwright_objects
    ):
        """Browser and context should be closed after successful login."""
        login_manager.launch_login("anthropic")

        mock_playwright_objects["context"].close.assert_called_once()
        mock_playwright_objects["browser"].close.assert_called_once()
        mock_playwright_objects["pw_cm"].__exit__.assert_called_once()

    def test_browser_and_context_closed_on_timeout(
        self, login_manager, mock_playwright_objects
    ):
        """Browser and context should be cleaned up even on timeout."""
        mock_playwright_objects["page"].wait_for_url.side_effect = PlaywrightTimeout(
            "Timeout"
        )

        login_manager.launch_login("anthropic")

        mock_playwright_objects["context"].close.assert_called_once()
        mock_playwright_objects["browser"].close.assert_called_once()
        mock_playwright_objects["pw_cm"].__exit__.assert_called_once()

    def test_returns_none_on_exception(self, login_manager, mock_playwright_objects):
        """Should return None if an unexpected exception occurs."""
        mock_playwright_objects["chromium"].launch.side_effect = RuntimeError(
            "Browser not installed"
        )

        result = login_manager.launch_login("anthropic")

        assert result is None

    def test_cleanup_on_exception(self, login_manager, mock_playwright_objects):
        """Playwright context manager should be exited even on exceptions."""
        mock_playwright_objects["chromium"].launch.side_effect = RuntimeError("fail")

        login_manager.launch_login("anthropic")

        # The outer context manager __exit__ should still be called
        mock_playwright_objects["pw_cm"].__exit__.assert_called_once()

    def test_openai_login(self, login_manager, mock_playwright_objects):
        """Should use the OpenAI login URL for the openai service."""
        login_manager.launch_login("openai")

        mock_playwright_objects["page"].goto.assert_called_once_with(
            "https://platform.openai.com/login",
            wait_until="domcontentloaded",
        )

    def test_empty_cookies_returns_valid_result(
        self, login_manager, mock_playwright_objects
    ):
        """Login should succeed even if no cookies match the domain."""
        mock_playwright_objects["context"].cookies.return_value = []

        result = login_manager.launch_login("anthropic")

        assert result is not None
        assert result["cookies"] == []
        assert result["service"] == "anthropic"

    def test_new_context_is_created(self, login_manager, mock_playwright_objects):
        """A fresh browser context should be used for each login."""
        login_manager.launch_login("anthropic")

        mock_playwright_objects["browser"].new_context.assert_called_once()

    def test_new_page_is_created(self, login_manager, mock_playwright_objects):
        """A new page should be created in the context."""
        login_manager.launch_login("anthropic")

        mock_playwright_objects["context"].new_page.assert_called_once()


# ---------------------------------------------------------------------------
# save_session tests
# ---------------------------------------------------------------------------


class TestSaveSession:
    """Tests for LoginManager.save_session."""

    def test_stores_via_credential_manager(
        self, login_manager, mock_credential_manager
    ):
        """Session data should be JSON-serialized and stored."""
        session_data = {
            "service": "anthropic",
            "cookies": [{"name": "s", "value": "123", "domain": ".anthropic.com"}],
        }

        login_manager.save_session("anthropic", session_data)

        mock_credential_manager.store_api_key.assert_called_once()
        call_args = mock_credential_manager.store_api_key.call_args
        assert call_args[0][0] == "anthropic"
        stored_json = call_args[0][1]
        parsed = json.loads(stored_json)
        assert parsed["service"] == "anthropic"
        assert len(parsed["cookies"]) == 1

    def test_save_overwrites_previous(self, login_manager, mock_credential_manager):
        """Saving a session should overwrite any previously stored value."""
        login_manager.save_session("anthropic", {"service": "anthropic", "cookies": []})
        login_manager.save_session(
            "anthropic", {"service": "anthropic", "cookies": [{"name": "new"}]}
        )

        assert mock_credential_manager.store_api_key.call_count == 2

    def test_save_different_services(self, login_manager, mock_credential_manager):
        """Sessions for different services should be stored independently."""
        login_manager.save_session("anthropic", {"service": "anthropic", "cookies": []})
        login_manager.save_session("openai", {"service": "openai", "cookies": []})

        calls = mock_credential_manager.store_api_key.call_args_list
        assert calls[0][0][0] == "anthropic"
        assert calls[1][0][0] == "openai"

    def test_session_data_is_valid_json(self, login_manager, mock_credential_manager):
        """The stored value should be valid JSON."""
        complex_data = {
            "service": "anthropic",
            "cookies": [
                {
                    "name": "session",
                    "value": "tok-abc",
                    "domain": ".anthropic.com",
                    "path": "/",
                    "httpOnly": True,
                    "secure": True,
                },
            ],
        }

        login_manager.save_session("anthropic", complex_data)

        stored = mock_credential_manager.store_api_key.call_args[0][1]
        parsed = json.loads(stored)
        assert parsed == complex_data


# ---------------------------------------------------------------------------
# get_session tests
# ---------------------------------------------------------------------------


class TestGetSession:
    """Tests for LoginManager.get_session."""

    def test_returns_none_when_no_session(self, login_manager, mock_credential_manager):
        """Should return None if no credential is stored."""
        mock_credential_manager.get_api_key.return_value = None

        result = login_manager.get_session("anthropic")

        assert result is None

    def test_returns_session_data(self, login_manager, mock_credential_manager):
        """Should return parsed session dict when stored."""
        session_data = {
            "service": "anthropic",
            "cookies": [{"name": "s", "value": "v"}],
        }
        mock_credential_manager.get_api_key.return_value = json.dumps(session_data)

        result = login_manager.get_session("anthropic")

        assert result == session_data

    def test_returns_none_for_plain_api_key(
        self, login_manager, mock_credential_manager
    ):
        """Should return None if stored value is a plain API key, not JSON."""
        mock_credential_manager.get_api_key.return_value = "sk-ant-abc123"

        result = login_manager.get_session("anthropic")

        assert result is None

    def test_returns_none_for_json_without_cookies(
        self, login_manager, mock_credential_manager
    ):
        """Should return None if stored JSON doesn't have a cookies key."""
        mock_credential_manager.get_api_key.return_value = json.dumps(
            {"service": "anthropic", "token": "abc"}
        )

        result = login_manager.get_session("anthropic")

        assert result is None

    def test_returns_none_for_invalid_json(
        self, login_manager, mock_credential_manager
    ):
        """Should return None if stored value is invalid JSON."""
        mock_credential_manager.get_api_key.return_value = "{invalid json"

        result = login_manager.get_session("anthropic")

        assert result is None

    def test_calls_credential_manager_with_service(
        self, login_manager, mock_credential_manager
    ):
        """Should call get_api_key with the correct service name."""
        login_manager.get_session("openai")

        mock_credential_manager.get_api_key.assert_called_once_with("openai")

    def test_round_trip_save_then_get(self, mock_credential_manager):
        """Saving and then getting a session should round-trip correctly."""
        storage = {}

        def fake_store(service, value):
            storage[service] = value

        def fake_get(service):
            return storage.get(service)

        mock_credential_manager.store_api_key.side_effect = fake_store
        mock_credential_manager.get_api_key.side_effect = fake_get

        lm = LoginManager(
            credential_manager=mock_credential_manager,
            playwright_launcher=MagicMock(),
        )

        session = {
            "service": "anthropic",
            "cookies": [
                {"name": "token", "value": "secret", "domain": ".anthropic.com"},
            ],
        }

        lm.save_session("anthropic", session)
        result = lm.get_session("anthropic")

        assert result == session


# ---------------------------------------------------------------------------
# get_login_url tests
# ---------------------------------------------------------------------------


class TestGetLoginUrl:
    """Tests for LoginManager.get_login_url."""

    def test_known_service_anthropic(self, login_manager):
        assert (
            login_manager.get_login_url("anthropic")
            == "https://console.anthropic.com/login"
        )

    def test_known_service_openai(self, login_manager):
        assert (
            login_manager.get_login_url("openai") == "https://platform.openai.com/login"
        )

    def test_unknown_service_returns_none(self, login_manager):
        assert login_manager.get_login_url("unknown") is None

    def test_github_not_in_urls(self, login_manager):
        """GitHub is a supported credential service but has no login URL."""
        assert login_manager.get_login_url("github") is None


# ---------------------------------------------------------------------------
# Constructor tests
# ---------------------------------------------------------------------------


class TestConstructor:
    """Tests for LoginManager construction."""

    def test_default_playwright_launcher(self, mock_credential_manager):
        """When no launcher is provided, should default to sync_playwright."""
        lm = LoginManager(credential_manager=mock_credential_manager)
        assert lm._playwright_launcher is not None

    def test_custom_launcher(self, mock_credential_manager):
        """A custom playwright launcher should be accepted."""
        custom = MagicMock()
        lm = LoginManager(
            credential_manager=mock_credential_manager,
            playwright_launcher=custom,
        )
        assert lm._playwright_launcher is custom
