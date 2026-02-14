"""Zephyr Desktop - Full application entry point.

Instantiates all backend services and the Qt UI, wires them together
via AppController, and launches the event loop.  Docker availability
is checked at startup; if the daemon is unreachable the user sees
a warning dialog but the app continues with project-management
functionality intact.
"""

import logging
import sys

from PyQt6.QtWidgets import QApplication, QMessageBox

from src.lib.app_controller import AppController
from src.lib.asset_injector import AssetInjector
from src.lib.cleanup import CleanupManager
from src.lib.config_manager import ConfigManager
from src.lib.disk_checker import DiskChecker
from src.lib.docker_health import DockerHealthMonitor
from src.lib.credential_manager import CredentialManager
from src.lib.docker_manager import DockerManager
from src.lib.git_manager import GitManager
from src.lib.log_bridge import LogBridge
from src.lib.logging_config import setup_logging
from src.lib.login_manager import LoginManager
from src.lib.loop_runner import LoopRunner
from src.lib.models import AppSettings
from src.lib.notifier import Notifier
from src.lib.project_store import ProjectStore
from src.lib.scheduler import LoopScheduler
from src.lib.self_updater import SelfUpdater
from src.ui.main_window import MainWindow

logger = logging.getLogger("zephyr.main")


def _setup_logging(config_manager: ConfigManager) -> None:
    """Configure logging for the application via :func:`setup_logging`.

    Reads the log level from persisted settings (``settings.json``),
    falling back to INFO, then delegates to the comprehensive logging
    configuration in :mod:`src.lib.logging_config`.
    """
    data = config_manager.load_json("settings.json")
    settings = AppSettings.from_dict(data) if data else AppSettings()
    setup_logging(log_level=settings.log_level)


def _create_services(config_manager: ConfigManager) -> dict:
    """Instantiate all backend services.

    Returns a dict keyed by service name for easy access during wiring.
    DockerManager creation is wrapped so that failures (e.g. daemon not
    running) are captured rather than crashing the app.
    """
    project_store = ProjectStore(config_manager)

    # DockerManager may fail to connect — that's OK
    docker_manager = DockerManager()

    credential_manager = CredentialManager(config_manager)
    loop_runner = LoopRunner(docker_manager, project_store, credential_manager)
    loop_scheduler = LoopScheduler(loop_runner)
    asset_injector = AssetInjector(config_manager)

    # Notifier uses live AppSettings reference so toggling
    # notification_enabled at runtime takes effect immediately.
    data = config_manager.load_json("settings.json")
    settings = AppSettings.from_dict(data) if data else AppSettings()
    notifier = Notifier(settings)

    cleanup_manager = CleanupManager()

    # Disk space checker — warns before starting loops on low disk
    disk_checker = DiskChecker()

    # Background Docker health polling — updates UI on connect/disconnect
    docker_health_monitor = DockerHealthMonitor(docker_manager)

    # Browser-based login manager for interactive authentication
    login_manager = LoginManager(credential_manager)

    # Git operations and self-update
    git_manager = GitManager()
    self_updater = SelfUpdater(git_manager, loop_runner)

    return {
        "config_manager": config_manager,
        "project_store": project_store,
        "docker_manager": docker_manager,
        "credential_manager": credential_manager,
        "loop_runner": loop_runner,
        "loop_scheduler": loop_scheduler,
        "asset_injector": asset_injector,
        "notifier": notifier,
        "cleanup_manager": cleanup_manager,
        "disk_checker": disk_checker,
        "docker_health_monitor": docker_health_monitor,
        "login_manager": login_manager,
        "git_manager": git_manager,
        "self_updater": self_updater,
    }


def _show_docker_warning(parent: MainWindow) -> None:
    """Display a non-blocking warning when Docker is not available."""
    QMessageBox.warning(
        parent,
        "Docker Not Available",
        "Could not connect to the Docker daemon.\n\n"
        "Loop execution requires Docker Desktop to be installed and running.\n"
        "Project management features will still work.\n\n"
        "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/ "
        "and ensure the daemon is started, then restart Zephyr.",
    )


def create_app(
    argv: list[str] | None = None,
) -> tuple[QApplication, MainWindow, AppController]:
    """Build the full application stack and return the key objects.

    This factory is the primary entry point for both production use
    (via ``main()``) and testing.  By accepting *argv* and returning
    the app/window/controller triple, tests can drive the app without
    calling ``sys.exit``.

    Args:
        argv: Command-line arguments.  Defaults to ``sys.argv``.

    Returns:
        A tuple of (QApplication, MainWindow, AppController).
    """
    if argv is None:
        argv = sys.argv

    app = QApplication(argv)

    # -- Config & logging ---------------------------------------------------
    config_manager = ConfigManager()
    config_manager.ensure_config_dir()
    _setup_logging(config_manager)
    logger.info("Zephyr Desktop starting")

    # -- Backend services ---------------------------------------------------
    services = _create_services(config_manager)

    # -- UI -----------------------------------------------------------------
    window = MainWindow()
    log_bridge = LogBridge(parent=window)

    controller = AppController(
        main_window=window,
        project_store=services["project_store"],
        docker_manager=services["docker_manager"],
        loop_runner=services["loop_runner"],
        credential_manager=services["credential_manager"],
        config_manager=services["config_manager"],
        notifier=services["notifier"],
        docker_health_monitor=services["docker_health_monitor"],
        disk_checker=services["disk_checker"],
        login_manager=services["login_manager"],
        self_updater=services["self_updater"],
        git_manager=services["git_manager"],
    )
    controller.setup_connections()

    # Wire log bridge to the loops tab
    log_bridge.log_received.connect(window.loops_tab.append_log)

    # Start background Docker health polling
    docker_health_monitor = services["docker_health_monitor"]
    docker_health_monitor.start()

    # Wire cleanup manager for graceful shutdown
    cleanup_manager = services["cleanup_manager"]
    window.set_cleanup_manager(cleanup_manager, services["docker_manager"])
    cleanup_manager.install_signal_handlers(
        lambda: cleanup_manager.cleanup_all(services["docker_manager"])
    )

    # Initial data load
    controller.refresh_all()

    # -- Docker availability check ------------------------------------------
    if not services["docker_manager"].is_docker_available():
        logger.warning("Docker daemon not available at startup")
        _show_docker_warning(window)

    # Ensure controller background services stop on app exit
    app.aboutToQuit.connect(controller.shutdown)

    # Store extra references on window for discoverability in tests
    window._app_controller = controller
    window._log_bridge = log_bridge
    window._services = services

    return app, window, controller


def main() -> None:
    """Application entry point."""
    app, window, _controller = create_app()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
