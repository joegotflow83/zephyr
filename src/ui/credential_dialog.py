"""Credential input dialog for Zephyr Desktop.

Provides a dialog for entering API keys or selecting login mode
for a given service. The dialog shows a password-masked input field
and a login mode checkbox.
"""

from PyQt6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QLabel,
    QLineEdit,
    QVBoxLayout,
)


class CredentialDialog(QDialog):
    """Dialog for entering an API key or choosing login mode for a service.

    The dialog presents:
        - A label showing which service is being configured.
        - A password-masked line edit for the API key.
        - A "Use Login Mode" checkbox that, when checked, shows a note
          about browser-based authentication.
        - OK/Cancel buttons.

    Args:
        service: The service name (e.g. "anthropic", "openai", "github").
        parent: Optional parent widget.
    """

    def __init__(self, service: str, parent=None):
        super().__init__(parent)
        self._service = service
        self.setWindowTitle(f"Credential: {service.capitalize()}")
        self.setMinimumWidth(400)
        self._setup_ui()

    def _setup_ui(self):
        layout = QVBoxLayout(self)

        # Service label
        self.service_label = QLabel(f"Service: {self._service.capitalize()}")
        self.service_label.setObjectName("service_label")
        layout.addWidget(self.service_label)

        # API key input
        layout.addWidget(QLabel("API Key:"))
        self.key_edit = QLineEdit()
        self.key_edit.setObjectName("key_edit")
        self.key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.key_edit.setPlaceholderText("Enter API key...")
        layout.addWidget(self.key_edit)

        # Login mode checkbox
        self.login_mode_checkbox = QCheckBox("Use Login Mode")
        self.login_mode_checkbox.setObjectName("login_mode_checkbox")
        self.login_mode_checkbox.toggled.connect(self._on_login_mode_toggled)
        layout.addWidget(self.login_mode_checkbox)

        # Login mode note (hidden by default)
        self.login_note = QLabel(
            "A browser window will open for you to authenticate."
        )
        self.login_note.setObjectName("login_note")
        self.login_note.setWordWrap(True)
        self.login_note.setVisible(False)
        layout.addWidget(self.login_note)

        # OK / Cancel buttons
        self.button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        self.button_box.setObjectName("button_box")
        self.button_box.accepted.connect(self.accept)
        self.button_box.rejected.connect(self.reject)
        layout.addWidget(self.button_box)

    def _on_login_mode_toggled(self, checked: bool):
        """Show or hide the login note and toggle the key input state."""
        self.login_note.setVisible(checked)
        self.key_edit.setEnabled(not checked)

    def get_result(self) -> tuple[str, bool]:
        """Return the entered key text and whether login mode was selected.

        Returns:
            A tuple of (key_text, use_login_mode).
        """
        return (self.key_edit.text(), self.login_mode_checkbox.isChecked())
