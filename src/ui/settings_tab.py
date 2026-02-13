"""Settings tab UI for Zephyr Desktop.

Provides sections for credential management, Docker configuration,
and general application settings. Emits signals when credentials
need updating or settings change.
"""

from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from src.lib._version import __version__
from src.lib.models import AppSettings

# Services that can have credentials configured
CREDENTIAL_SERVICES = ("anthropic", "openai", "github")


class SettingsTab(QWidget):
    """Tab widget for application settings.

    Sections:
        Credentials: Per-service API key update buttons and login mode toggles.
        Docker: Connection status indicator and max concurrent containers spinner.
        General: Notification toggle, log level selector, about info.
        Updates: Check for updates and trigger self-update.

    Signals:
        credential_update_requested: Emitted with service name when
            "Update Key" is clicked.
        settings_changed: Emitted with a new AppSettings when any
            setting value changes.
        check_updates_requested: Emitted when "Check for Updates" is clicked.
        self_update_requested: Emitted when "Update App" is clicked.
    """

    credential_update_requested = pyqtSignal(str)
    settings_changed = pyqtSignal(object)
    check_updates_requested = pyqtSignal()
    self_update_requested = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._updating = False  # guard against recursive signal emission
        self._setup_ui()

    def _setup_ui(self):
        outer_layout = QVBoxLayout(self)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setObjectName("settings_scroll")

        container = QWidget()
        layout = QVBoxLayout(container)

        self._setup_credentials_section(layout)
        self._setup_docker_section(layout)
        self._setup_general_section(layout)
        self._setup_updates_section(layout)

        layout.addStretch()
        scroll_area.setWidget(container)
        outer_layout.addWidget(scroll_area)

    # ── Credentials section ──────────────────────────────────────────

    def _setup_credentials_section(self, parent_layout: QVBoxLayout):
        group = QGroupBox("Credentials")
        group.setObjectName("credentials_group")
        group_layout = QVBoxLayout(group)

        self._credential_buttons: dict[str, QPushButton] = {}
        self._login_mode_toggles: dict[str, QCheckBox] = {}

        for service in CREDENTIAL_SERVICES:
            row = QHBoxLayout()

            label = QLabel(service.capitalize())
            label.setMinimumWidth(80)
            row.addWidget(label)

            update_btn = QPushButton("Update Key")
            update_btn.setObjectName(f"update_key_{service}")
            update_btn.clicked.connect(
                lambda checked, s=service: self.credential_update_requested.emit(s)
            )
            self._credential_buttons[service] = update_btn
            row.addWidget(update_btn)

            login_toggle = QCheckBox("Login Mode")
            login_toggle.setObjectName(f"login_mode_{service}")
            self._login_mode_toggles[service] = login_toggle
            row.addWidget(login_toggle)

            row.addStretch()
            group_layout.addLayout(row)

        parent_layout.addWidget(group)

    # ── Docker section ───────────────────────────────────────────────

    def _setup_docker_section(self, parent_layout: QVBoxLayout):
        group = QGroupBox("Docker")
        group.setObjectName("docker_group")
        group_layout = QVBoxLayout(group)

        # Status indicator
        status_row = QHBoxLayout()
        status_row.addWidget(QLabel("Status:"))
        self.docker_status_label = QLabel("Unknown")
        self.docker_status_label.setObjectName("docker_status_indicator")
        status_row.addWidget(self.docker_status_label)
        status_row.addStretch()
        group_layout.addLayout(status_row)

        # Max concurrent containers
        concurrency_row = QHBoxLayout()
        concurrency_row.addWidget(QLabel("Max concurrent containers:"))
        self.max_containers_spin = QSpinBox()
        self.max_containers_spin.setObjectName("max_containers_spin")
        self.max_containers_spin.setMinimum(1)
        self.max_containers_spin.setMaximum(10)
        self.max_containers_spin.setValue(5)
        self.max_containers_spin.valueChanged.connect(self._on_setting_changed)
        concurrency_row.addWidget(self.max_containers_spin)
        concurrency_row.addStretch()
        group_layout.addLayout(concurrency_row)

        parent_layout.addWidget(group)

    # ── General section ──────────────────────────────────────────────

    def _setup_general_section(self, parent_layout: QVBoxLayout):
        group = QGroupBox("General")
        group.setObjectName("general_group")
        group_layout = QVBoxLayout(group)

        # Notification toggle
        self.notification_checkbox = QCheckBox("Enable desktop notifications")
        self.notification_checkbox.setObjectName("notification_checkbox")
        self.notification_checkbox.setChecked(True)
        self.notification_checkbox.stateChanged.connect(self._on_setting_changed)
        group_layout.addWidget(self.notification_checkbox)

        # Log level
        log_row = QHBoxLayout()
        log_row.addWidget(QLabel("Log level:"))
        self.log_level_combo = QComboBox()
        self.log_level_combo.setObjectName("log_level_combo")
        self.log_level_combo.addItems(["DEBUG", "INFO", "WARNING", "ERROR"])
        self.log_level_combo.setCurrentText("INFO")
        self.log_level_combo.currentTextChanged.connect(self._on_setting_changed)
        log_row.addWidget(self.log_level_combo)
        log_row.addStretch()
        group_layout.addLayout(log_row)

        # About info
        self.about_label = QLabel(f"Zephyr Desktop v{__version__}")
        self.about_label.setObjectName("about_label")
        group_layout.addWidget(self.about_label)

        parent_layout.addWidget(group)

    # ── Updates section ──────────────────────────────────────────────

    def _setup_updates_section(self, parent_layout: QVBoxLayout):
        group = QGroupBox("Updates")
        group.setObjectName("updates_group")
        group_layout = QVBoxLayout(group)

        # Status label
        status_row = QHBoxLayout()
        status_row.addWidget(QLabel("Status:"))
        self.update_status_label = QLabel("Not checked")
        self.update_status_label.setObjectName("update_status_label")
        status_row.addWidget(self.update_status_label)
        status_row.addStretch()
        group_layout.addLayout(status_row)

        # Buttons row
        btn_row = QHBoxLayout()

        self.check_updates_btn = QPushButton("Check for Updates")
        self.check_updates_btn.setObjectName("check_updates_btn")
        self.check_updates_btn.clicked.connect(self.check_updates_requested.emit)
        btn_row.addWidget(self.check_updates_btn)

        self.update_app_btn = QPushButton("Update App")
        self.update_app_btn.setObjectName("update_app_btn")
        self.update_app_btn.setEnabled(False)
        self.update_app_btn.clicked.connect(self.self_update_requested.emit)
        btn_row.addWidget(self.update_app_btn)

        btn_row.addStretch()
        group_layout.addLayout(btn_row)

        parent_layout.addWidget(group)

    # ── Public API ───────────────────────────────────────────────────

    def set_docker_status(self, connected: bool):
        """Update the Docker connection indicator.

        Args:
            connected: True if Docker daemon is reachable.
        """
        self.docker_status_label.setText("Connected" if connected else "Disconnected")

    def set_update_status(self, has_updates: bool) -> None:
        """Update the update status indicator and enable/disable the Update button.

        Args:
            has_updates: True if remote updates are available.
        """
        if has_updates:
            self.update_status_label.setText("Updates available")
            self.update_app_btn.setEnabled(True)
        else:
            self.update_status_label.setText("Up to date")
            self.update_app_btn.setEnabled(False)

    def load_settings(self, settings: AppSettings):
        """Populate all controls from an AppSettings instance.

        Does not emit settings_changed while loading.

        Args:
            settings: The settings to display.
        """
        self._updating = True
        try:
            self.max_containers_spin.setValue(settings.max_concurrent_containers)
            self.notification_checkbox.setChecked(settings.notification_enabled)
            self.log_level_combo.setCurrentText(settings.log_level)
        finally:
            self._updating = False

    def get_settings(self) -> AppSettings:
        """Build an AppSettings from current control values.

        Returns:
            AppSettings reflecting the current UI state.
        """
        return AppSettings(
            max_concurrent_containers=self.max_containers_spin.value(),
            notification_enabled=self.notification_checkbox.isChecked(),
            log_level=self.log_level_combo.currentText(),
        )

    # ── Internal ─────────────────────────────────────────────────────

    def _on_setting_changed(self, *_args):
        """Emit settings_changed whenever any setting control changes."""
        if not self._updating:
            self.settings_changed.emit(self.get_settings())
