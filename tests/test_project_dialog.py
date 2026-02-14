"""Tests for the Add/Edit Project dialog."""

import pytest
from unittest.mock import patch, MagicMock
from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import QDialog, QDialogButtonBox, QMessageBox

from src.lib.models import ProjectConfig
from src.ui.project_dialog import ProjectDialog, PromptEditorDialog

# ---------------------------------------------------------------------------
# PromptEditorDialog tests
# ---------------------------------------------------------------------------


class TestPromptEditorDialog:
    """Tests for the prompt editor sub-dialog."""

    def test_initial_content(self, qtbot):
        dialog = PromptEditorDialog("test.md", "hello world")
        qtbot.addWidget(dialog)
        assert dialog.get_content() == "hello world"

    def test_empty_content(self, qtbot):
        dialog = PromptEditorDialog("test.md")
        qtbot.addWidget(dialog)
        assert dialog.get_content() == ""

    def test_window_title_contains_filename(self, qtbot):
        dialog = PromptEditorDialog("PROMPT_build.md", "")
        qtbot.addWidget(dialog)
        assert "PROMPT_build.md" in dialog.windowTitle()

    def test_edit_content(self, qtbot):
        dialog = PromptEditorDialog("test.md", "original")
        qtbot.addWidget(dialog)
        dialog.editor.setPlainText("modified content")
        assert dialog.get_content() == "modified content"

    def test_has_ok_cancel_buttons(self, qtbot):
        dialog = PromptEditorDialog("test.md")
        qtbot.addWidget(dialog)
        assert dialog.button_box is not None

    def test_minimum_size(self, qtbot):
        dialog = PromptEditorDialog("test.md")
        qtbot.addWidget(dialog)
        assert dialog.minimumWidth() >= 500
        assert dialog.minimumHeight() >= 400


# ---------------------------------------------------------------------------
# ProjectDialog - add mode tests
# ---------------------------------------------------------------------------


