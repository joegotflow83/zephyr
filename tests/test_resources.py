"""Tests for application icon, macOS metadata, and resource generation.

Validates that:
- resources/icon.png exists and is a valid RGBA PNG at 512x512
- resources/Info.plist exists with all required macOS keys
- scripts/generate_icns.sh exists, is executable, and targets macOS tools
- scripts/generate_icon.py can programmatically regenerate the icon
- The PyInstaller spec file references the resources directory
"""

import ast
import importlib
import os
import plistlib
import stat
import tempfile
from pathlib import Path

import pytest
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESOURCES_DIR = PROJECT_ROOT / "resources"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
SPEC_FILE = PROJECT_ROOT / "zephyr.spec"


# ---------------------------------------------------------------------------
# Icon PNG
# ---------------------------------------------------------------------------


class TestIconPng:
    """Verify resources/icon.png is a well-formed icon image."""

    def test_icon_png_exists(self):
        assert (RESOURCES_DIR / "icon.png").is_file(), "resources/icon.png must exist"

    def test_icon_is_valid_png(self):
        img = Image.open(RESOURCES_DIR / "icon.png")
        assert img.format == "PNG"

    def test_icon_is_square(self):
        img = Image.open(RESOURCES_DIR / "icon.png")
        assert img.width == img.height, "Icon must be square"

    def test_icon_minimum_size(self):
        """Icon should be at least 256x256 for clarity at standard sizes."""
        img = Image.open(RESOURCES_DIR / "icon.png")
        assert img.width >= 256

    def test_icon_size_512(self):
        """Default generated icon is 512x512."""
        img = Image.open(RESOURCES_DIR / "icon.png")
        assert img.size == (512, 512)

    def test_icon_has_alpha_channel(self):
        """RGBA mode needed for rounded corners / transparency."""
        img = Image.open(RESOURCES_DIR / "icon.png")
        assert img.mode == "RGBA"

    def test_icon_not_fully_transparent(self):
        """Sanity check — icon should have visible content."""
        img = Image.open(RESOURCES_DIR / "icon.png")
        alpha = img.split()[-1]
        assert alpha.getextrema()[1] > 0, "Icon must have non-transparent pixels"

    def test_icon_has_some_transparency(self):
        """Rounded-rect icon should have transparent corners."""
        img = Image.open(RESOURCES_DIR / "icon.png")
        alpha = img.split()[-1]
        assert (
            alpha.getextrema()[0] == 0
        ), "Icon should have transparent regions (corners)"


# ---------------------------------------------------------------------------
# Info.plist template
# ---------------------------------------------------------------------------


class TestInfoPlist:
    """Verify resources/Info.plist is a valid plist with required keys."""

    @pytest.fixture(autouse=True)
    def _load_plist(self):
        plist_path = RESOURCES_DIR / "Info.plist"
        assert plist_path.is_file(), "resources/Info.plist must exist"
        with open(plist_path, "rb") as f:
            self.plist = plistlib.load(f)

    def test_bundle_identifier(self):
        assert self.plist["CFBundleIdentifier"] == "com.zephyr.desktop"

    def test_bundle_name(self):
        assert self.plist["CFBundleName"] == "Zephyr"

    def test_bundle_display_name(self):
        assert self.plist["CFBundleDisplayName"] == "Zephyr Desktop"

    def test_bundle_version(self):
        assert self.plist["CFBundleVersion"] == "0.1.0"

    def test_bundle_short_version(self):
        assert self.plist["CFBundleShortVersionString"] == "0.1.0"

    def test_minimum_macos_version(self):
        assert self.plist["LSMinimumSystemVersion"] == "15.0"

    def test_high_resolution_capable(self):
        assert self.plist["NSHighResolutionCapable"] is True

    def test_icon_file_reference(self):
        assert self.plist["CFBundleIconFile"] == "icon.icns"

    def test_copyright_present(self):
        assert "Copyright" in self.plist["NSHumanReadableCopyright"]

    def test_executable_name(self):
        assert self.plist["CFBundleExecutable"] == "Zephyr"

    def test_package_type(self):
        assert self.plist["CFBundlePackageType"] == "APPL"

    def test_app_category(self):
        assert (
            self.plist["LSApplicationCategoryType"]
            == "public.app-category.developer-tools"
        )


