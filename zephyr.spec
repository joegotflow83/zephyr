# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for Zephyr Desktop.

Bundles the src/ package into a standalone application targeting
macOS .app format.  The spec lists all hidden imports that
PyInstaller cannot detect automatically (dynamic imports used by
docker, keyring, playwright, plyer, etc.) and includes data files
such as the default AGENTS.md template and the resources/ directory
(application icon, Info.plist template).

Before building, generate the icon assets:
    python3 scripts/generate_icon.py        # creates resources/icon.png
    ./scripts/generate_icns.sh              # creates resources/icon.icns (macOS only)

Usage:
    pyinstaller zephyr.spec --clean
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

# Read version from _version.py so builds pick up the CI-patched value.
_version_file = os.path.join(os.path.abspath(SPECPATH) if "SPECPATH" in dir() else os.path.abspath("."), "src", "lib", "_version.py")
_version_ns: dict = {}
with open(_version_file, encoding="utf-8") as _vf:
    exec(compile(_vf.read(), _version_file, "exec"), _version_ns)  # noqa: S102
APP_VERSION = _version_ns["__version__"]

block_cipher = None

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = os.path.abspath(SPECPATH) if "SPECPATH" in dir() else os.path.abspath(".")
SRC_DIR = os.path.join(PROJECT_ROOT, "src")

# ---------------------------------------------------------------------------
# Data files: (source, destination_in_bundle)
# ---------------------------------------------------------------------------
datas = [
    (os.path.join(PROJECT_ROOT, "AGENTS.md"), "."),
]

# Include resources directory if it exists (icon, Info.plist, etc.)
resources_dir = os.path.join(PROJECT_ROOT, "resources")
if os.path.isdir(resources_dir):
    datas.append((resources_dir, "resources"))

# Collect ALL PyQt6 files: Python modules, C extensions, Qt frameworks,
# and platform plugins (e.g. libqcocoa.dylib on macOS).
_pyqt6_datas, _pyqt6_binaries, _pyqt6_hiddenimports = collect_all("PyQt6")
datas += _pyqt6_datas
binaries = _pyqt6_binaries

# ---------------------------------------------------------------------------
# Hidden imports
# PyInstaller's static analysis misses these because they are loaded
# dynamically at runtime (e.g. docker transport backends, keyring backends,
# plyer platform facades, PyQt6 plugins).
# ---------------------------------------------------------------------------
hiddenimports = _pyqt6_hiddenimports + [
    # Docker SDK — transport backends are selected at runtime
    "docker",
    "docker.transport",
    "docker.transport.unixconn",
    "docker.transport.npipeconn",
    "docker.transport.sshadapter",
    "docker.models",
    "docker.models.containers",
    "docker.models.images",
    "docker.api",
    # GitPython
    "git",
    "git.repo",
    "git.exc",
    # Keyring — backend discovery is dynamic
    "keyring",
    "keyring.backends",
    "keyring.backends.SecretService",
    "keyring.backends.macOS",
    "keyring.backends.Windows",
    "keyring.backends.null",
    # Plyer — platform notification facade loaded at runtime
    "plyer",
    "plyer.platforms",
    "plyer.platforms.macosx",
    "plyer.platforms.macosx.notification",
    "plyer.platforms.linux",
    "plyer.platforms.linux.notification",
    "plyer.platforms.win",
    "plyer.platforms.win.notification",
    # Playwright
    "playwright",
    "playwright.sync_api",
    # Anthropic SDK
    "anthropic",
    # Application modules
    "src",
    "src.lib",
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
    "src.main",
    "src.ui",
    "src.ui.main_window",
    "src.ui.projects_tab",
    "src.ui.project_dialog",
    "src.ui.loops_tab",
    "src.ui.settings_tab",
    "src.ui.credential_dialog",
]

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(
    [os.path.join(PROJECT_ROOT, "launcher.py")],
    pathex=[PROJECT_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "pytest_qt",
        "pytest_mock",
        "black",
        "pylint",
        "_pytest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ---------------------------------------------------------------------------
# Executable
# ---------------------------------------------------------------------------
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Zephyr",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="Zephyr",
)

# ---------------------------------------------------------------------------
# macOS .app bundle (skipped on Linux / Windows where BUNDLE is unavailable)
# ---------------------------------------------------------------------------
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="Zephyr.app",
        icon=os.path.join(resources_dir, "icon.icns") if os.path.isfile(os.path.join(resources_dir, "icon.icns")) else None,
        bundle_identifier="com.zephyr.desktop",
        info_plist={
            "CFBundleName": "Zephyr",
            "CFBundleDisplayName": "Zephyr Desktop",
            "CFBundleVersion": APP_VERSION,
            "CFBundleShortVersionString": APP_VERSION,
            "LSMinimumSystemVersion": "15.0",
            "NSHumanReadableCopyright": "Copyright 2025 Zephyr Contributors. MIT License.",
            "NSHighResolutionCapable": True,
        },
    )
