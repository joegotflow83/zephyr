"""Tests for CredentialManager.

Mocks the keyring module entirely so tests don't touch the real system
keyring. Uses tmp_path via ConfigManager for the credentials index file.
"""

import pytest
from unittest.mock import patch, MagicMock

from src.lib.config_manager import ConfigManager
from src.lib.credential_manager import (
    CredentialManager,
    APP_NAME,
    CREDENTIALS_INDEX,
    SUPPORTED_SERVICES,
)


@pytest.fixture
def config_manager(tmp_path):
    """ConfigManager backed by a temp directory."""
    return ConfigManager(tmp_path / ".zephyr")


@pytest.fixture
def mock_keyring():
    """Patch keyring module and return the mock."""
    storage = {}

    def set_password(service_name, username, password):
        storage[(service_name, username)] = password

    def get_password(service_name, username):
        return storage.get((service_name, username))

    def delete_password(service_name, username):
        from keyring.errors import PasswordDeleteError

        if (service_name, username) not in storage:
            raise PasswordDeleteError(f"No password for {username}")
        del storage[(service_name, username)]

    with patch("src.lib.credential_manager.keyring") as mk:
        mk.set_password = MagicMock(side_effect=set_password)
        mk.get_password = MagicMock(side_effect=get_password)
        mk.delete_password = MagicMock(side_effect=delete_password)
        mk._storage = storage  # expose for assertions
        yield mk


@pytest.fixture
def cred_mgr(config_manager, mock_keyring):
    """CredentialManager with mocked keyring."""
    return CredentialManager(config_manager)


class TestStoreApiKey:
    def test_stores_key_in_keyring(self, cred_mgr, mock_keyring):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        mock_keyring.set_password.assert_called_once_with(
            APP_NAME, "anthropic", "sk-test-123"
        )

    def test_adds_service_to_index(self, cred_mgr, config_manager):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        index = config_manager.load_json(CREDENTIALS_INDEX)
        assert "anthropic" in index["services"]

    def test_stores_multiple_services(self, cred_mgr, config_manager):
        cred_mgr.store_api_key("anthropic", "sk-ant-123")
        cred_mgr.store_api_key("openai", "sk-oai-456")
        cred_mgr.store_api_key("github", "ghp-789")
        index = config_manager.load_json(CREDENTIALS_INDEX)
        assert sorted(index["services"]) == ["anthropic", "github", "openai"]

    def test_overwrites_existing_key(self, cred_mgr, mock_keyring):
        cred_mgr.store_api_key("anthropic", "old-key")
        cred_mgr.store_api_key("anthropic", "new-key")
        assert mock_keyring.set_password.call_count == 2
        # Index should still have one entry
        services = cred_mgr.list_services()
        assert services == ["anthropic"]

    def test_rejects_unsupported_service(self, cred_mgr):
        with pytest.raises(ValueError, match="Unsupported service"):
            cred_mgr.store_api_key("azure", "key-123")

    def test_rejects_empty_service_name(self, cred_mgr):
        with pytest.raises(ValueError, match="Unsupported service"):
            cred_mgr.store_api_key("", "key-123")


class TestGetApiKey:
    def test_returns_stored_key(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        result = cred_mgr.get_api_key("anthropic")
        assert result == "sk-test-123"

    def test_returns_none_for_missing_key(self, cred_mgr):
        result = cred_mgr.get_api_key("anthropic")
        assert result is None

    def test_returns_correct_key_per_service(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "ant-key")
        cred_mgr.store_api_key("openai", "oai-key")
        assert cred_mgr.get_api_key("anthropic") == "ant-key"
        assert cred_mgr.get_api_key("openai") == "oai-key"

    def test_rejects_unsupported_service(self, cred_mgr):
        with pytest.raises(ValueError, match="Unsupported service"):
            cred_mgr.get_api_key("azure")


class TestDeleteApiKey:
    def test_removes_from_keyring(self, cred_mgr, mock_keyring):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        cred_mgr.delete_api_key("anthropic")
        mock_keyring.delete_password.assert_called_once_with(APP_NAME, "anthropic")

    def test_removes_from_index(self, cred_mgr, config_manager):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        cred_mgr.delete_api_key("anthropic")
        index = config_manager.load_json(CREDENTIALS_INDEX)
        assert "anthropic" not in index.get("services", [])

    def test_get_returns_none_after_delete(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "sk-test-123")
        cred_mgr.delete_api_key("anthropic")
        assert cred_mgr.get_api_key("anthropic") is None

    def test_delete_nonexistent_does_not_raise(self, cred_mgr):
        # Should not raise even if key was never stored
        cred_mgr.delete_api_key("anthropic")

    def test_delete_removes_only_target_service(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "ant-key")
        cred_mgr.store_api_key("openai", "oai-key")
        cred_mgr.delete_api_key("anthropic")
        assert cred_mgr.list_services() == ["openai"]
        assert cred_mgr.get_api_key("openai") == "oai-key"

    def test_rejects_unsupported_service(self, cred_mgr):
        with pytest.raises(ValueError, match="Unsupported service"):
            cred_mgr.delete_api_key("azure")


class TestListServices:
    def test_empty_initially(self, cred_mgr):
        assert cred_mgr.list_services() == []

    def test_lists_stored_services(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "key1")
        cred_mgr.store_api_key("github", "key2")
        assert cred_mgr.list_services() == ["anthropic", "github"]

    def test_sorted_alphabetically(self, cred_mgr):
        cred_mgr.store_api_key("openai", "key1")
        cred_mgr.store_api_key("anthropic", "key2")
        cred_mgr.store_api_key("github", "key3")
        assert cred_mgr.list_services() == ["anthropic", "github", "openai"]

    def test_reflects_deletions(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "key1")
        cred_mgr.store_api_key("openai", "key2")
        cred_mgr.delete_api_key("anthropic")
        assert cred_mgr.list_services() == ["openai"]

    def test_no_duplicates_after_re_store(self, cred_mgr):
        cred_mgr.store_api_key("anthropic", "key1")
        cred_mgr.store_api_key("anthropic", "key2")
        assert cred_mgr.list_services() == ["anthropic"]


class TestSupportedServices:
    def test_supported_services_tuple(self):
        assert "anthropic" in SUPPORTED_SERVICES
        assert "openai" in SUPPORTED_SERVICES
        assert "github" in SUPPORTED_SERVICES
        assert len(SUPPORTED_SERVICES) == 3


class TestRoundTrip:
    def test_store_get_delete_full_cycle(self, cred_mgr):
        """Full lifecycle: store -> get -> list -> delete -> verify gone."""
        # Store
        cred_mgr.store_api_key("anthropic", "sk-ant-key")
        cred_mgr.store_api_key("openai", "sk-oai-key")

        # Get
        assert cred_mgr.get_api_key("anthropic") == "sk-ant-key"
        assert cred_mgr.get_api_key("openai") == "sk-oai-key"

        # List
        assert cred_mgr.list_services() == ["anthropic", "openai"]

        # Delete one
        cred_mgr.delete_api_key("anthropic")
        assert cred_mgr.get_api_key("anthropic") is None
        assert cred_mgr.list_services() == ["openai"]

        # Delete remaining
        cred_mgr.delete_api_key("openai")
        assert cred_mgr.list_services() == []

    def test_persistence_across_instances(self, config_manager, mock_keyring):
        """Index file persists across CredentialManager instances."""
        mgr1 = CredentialManager(config_manager)
        mgr1.store_api_key("anthropic", "key-123")

        mgr2 = CredentialManager(config_manager)
        assert mgr2.list_services() == ["anthropic"]
