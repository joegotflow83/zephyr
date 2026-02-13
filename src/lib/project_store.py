"""Project store for Zephyr Desktop.

Wraps ConfigManager to provide CRUD operations on projects,
persisted to projects.json in the config directory.
"""

from datetime import datetime, timezone

from src.lib.config_manager import ConfigManager
from src.lib.models import ProjectConfig

PROJECTS_FILE = "projects.json"


class ProjectStore:
    """CRUD store for ProjectConfig instances backed by projects.json.

    Args:
        config_manager: ConfigManager instance for file I/O.
    """

    def __init__(self, config_manager: ConfigManager):
        self._cm = config_manager

    def _load(self) -> dict[str, dict]:
        """Load the raw projects dict keyed by project id."""
        data = self._cm.load_json(PROJECTS_FILE)
        return data.get("projects", {})

    def _save(self, projects: dict[str, dict]) -> None:
        """Persist the projects dict."""
        self._cm.save_json(PROJECTS_FILE, {"projects": projects})

    def list_projects(self) -> list[ProjectConfig]:
        """Return all projects sorted by name."""
        projects = self._load()
        result = [ProjectConfig.from_dict(p) for p in projects.values()]
        result.sort(key=lambda p: p.name.lower())
        return result

    def get_project(self, project_id: str) -> ProjectConfig | None:
        """Return a single project by ID, or None if not found."""
        projects = self._load()
        data = projects.get(project_id)
        if data is None:
            return None
        return ProjectConfig.from_dict(data)

    def add_project(self, project: ProjectConfig) -> None:
        """Add a new project. Raises ValueError if ID already exists."""
        projects = self._load()
        if project.id in projects:
            raise ValueError(f"Project with id '{project.id}' already exists")
        projects[project.id] = project.to_dict()
        self._save(projects)

    def update_project(self, project: ProjectConfig) -> None:
        """Update an existing project. Raises KeyError if not found."""
        projects = self._load()
        if project.id not in projects:
            raise KeyError(f"Project with id '{project.id}' not found")
        project.updated_at = datetime.now(timezone.utc).isoformat()
        projects[project.id] = project.to_dict()
        self._save(projects)

    def remove_project(self, project_id: str) -> None:
        """Remove a project by ID. Raises KeyError if not found."""
        projects = self._load()
        if project_id not in projects:
            raise KeyError(f"Project with id '{project_id}' not found")
        del projects[project_id]
        self._save(projects)
