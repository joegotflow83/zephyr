"""Tests for PyInstaller spec file and build configuration.

Validates that zephyr.spec is syntactically valid Python, contains
all required hidden imports, includes expected data files, and that
the build script exists and is executable.  Does NOT run the actual
build (too slow for the iteration loop).
"""

import ast
import os
import stat
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SPEC_FILE = PROJECT_ROOT / "zephyr.spec"
BUILD_SCRIPT = PROJECT_ROOT / "scripts" / "build.sh"


# ---------------------------------------------------------------------------
# Spec file existence and syntax
# ---------------------------------------------------------------------------

class TestSpecFileValidity:
    """Verify zephyr.spec is parseable and well-formed."""

    def test_spec_file_exists(self):
        assert SPEC_FILE.is_file(), "zephyr.spec must exist at project root"

    def test_spec_file_is_valid_python(self):
        """The spec file must be parseable as Python."""
        source = SPEC_FILE.read_text(encoding="utf-8")
        # ast.parse will raise SyntaxError if invalid
        tree = ast.parse(source, filename="zephyr.spec")
        assert isinstance(tree, ast.Module)

    def test_spec_file_not_empty(self):
        source = SPEC_FILE.read_text(encoding="utf-8")
        assert len(source.strip()) > 100, "Spec file should have substantial content"


# ---------------------------------------------------------------------------
# Hidden imports
# ---------------------------------------------------------------------------

def _extract_hidden_imports() -> list[str]:
    """Parse the spec file and extract the hiddenimports list."""
    source = SPEC_FILE.read_text(encoding="utf-8")
    tree = ast.parse(source, filename="zephyr.spec")

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "hiddenimports":
                    # Evaluate the list literal safely
                    if isinstance(node.value, ast.List):
                        return [
                            elt.value
                            for elt in node.value.elts
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                        ]
    return []


class TestHiddenImports:
    """Verify that all required hidden imports are declared."""

    @pytest.fixture(autouse=True)
    def _load_imports(self):
        self.hidden_imports = _extract_hidden_imports()

    def test_hidden_imports_not_empty(self):
        assert len(self.hidden_imports) > 0, "hiddenimports list should not be empty"

    # -- Docker SDK --
    def test_docker_imports(self):
        assert "docker" in self.hidden_imports
        assert "docker.transport" in self.hidden_imports

    # -- GitPython --
    def test_gitpython_imports(self):
        assert "git" in self.hidden_imports

    # -- Keyring --
    def test_keyring_imports(self):
        assert "keyring" in self.hidden_imports
        assert "keyring.backends" in self.hidden_imports

    # -- Plyer --
    def test_plyer_imports(self):
        assert "plyer" in self.hidden_imports

    # -- Playwright --
    def test_playwright_imports(self):
        assert "playwright" in self.hidden_imports
        assert "playwright.sync_api" in self.hidden_imports

    # -- Anthropic --
    def test_anthropic_imports(self):
        assert "anthropic" in self.hidden_imports

    # -- PyQt6 --
    def test_pyqt6_imports(self):
        assert "PyQt6.sip" in self.hidden_imports
        assert "PyQt6.QtCore" in self.hidden_imports
        assert "PyQt6.QtGui" in self.hidden_imports
        assert "PyQt6.QtWidgets" in self.hidden_imports

    # -- Application modules (src.lib.*) --
    @pytest.mark.parametrize(
        "module",
        [
            "src.lib._version",
            "src.lib.config_manager",
            "src.lib.models",
            "src.lib.project_store",
            "src.lib.import_export",
            "src.lib.docker_manager",
            "src.lib.credential_manager",
            "src.lib.loop_runner",
            "src.lib.log_parser",
            "src.lib.scheduler",
            "src.lib.asset_injector",
            "src.lib.app_controller",
            "src.lib.log_bridge",
            "src.lib.notifier",
            "src.lib.log_exporter",
            "src.lib.login_manager",
            "src.lib.docker_health",
            "src.lib.disk_checker",
            "src.lib.git_manager",
            "src.lib.cleanup",
            "src.lib.logging_config",
            "src.lib.self_updater",
        ],
    )
    def test_app_lib_module_included(self, module):
        assert module in self.hidden_imports, f"{module} must be in hiddenimports"

    # -- Application UI modules (src.ui.*) --
    @pytest.mark.parametrize(
        "module",
        [
            "src.ui.main_window",
            "src.ui.projects_tab",
            "src.ui.project_dialog",
            "src.ui.loops_tab",
            "src.ui.settings_tab",
            "src.ui.credential_dialog",
        ],
    )
    def test_app_ui_module_included(self, module):
        assert module in self.hidden_imports, f"{module} must be in hiddenimports"


# ---------------------------------------------------------------------------
# Spec file content checks
# ---------------------------------------------------------------------------

class TestSpecContent:
    """Verify key elements in the spec file content."""

    @pytest.fixture(autouse=True)
    def _load_source(self):
        self.source = SPEC_FILE.read_text(encoding="utf-8")

    def test_app_name_is_zephyr(self):
        assert 'name="Zephyr"' in self.source or "name='Zephyr'" in self.source

    def test_bundle_identifier(self):
        assert "com.zephyr.desktop" in self.source

    def test_macos_bundle_configured(self):
        """BUNDLE(...) call exists for .app output."""
        assert "BUNDLE(" in self.source

    def test_bundle_guarded_by_darwin_check(self):
        """BUNDLE must be wrapped in a sys.platform == 'darwin' guard
        so PyInstaller does not fail on Linux / Windows."""
        assert 'sys.platform == "darwin"' in self.source or "sys.platform == 'darwin'" in self.source

    def test_agents_md_in_datas(self):
        assert "AGENTS.md" in self.source

    def test_console_is_false(self):
        """GUI app should not open a console window."""
        assert "console=False" in self.source

    def test_entry_point_is_main(self):
        assert "main.py" in self.source

    def test_dev_dependencies_excluded(self):
        """Test/dev packages should be excluded from the build."""
        assert '"pytest"' in self.source  # in excludes list
        assert '"black"' in self.source
        assert '"pylint"' in self.source

    def test_minimum_macos_version(self):
        assert "15.0" in self.source

    def test_bundle_version_uses_variable(self):
        """Version in zephyr.spec is read from _version.py via APP_VERSION."""
        assert "APP_VERSION" in self.source

    def test_analysis_uses_src_pathex(self):
        """Analysis should include src/ in pathex for import resolution."""
        assert "SRC_DIR" in self.source


# ---------------------------------------------------------------------------
# Build script
# ---------------------------------------------------------------------------

class TestBuildScript:
    """Verify scripts/build.sh exists and is well-formed."""

    def test_build_script_exists(self):
        assert BUILD_SCRIPT.is_file(), "scripts/build.sh must exist"

    def test_build_script_is_executable(self):
        mode = BUILD_SCRIPT.stat().st_mode
        assert mode & stat.S_IXUSR, "build.sh must be user-executable"

    def test_build_script_references_spec(self):
        content = BUILD_SCRIPT.read_text(encoding="utf-8")
        assert "zephyr.spec" in content

    def test_build_script_runs_pyinstaller(self):
        content = BUILD_SCRIPT.read_text(encoding="utf-8")
        assert "pyinstaller" in content

    def test_build_script_has_shebang(self):
        content = BUILD_SCRIPT.read_text(encoding="utf-8")
        assert content.startswith("#!/bin/bash")

    def test_build_script_has_error_handling(self):
        content = BUILD_SCRIPT.read_text(encoding="utf-8")
        assert "set -e" in content, "Build script should use set -e for error handling"