class TestProjectDialogAddMode:
    """Tests for ProjectDialog in add mode (no existing project)."""

    def test_dialog_opens(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.isVisible() is False  # not shown yet, just instantiated
        dialog.show()
        assert dialog.isVisible()

    def test_window_title_add_mode(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.windowTitle() == "Add Project"

    def test_fields_exist(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.name_edit is not None
        assert dialog.repo_url_edit is not None
        assert dialog.jtbd_edit is not None
        assert dialog.docker_image_edit is not None
        assert dialog.prompts_list is not None

    def test_default_docker_image(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.docker_image_edit.text() == "ubuntu:24.04"

    def test_name_field_empty_by_default(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.name_edit.text() == ""

    def test_repo_url_field_empty_by_default(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.repo_url_edit.text() == ""

    def test_jtbd_field_empty_by_default(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.jtbd_edit.toPlainText() == ""

    def test_prompts_list_empty_by_default(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.prompts_list.count() == 0

    def test_has_ok_cancel_buttons(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        ok_btn = dialog.button_box.button(QDialogButtonBox.StandardButton.Ok)
        cancel_btn = dialog.button_box.button(QDialogButtonBox.StandardButton.Cancel)
        assert ok_btn is not None
        assert cancel_btn is not None

    def test_get_project_returns_project_config(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("My Project")
        dialog.repo_url_edit.setText("https://github.com/user/repo")
        project = dialog.get_project()
        assert isinstance(project, ProjectConfig)
        assert project.name == "My Project"
        assert project.repo_url == "https://github.com/user/repo"

    def test_get_project_generates_new_id(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        p1 = dialog.get_project()
        p2 = dialog.get_project()
        # Each call generates a new ID
        assert p1.id != p2.id

    def test_get_project_includes_jtbd(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        dialog.jtbd_edit.setPlainText("Build a great app")
        project = dialog.get_project()
        assert project.jtbd == "Build a great app"

    def test_get_project_includes_docker_image(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        dialog.docker_image_edit.setText("python:3.12")
        project = dialog.get_project()
        assert project.docker_image == "python:3.12"

    def test_get_project_defaults_docker_image_when_empty(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        dialog.docker_image_edit.setText("")
        project = dialog.get_project()
        assert project.docker_image == "ubuntu:24.04"

    def test_get_project_strips_whitespace(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("  My Project  ")
        dialog.repo_url_edit.setText("  https://github.com/user/repo  ")
        dialog.jtbd_edit.setPlainText("  some text  ")
        project = dialog.get_project()
        assert project.name == "My Project"
        assert project.repo_url == "https://github.com/user/repo"
        assert project.jtbd == "some text"

    def test_get_project_has_timestamps(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        project = dialog.get_project()
        assert project.created_at is not None
        assert project.updated_at is not None

    def test_minimum_size(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        assert dialog.minimumWidth() >= 500
        assert dialog.minimumHeight() >= 450


# ---------------------------------------------------------------------------
# ProjectDialog - edit mode tests
# ---------------------------------------------------------------------------


class TestProjectDialogEditMode:
    """Tests for ProjectDialog in edit mode (existing project)."""

    @pytest.fixture
    def sample_project(self):
        return ProjectConfig(
            id="abc123",
            name="Existing Project",
            repo_url="https://github.com/owner/existing",
            jtbd="Fix all the bugs",
            custom_prompts={
                "PROMPT_build.md": "build instructions",
                "PROMPT_test.md": "test plan",
            },
            docker_image="node:20",
            created_at="2025-01-01T00:00:00+00:00",
            updated_at="2025-06-15T12:00:00+00:00",
        )

    def test_window_title_edit_mode(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        assert dialog.windowTitle() == "Edit Project"

    def test_fields_populated_from_project(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        assert dialog.name_edit.text() == "Existing Project"
        assert dialog.repo_url_edit.text() == "https://github.com/owner/existing"
        assert dialog.jtbd_edit.toPlainText() == "Fix all the bugs"
        assert dialog.docker_image_edit.text() == "node:20"

    def test_custom_prompts_populated(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        items = [
            dialog.prompts_list.item(i).text()
            for i in range(dialog.prompts_list.count())
        ]
        assert "PROMPT_build.md" in items
        assert "PROMPT_test.md" in items

    def test_preserves_project_id(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Modified Name")
        project = dialog.get_project()
        assert project.id == "abc123"

    def test_preserves_created_at(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        project = dialog.get_project()
        assert project.created_at == "2025-01-01T00:00:00+00:00"

    def test_updates_updated_at(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        project = dialog.get_project()
        assert project.updated_at != "2025-06-15T12:00:00+00:00"

    def test_get_project_returns_modified_values(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("New Name")
        dialog.repo_url_edit.setText("https://github.com/new/repo")
        dialog.jtbd_edit.setPlainText("New goals")
        dialog.docker_image_edit.setText("python:3.12")
        project = dialog.get_project()
        assert project.name == "New Name"
        assert project.repo_url == "https://github.com/new/repo"
        assert project.jtbd == "New goals"
        assert project.docker_image == "python:3.12"

    def test_custom_prompts_preserved_in_get_project(self, qtbot, sample_project):
        dialog = ProjectDialog(project=sample_project)
        qtbot.addWidget(dialog)
        project = dialog.get_project()
        assert "PROMPT_build.md" in project.custom_prompts
        assert project.custom_prompts["PROMPT_build.md"] == "build instructions"


# ---------------------------------------------------------------------------
# Validation tests
# ---------------------------------------------------------------------------


class TestProjectDialogValidation:
    """Tests for form validation behavior."""

    def test_rejects_empty_name(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        with patch.object(
            QMessageBox, "warning", return_value=QMessageBox.StandardButton.Ok
        ):
            dialog._validate_and_accept()
        assert dialog.result() != QDialog.DialogCode.Accepted

    def test_rejects_empty_repo_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test Project")
        dialog.repo_url_edit.setText("")
        with patch.object(
            QMessageBox, "warning", return_value=QMessageBox.StandardButton.Ok
        ):
            dialog._validate_and_accept()
        assert dialog.result() != QDialog.DialogCode.Accepted

    def test_rejects_invalid_repo_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test Project")
        dialog.repo_url_edit.setText("not a valid url")
        with patch.object(
            QMessageBox, "warning", return_value=QMessageBox.StandardButton.Ok
        ):
            dialog._validate_and_accept()
        assert dialog.result() != QDialog.DialogCode.Accepted

    def test_accepts_https_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test Project")
        dialog.repo_url_edit.setText("https://github.com/test/repo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_http_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("http://gitlab.com/test/repo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_git_protocol(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("git://github.com/test/repo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_ssh_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("git@github.com:test/repo.git")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_ssh_protocol_url(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("ssh://git@github.com/test/repo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_absolute_local_path(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("/home/user/projects/myrepo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_relative_local_path(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("./myrepo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_accepts_home_tilde_path(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("~/projects/myrepo")
        dialog._validate_and_accept()
        assert dialog.result() == QDialog.DialogCode.Accepted

    def test_rejects_whitespace_only_name(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("   ")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        with patch.object(
            QMessageBox, "warning", return_value=QMessageBox.StandardButton.Ok
        ):
            dialog._validate_and_accept()
        assert dialog.result() != QDialog.DialogCode.Accepted


# ---------------------------------------------------------------------------
# Custom prompts management tests
# ---------------------------------------------------------------------------


class TestProjectDialogCustomPrompts:
    """Tests for custom prompt add/edit/remove functionality."""

    def test_add_prompt(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        with patch(
            "src.ui.project_dialog.QInputDialog.getText",
            return_value=("PROMPT_new.md", True),
        ):
            with patch.object(dialog, "_open_prompt_editor"):
                dialog._add_prompt()
        assert dialog.prompts_list.count() == 1
        assert dialog.prompts_list.item(0).text() == "PROMPT_new.md"
        assert "PROMPT_new.md" in dialog._custom_prompts

    def test_add_prompt_cancelled(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        with patch(
            "src.ui.project_dialog.QInputDialog.getText", return_value=("", False)
        ):
            dialog._add_prompt()
        assert dialog.prompts_list.count() == 0

    def test_add_duplicate_prompt_rejected(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["PROMPT_build.md"] = "content"
        dialog.prompts_list.addItem("PROMPT_build.md")
        with patch(
            "src.ui.project_dialog.QInputDialog.getText",
            return_value=("PROMPT_build.md", True),
        ):
            with patch.object(
                QMessageBox, "warning", return_value=QMessageBox.StandardButton.Ok
            ):
                dialog._add_prompt()
        assert dialog.prompts_list.count() == 1  # still just one

    def test_remove_prompt(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["test.md"] = "content"
        dialog.prompts_list.addItem("test.md")
        dialog.prompts_list.setCurrentRow(0)
        dialog._remove_prompt()
        assert dialog.prompts_list.count() == 0
        assert "test.md" not in dialog._custom_prompts

    def test_remove_prompt_nothing_selected(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["test.md"] = "content"
        dialog.prompts_list.addItem("test.md")
        # Don't select anything
        dialog.prompts_list.setCurrentRow(-1)
        dialog._remove_prompt()
        # Nothing should be removed
        assert dialog.prompts_list.count() == 1

    def test_edit_prompt_opens_editor(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["test.md"] = "original content"
        dialog.prompts_list.addItem("test.md")
        dialog.prompts_list.setCurrentRow(0)

        with patch.object(dialog, "_open_prompt_editor") as mock_open:
            dialog._edit_selected_prompt()
            mock_open.assert_called_once_with("test.md")

    def test_edit_prompt_nothing_selected(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.prompts_list.setCurrentRow(-1)
        with patch.object(dialog, "_open_prompt_editor") as mock_open:
            dialog._edit_selected_prompt()
            mock_open.assert_not_called()

    def test_prompt_editor_updates_content(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["test.md"] = "old"

        with patch.object(
            PromptEditorDialog, "exec", return_value=QDialog.DialogCode.Accepted
        ):
            with patch.object(
                PromptEditorDialog, "get_content", return_value="new content"
            ):
                dialog._open_prompt_editor("test.md")

        assert dialog._custom_prompts["test.md"] == "new content"

    def test_prompt_editor_cancel_preserves_content(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog._custom_prompts["test.md"] = "old"

        with patch.object(
            PromptEditorDialog, "exec", return_value=QDialog.DialogCode.Rejected
        ):
            dialog._open_prompt_editor("test.md")

        assert dialog._custom_prompts["test.md"] == "old"

    def test_custom_prompts_in_get_project(self, qtbot):
        dialog = ProjectDialog()
        qtbot.addWidget(dialog)
        dialog.name_edit.setText("Test")
        dialog.repo_url_edit.setText("https://github.com/test/test")
        dialog._custom_prompts["PROMPT_build.md"] = "build steps"
        dialog._custom_prompts["PROMPT_test.md"] = "test plan"
        project = dialog.get_project()
        assert project.custom_prompts == {
            "PROMPT_build.md": "build steps",
            "PROMPT_test.md": "test plan",
        }

    def test_prompts_list_sorted_in_edit_mode(self, qtbot):
        project = ProjectConfig(
            name="Test",
            repo_url="https://github.com/test/test",
            custom_prompts={"z_prompt.md": "", "a_prompt.md": "", "m_prompt.md": ""},
        )
        dialog = ProjectDialog(project=project)
        qtbot.addWidget(dialog)
        items = [
            dialog.prompts_list.item(i).text()
            for i in range(dialog.prompts_list.count())
        ]
        assert items == ["a_prompt.md", "m_prompt.md", "z_prompt.md"]


# ---------------------------------------------------------------------------
# URL validation static method tests
# ---------------------------------------------------------------------------


class TestRepoUrlValidation:
    """Tests for the _is_valid_repo_url static method."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://github.com/user/repo",
            "http://gitlab.com/user/repo",
            "git://github.com/user/repo.git",
            "git@github.com:user/repo.git",
            "ssh://git@github.com/user/repo",
            "/home/user/repo",
            "/tmp/test",
            "~/projects/repo",
            "./local-repo",
            "../parent-repo",
        ],
    )
    def test_valid_urls(self, url):
        assert ProjectDialog._is_valid_repo_url(url) is True

    @pytest.mark.parametrize(
        "url",
        [
            "not-a-url",
            "ftp://files.example.com/repo",
            "just some text",
            "repo-name",
            "",
        ],
    )
    def test_invalid_urls(self, url):
        assert ProjectDialog._is_valid_repo_url(url) is False
