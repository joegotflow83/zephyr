"""Credential manager for Zephyr Desktop.

Stores API keys securely via the system keyring and tracks which
services have stored keys in a JSON index (since keyring itself has
no enumeration API).
"""

import logging
from typing import Optional

import keyring
from keyring.errors import PasswordDeleteError

from src.lib.config_manager import ConfigManager

logger = logging.getLogger(__name__)

APP_NAME = "zephyr"
CREDENTIALS_INDEX = "credentials_index.json"
SUPPORTED_SERVICES = ("anthropic", "openai", "github")


class CredentialManager:
    """Manages API key storage via system keyring.

    Args:
        config_manager: ConfigManager instance for persisting the
            credentials index file that tracks stored services.
    """

    def __init__(self, config_manager: ConfigManager):
        self._config = config_manager

    def store_api_key(self, service: str, key: str) -> None:
        """Store an API key in the system keyring.

        Args:
            service: Service identifier (e.g. "anthropic", "openai", "github").
            key: The API key string to store.

        Raises:
            ValueError: If service is not in SUPPORTED_SERVICES.
        """
        self._validate_service(service)
        keyring.set_password(APP_NAME, service, key)
        self._add_to_index(service)
        logger.info("Stored API key for service: %s", service)

    def get_api_key(self, service: str) -> Optional[str]:
        """Retrieve an API key from the system keyring.

        Args:
            service: Service identifier.

        Returns:
            The stored API key, or None if not found.

        Raises:
            ValueError: If service is not in SUPPORTED_SERVICES.
        """
        self._validate_service(service)
        return keyring.get_password(APP_NAME, service)

    def delete_api_key(self, service: str) -> None:
        """Delete an API key from the system keyring.

        Args:
            service: Service identifier.

        Raises:
            ValueError: If service is not in SUPPORTED_SERVICES.
        """
        self._validate_service(service)
        try:
            keyring.delete_password(APP_NAME, service)
        except PasswordDeleteError:
            logger.debug("No password to delete for service: %s", service)
        self._remove_from_index(service)
        logger.info("Deleted API key for service: %s", service)

    def list_services(self) -> list[str]:
        """Return the list of services that have stored API keys.

        Reads from the credentials index JSON file. The index is kept
        in sync by store/delete operations.

        Returns:
            List of service name strings.
        """
        index = self._config.load_json(CREDENTIALS_INDEX)
        return sorted(index.get("services", []))

    def _validate_service(self, service: str) -> None:
        """Raise ValueError if service is not recognized."""
        if service not in SUPPORTED_SERVICES:
            raise ValueError(
                f"Unsupported service: {service!r}. "
                f"Supported: {', '.join(SUPPORTED_SERVICES)}"
            )

    def _add_to_index(self, service: str) -> None:
        """Add a service to the credentials index."""
        index = self._config.load_json(CREDENTIALS_INDEX)
        services = set(index.get("services", []))
        services.add(service)
        index["services"] = sorted(services)
        self._config.save_json(CREDENTIALS_INDEX, index)

    def _remove_from_index(self, service: str) -> None:
        """Remove a service from the credentials index."""
        index = self._config.load_json(CREDENTIALS_INDEX)
        services = set(index.get("services", []))
        services.discard(service)
        index["services"] = sorted(services)
        self._config.save_json(CREDENTIALS_INDEX, index)
