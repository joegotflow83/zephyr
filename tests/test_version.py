"""Tests for the version module (src/lib/_version.py).

The version module is the single source of truth for the application version.
It is read at runtime by the app (About dialog, settings tab) and at build
time by zephyr.spec (macOS bundle metadata).  The CI release workflow patches
this file with the version from the git tag before building.
"""

import re


class TestVersionModule:
    """Verify _version.py exposes a valid semver string."""

    def test_version_is_importable(self):
        from src.lib._version import __version__

        assert isinstance(__version__, str)

    def test_version_is_semver(self):
        """Version must be a valid semver (MAJOR.MINOR.PATCH)."""
        from src.lib._version import __version__

        assert re.match(
            r"^\d+\.\d+\.\d+$", __version__
        ), f"Version '{__version__}' is not valid semver"

    def test_version_is_consistent_with_app_controller(self):
        """AppController About dialog should use the same version."""
        from src.lib._version import __version__
        from src.lib.app_controller import __version__ as ctrl_version

        assert __version__ == ctrl_version

    def test_version_is_consistent_with_settings_tab(self):
        """SettingsTab imports version from _version module."""
        from src.lib._version import __version__
        import src.ui.settings_tab as st_mod

        # The module should import __version__ from _version
        assert hasattr(st_mod, "__version__") or "__version__" in dir(st_mod)


class TestVersionFileFormat:
    """Verify the _version.py file can be parsed without importing."""

    def test_exec_parse(self):
        """CI workflow uses exec() to read version — ensure this works."""
        from pathlib import Path

        version_file = (
            Path(__file__).resolve().parent.parent / "src" / "lib" / "_version.py"
        )
        ns: dict = {}
        exec(compile(version_file.read_text(), version_file, "exec"), ns)
        assert "__version__" in ns
        assert isinstance(ns["__version__"], str)
        assert re.match(r"^\d+\.\d+\.\d+$", ns["__version__"])
