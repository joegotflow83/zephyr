"""PyInstaller entry point for Zephyr Desktop.

Thin wrapper that bootstraps the application from the ``src`` package.
This file lives at the project root so PyInstaller treats it as a
plain top-level script rather than a module inside a package.
"""

from src.main import main

if __name__ == "__main__":
    main()
