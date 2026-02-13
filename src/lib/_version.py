"""Single source of truth for Zephyr Desktop version.

This file is patched by the CI/CD release workflow at build time.
The release workflow extracts the version from the git tag (e.g. v0.2.0 -> 0.2.0)
and writes it here before building distributable packages.
"""

__version__ = "0.1.0"
