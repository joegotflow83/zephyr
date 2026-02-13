"""Data models for Zephyr Desktop.

Defines ProjectConfig and AppSettings as dataclasses with
dict serialization for JSON persistence via ConfigManager.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4


@dataclass
class ProjectConfig:
    """Configuration for a single managed project.

    Attributes:
        id: Unique identifier (uuid4 hex string).
        name: Human-readable project name.
        repo_url: Git repository URL or local path.
        jtbd: Jobs-to-be-done description for the project.
        custom_prompts: Maps prompt filename to content,
            e.g. {"PROMPT_build.md": "..."}.
        docker_image: Docker base image for containers.
        created_at: ISO 8601 creation timestamp.
        updated_at: ISO 8601 last-update timestamp.
    """

    name: str
    repo_url: str
    id: str = field(default_factory=lambda: uuid4().hex)
    jtbd: str = ""
    custom_prompts: dict[str, str] = field(default_factory=dict)
    docker_image: str = "ubuntu:24.04"
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        """Serialize to a plain dict suitable for JSON storage."""
        return {
            "id": self.id,
            "name": self.name,
            "repo_url": self.repo_url,
            "jtbd": self.jtbd,
            "custom_prompts": dict(self.custom_prompts),
            "docker_image": self.docker_image,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ProjectConfig":
        """Deserialize from a dict, handling missing optional fields."""
        now = datetime.now(timezone.utc).isoformat()
        return cls(
            id=data.get("id", uuid4().hex),
            name=data["name"],
            repo_url=data["repo_url"],
            jtbd=data.get("jtbd", ""),
            custom_prompts=data.get("custom_prompts", {}),
            docker_image=data.get("docker_image", "ubuntu:24.04"),
            created_at=data.get("created_at", now),
            updated_at=data.get("updated_at", now),
        )


@dataclass
class AppSettings:
    """Global application settings.

    Attributes:
        max_concurrent_containers: Max Docker containers running at once.
        notification_enabled: Whether desktop notifications are active.
        theme: UI theme ("system", "light", or "dark").
        log_level: Python logging level name.
    """

    max_concurrent_containers: int = 5
    notification_enabled: bool = True
    theme: str = "system"
    log_level: str = "INFO"

    def to_dict(self) -> dict:
        """Serialize to a plain dict suitable for JSON storage."""
        return {
            "max_concurrent_containers": self.max_concurrent_containers,
            "notification_enabled": self.notification_enabled,
            "theme": self.theme,
            "log_level": self.log_level,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AppSettings":
        """Deserialize from a dict, using defaults for missing fields."""
        return cls(
            max_concurrent_containers=data.get("max_concurrent_containers", 5),
            notification_enabled=data.get("notification_enabled", True),
            theme=data.get("theme", "system"),
            log_level=data.get("log_level", "INFO"),
        )
