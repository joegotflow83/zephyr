"""Add/Edit Project dialog for Zephyr Desktop.

Provides a form dialog for creating new projects or editing existing ones.
Supports fields for name, repo URL, JTBD, Docker image, and custom prompts.
"""

from datetime import datetime, timezone
from uuid import uuid4

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from src.lib.models import ProjectConfig


class PromptEditorDialog(QDialog):
    """Sub-dialog for editing the content of a custom prompt file."""

    def __init__(self, filename: str, content: str = "", parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"Edit Prompt: {filename}")
        self.setMinimumSize(500, 400)

        layout = QVBoxLayout(self)

        self.filename_label = QLabel(f"File: {filename}")
        layout.addWidget(self.filename_label)

        self.editor = QTextEdit()
        self.editor.setObjectName("prompt_editor")
        self.editor.setPlainText(content)
        self.editor.setAcceptRichText(False)
        layout.addWidget(self.editor)

        self.button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        self.button_box.accepted.connect(self.accept)
        self.button_box.rejected.connect(self.reject)
        layout.addWidget(self.button_box)

    def get_content(self) -> str:
        """Return the edited prompt content."""
        return self.editor.toPlainText()


class ProjectDialog(QDialog):
    """Dialog for adding or editing a project configuration.

    In add mode (no existing project), creates a new ProjectConfig with a fresh ID.
    In edit mode (existing project passed), preserves the ID and created_at timestamp.

    Args:
        project: Optional existing ProjectConfig for edit mode.
        parent: Optional parent widget.
    """

    def __init__(self, project: ProjectConfig | None = None, parent=None):
        super().__init__(parent)
        self._editing = project is not None
        self._original_project = project
        self._custom_prompts: dict[str, str] = {}

        if project is not None:
            self._custom_prompts = dict(project.custom_prompts)

        self.setWindowTitle("Edit Project" if self._editing else "Add Project")
        self.setMinimumSize(500, 450)
        self._setup_ui()

        if project is not None:
            self._populate_from_project(project)

    def _setup_ui(self):
        """Build the form layout with all fields."""
        layout = QVBoxLayout(self)

        # Name field
        layout.addWidget(QLabel("Name:"))
        self.name_edit = QLineEdit()
        self.name_edit.setObjectName("name_edit")
        self.name_edit.setPlaceholderText("Project name")
        layout.addWidget(self.name_edit)

        # Repo URL field
        layout.addWidget(QLabel("Repository URL:"))
        self.repo_url_edit = QLineEdit()
        self.repo_url_edit.setObjectName("repo_url_edit")
        self.repo_url_edit.setPlaceholderText(
            "https://github.com/user/repo or /local/path"
        )
        layout.addWidget(self.repo_url_edit)

        # JTBD field
        layout.addWidget(QLabel("Jobs-to-be-done:"))
        self.jtbd_edit = QTextEdit()
        self.jtbd_edit.setObjectName("jtbd_edit")
        self.jtbd_edit.setPlaceholderText(
            "Describe what this project should accomplish..."
        )
        self.jtbd_edit.setMaximumHeight(100)
        self.jtbd_edit.setAcceptRichText(False)
        layout.addWidget(self.jtbd_edit)

        # Docker image field
        layout.addWidget(QLabel("Docker Image:"))
        self.docker_image_edit = QLineEdit()
        self.docker_image_edit.setObjectName("docker_image_edit")
        self.docker_image_edit.setPlaceholderText("ubuntu:24.04")
        self.docker_image_edit.setText("ubuntu:24.04")
        layout.addWidget(self.docker_image_edit)

        # Custom prompts section
        layout.addWidget(QLabel("Custom Prompts:"))
        prompts_widget = QWidget()
        prompts_layout = QHBoxLayout(prompts_widget)
        prompts_layout.setContentsMargins(0, 0, 0, 0)

        self.prompts_list = QListWidget()
        self.prompts_list.setObjectName("prompts_list")
        self.prompts_list.itemDoubleClicked.connect(self._edit_prompt)
        prompts_layout.addWidget(self.prompts_list)

        prompts_btn_layout = QVBoxLayout()
        self.add_prompt_btn = QPushButton("Add")
        self.add_prompt_btn.setObjectName("add_prompt_btn")
        self.add_prompt_btn.clicked.connect(self._add_prompt)
        prompts_btn_layout.addWidget(self.add_prompt_btn)

        self.edit_prompt_btn = QPushButton("Edit")
        self.edit_prompt_btn.setObjectName("edit_prompt_btn")
        self.edit_prompt_btn.clicked.connect(self._edit_selected_prompt)
        prompts_btn_layout.addWidget(self.edit_prompt_btn)

        self.remove_prompt_btn = QPushButton("Remove")
        self.remove_prompt_btn.setObjectName("remove_prompt_btn")
        self.remove_prompt_btn.clicked.connect(self._remove_prompt)
        prompts_btn_layout.addWidget(self.remove_prompt_btn)

        prompts_btn_layout.addStretch()
        prompts_layout.addLayout(prompts_btn_layout)
        layout.addWidget(prompts_widget)

        # OK / Cancel buttons
        self.button_box = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        self.button_box.setObjectName("button_box")
        self.button_box.accepted.connect(self._validate_and_accept)
        self.button_box.rejected.connect(self.reject)
        layout.addWidget(self.button_box)

    def _populate_from_project(self, project: ProjectConfig):
        """Fill form fields from an existing project config."""
        self.name_edit.setText(project.name)
        self.repo_url_edit.setText(project.repo_url)
        self.jtbd_edit.setPlainText(project.jtbd)
        self.docker_image_edit.setText(project.docker_image)

        self.prompts_list.clear()
        for filename in sorted(self._custom_prompts.keys()):
            self.prompts_list.addItem(filename)

    def _validate_and_accept(self):
        """Validate form fields and accept if valid."""
        name = self.name_edit.text().strip()
        if not name:
            QMessageBox.warning(self, "Validation Error", "Project name is required.")
            self.name_edit.setFocus()
            return

        repo_url = self.repo_url_edit.text().strip()
        if not repo_url:
            QMessageBox.warning(self, "Validation Error", "Repository URL is required.")
            self.repo_url_edit.setFocus()
            return

        if not self._is_valid_repo_url(repo_url):
            QMessageBox.warning(
                self,
                "Validation Error",
                "Repository URL must be a valid URL (http/https/git/ssh) or a local path.",
            )
            self.repo_url_edit.setFocus()
            return

        self.accept()

    @staticmethod
    def _is_valid_repo_url(url: str) -> bool:
        """Check if a string is a valid repo URL or local path."""
        if url.startswith(("http://", "https://", "git://", "git@", "ssh://")):
            return True
        if url.startswith(("/", "~", ".")):
            return True
        return False

    def _add_prompt(self):
        """Show an input dialog to add a new custom prompt file."""
        filename, ok = QInputDialog.getText(
            self, "Add Prompt", "Prompt filename:", text="PROMPT_build.md"
        )
        if ok and filename.strip():
            filename = filename.strip()
            if filename in self._custom_prompts:
                QMessageBox.warning(
                    self, "Duplicate", f"A prompt named '{filename}' already exists."
                )
                return
            self._custom_prompts[filename] = ""
            self.prompts_list.addItem(filename)
            # Open editor immediately for the new prompt
            self._open_prompt_editor(filename)

    def _edit_prompt(self, item: QListWidgetItem):
        """Edit a prompt when its list item is double-clicked."""
        filename = item.text()
        self._open_prompt_editor(filename)

    def _edit_selected_prompt(self):
        """Edit the currently selected prompt in the list."""
        current = self.prompts_list.currentItem()
        if current is None:
            return
        self._open_prompt_editor(current.text())

    def _open_prompt_editor(self, filename: str):
        """Open the prompt editor sub-dialog for the given filename."""
        content = self._custom_prompts.get(filename, "")
        dialog = PromptEditorDialog(filename, content, self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            self._custom_prompts[filename] = dialog.get_content()

    def _remove_prompt(self):
        """Remove the currently selected prompt from the list."""
        current = self.prompts_list.currentItem()
        if current is None:
            return
        filename = current.text()
        self._custom_prompts.pop(filename, None)
        self.prompts_list.takeItem(self.prompts_list.row(current))

    def get_project(self) -> ProjectConfig:
        """Return a ProjectConfig populated from the form fields.

        In edit mode, preserves the original ID and created_at.
        In add mode, generates a new ID and timestamps.
        """
        now = datetime.now(timezone.utc).isoformat()

        if self._editing and self._original_project is not None:
            project_id = self._original_project.id
            created_at = self._original_project.created_at
        else:
            project_id = uuid4().hex
            created_at = now

        return ProjectConfig(
            id=project_id,
            name=self.name_edit.text().strip(),
            repo_url=self.repo_url_edit.text().strip(),
            jtbd=self.jtbd_edit.toPlainText().strip(),
            custom_prompts=dict(self._custom_prompts),
            docker_image=self.docker_image_edit.text().strip() or "ubuntu:24.04",
            created_at=created_at,
            updated_at=now,
        )