# ---------------------------------------------------------------------------
# generate_icns.sh
# ---------------------------------------------------------------------------


class TestGenerateIcnsScript:
    """Verify scripts/generate_icns.sh is well-formed."""

    SCRIPT = SCRIPTS_DIR / "generate_icns.sh"

    def test_script_exists(self):
        assert self.SCRIPT.is_file(), "scripts/generate_icns.sh must exist"

    def test_script_is_executable(self):
        mode = self.SCRIPT.stat().st_mode
        assert mode & stat.S_IXUSR, "generate_icns.sh must be user-executable"

    def test_script_has_shebang(self):
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert content.startswith("#!/bin/bash")

    def test_script_uses_strict_mode(self):
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert "set -euo pipefail" in content

    def test_script_references_icon_png(self):
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert "icon.png" in content

    def test_script_references_icon_icns(self):
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert "icon.icns" in content

    def test_script_uses_iconutil(self):
        """macOS iconutil is the standard tool for .icns creation."""
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert "iconutil" in content

    def test_script_uses_sips(self):
        """macOS sips is the standard tool for image resizing."""
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert "sips" in content

    def test_script_creates_iconset_directory(self):
        """The .iconset directory is required by iconutil."""
        content = self.SCRIPT.read_text(encoding="utf-8")
        assert ".iconset" in content

    def test_script_includes_all_required_sizes(self):
        """macOS requires specific icon sizes for the iconset."""
        content = self.SCRIPT.read_text(encoding="utf-8")
        required_filenames = [
            "icon_16x16.png",
            "icon_32x32.png",
            "icon_128x128.png",
            "icon_256x256.png",
            "icon_512x512.png",
        ]
        for fname in required_filenames:
            assert fname in content, f"Missing required icon size: {fname}"


# ---------------------------------------------------------------------------
# generate_icon.py (icon generator script)
# ---------------------------------------------------------------------------


class TestGenerateIconScript:
    """Verify the icon generation script works correctly."""

    SCRIPT = SCRIPTS_DIR / "generate_icon.py"

    def test_script_exists(self):
        assert self.SCRIPT.is_file(), "scripts/generate_icon.py must exist"

    def test_generate_icon_produces_valid_image(self):
        """Import and call the generator to verify it produces a valid PNG."""
        import importlib.util

        spec = importlib.util.spec_from_file_location("generate_icon", self.SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        with tempfile.TemporaryDirectory() as tmpdir:
            out = mod.generate_icon(
                size=128, output_path=os.path.join(tmpdir, "test_icon.png")
            )
            assert out.is_file()
            img = Image.open(out)
            assert img.size == (128, 128)
            assert img.mode == "RGBA"

    def test_generate_icon_custom_size(self):
        """Generator should support arbitrary sizes."""
        import importlib.util

        spec = importlib.util.spec_from_file_location("generate_icon", self.SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        with tempfile.TemporaryDirectory() as tmpdir:
            out = mod.generate_icon(
                size=256, output_path=os.path.join(tmpdir, "icon256.png")
            )
            img = Image.open(out)
            assert img.size == (256, 256)


# ---------------------------------------------------------------------------
# Spec file resource references
# ---------------------------------------------------------------------------


class TestSpecResourceReferences:
    """Verify the PyInstaller spec references resource files."""

    @pytest.fixture(autouse=True)
    def _load_source(self):
        self.source = SPEC_FILE.read_text(encoding="utf-8")

    def test_spec_references_resources_dir(self):
        assert "resources" in self.source

    def test_spec_references_icon_icns(self):
        assert "icon.icns" in self.source

    def test_spec_references_info_plist_keys(self):
        """Key Info.plist values should be in the spec's info_plist dict."""
        assert "com.zephyr.desktop" in self.source
        assert "CFBundleName" in self.source

    def test_spec_icon_generation_docs(self):
        """Spec docstring should mention the icon generation workflow."""
        assert "generate_icon.py" in self.source
        assert "generate_icns.sh" in self.source

    def test_spec_conditional_resources(self):
        """Spec should conditionally include resources/ (for dev vs CI builds)."""
        assert "os.path.isdir(resources_dir)" in self.source

    def test_spec_conditional_icon(self):
        """Spec should conditionally set icon (file may not exist in CI)."""
        assert "os.path.isfile" in self.source
