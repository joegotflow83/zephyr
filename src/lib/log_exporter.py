"""Log export functionality for Zephyr Desktop.

Exports loop logs as timestamped text files, individually or as a
zip archive of all active loops.  Used by the UI's export action
so users can share or archive session output.
"""

import zipfile
from datetime import datetime, timezone
from pathlib import Path

from src.lib.loop_runner import LoopState


class LogExporter:
    """Exports loop log content to disk as text files or zip archives."""

    @staticmethod
    def export_loop_log(
        project_id: str,
        log_content: str,
        output_path: Path,
    ) -> Path:
        """Write a single loop's log to a timestamped text file.

        Args:
            project_id: UUID identifying the project.
            log_content: Full log text to write.
            output_path: Directory where the file will be created.

        Returns:
            Path to the written log file.
        """
        output_path = Path(output_path)
        output_path.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        filename = f"zephyr-{project_id}-{timestamp}.log"
        file_path = output_path / filename

        file_path.write_text(log_content, encoding="utf-8")
        return file_path

    @staticmethod
    def export_all_logs(
        states: dict[str, LoopState],
        log_contents: dict[str, str],
        output_dir: Path,
    ) -> Path:
        """Create a zip archive containing log files for every loop.

        Each entry in *log_contents* maps a project_id to its accumulated
        log text.  A summary file is prepended listing all projects and
        their current status.

        Args:
            states: Mapping of project_id -> LoopState.
            log_contents: Mapping of project_id -> full log text.
            output_dir: Directory where the zip will be created.

        Returns:
            Path to the created zip file.
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        zip_path = output_dir / f"zephyr-logs-{timestamp}.zip"

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            # Write a summary manifest
            summary_lines = ["Zephyr Desktop — Log Export Summary", ""]
            for pid, state in sorted(states.items()):
                summary_lines.append(
                    f"Project: {pid}  Status: {state.status.value}  "
                    f"Iteration: {state.iteration}  Mode: {state.mode.value}"
                )
            summary_lines.append("")
            zf.writestr("summary.txt", "\n".join(summary_lines))

            # Write individual log files
            for pid, content in sorted(log_contents.items()):
                zf.writestr(f"{pid}.log", content)

        return zip_path

    @staticmethod
    def get_default_export_path() -> Path:
        """Return the default export directory path.

        Uses ``~/Desktop/zephyr-logs-{timestamp}`` so the export
        lands somewhere the user will easily find it.
        """
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return Path.home() / "Desktop" / f"zephyr-logs-{timestamp}"
