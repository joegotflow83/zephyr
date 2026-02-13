"""Tests for loop execution models: LoopMode, LoopStatus, LoopState.

Validates enum values, dataclass defaults, serialization round-trips,
and graceful handling of missing optional fields during deserialization.
"""

import pytest
from src.lib.loop_runner import LoopMode, LoopState, LoopStatus


# ---------------------------------------------------------------------------
# LoopMode enum
# ---------------------------------------------------------------------------

class TestLoopMode:
    def test_single_value(self):
        assert LoopMode.SINGLE.value == "single"

    def test_continuous_value(self):
        assert LoopMode.CONTINUOUS.value == "continuous"

    def test_scheduled_value(self):
        assert LoopMode.SCHEDULED.value == "scheduled"

    def test_member_count(self):
        assert len(LoopMode) == 3

    def test_from_value(self):
        assert LoopMode("single") is LoopMode.SINGLE
        assert LoopMode("continuous") is LoopMode.CONTINUOUS
        assert LoopMode("scheduled") is LoopMode.SCHEDULED

    def test_invalid_value_raises(self):
        with pytest.raises(ValueError):
            LoopMode("invalid")


# ---------------------------------------------------------------------------
# LoopStatus enum
# ---------------------------------------------------------------------------

class TestLoopStatus:
    def test_idle_value(self):
        assert LoopStatus.IDLE.value == "idle"

    def test_starting_value(self):
        assert LoopStatus.STARTING.value == "starting"

    def test_running_value(self):
        assert LoopStatus.RUNNING.value == "running"

    def test_paused_value(self):
        assert LoopStatus.PAUSED.value == "paused"

    def test_stopping_value(self):
        assert LoopStatus.STOPPING.value == "stopping"

    def test_stopped_value(self):
        assert LoopStatus.STOPPED.value == "stopped"

    def test_failed_value(self):
        assert LoopStatus.FAILED.value == "failed"

    def test_completed_value(self):
        assert LoopStatus.COMPLETED.value == "completed"

    def test_member_count(self):
        assert len(LoopStatus) == 8

    def test_from_value(self):
        for member in LoopStatus:
            assert LoopStatus(member.value) is member

    def test_invalid_value_raises(self):
        with pytest.raises(ValueError):
            LoopStatus("nonexistent")


# ---------------------------------------------------------------------------
# LoopState dataclass — construction & defaults
# ---------------------------------------------------------------------------

class TestLoopStateDefaults:
    def test_minimal_construction(self):
        """Only project_id is required; everything else has a default."""
        state = LoopState(project_id="abc123")
        assert state.project_id == "abc123"
        assert state.container_id is None
        assert state.mode is LoopMode.SINGLE
        assert state.status is LoopStatus.IDLE
        assert state.iteration == 0
        assert state.started_at is None
        assert state.last_log == ""
        assert state.commits_detected == []
        assert state.error is None

    def test_full_construction(self):
        state = LoopState(
            project_id="proj-1",
            container_id="cid-abc",
            mode=LoopMode.CONTINUOUS,
            status=LoopStatus.RUNNING,
            iteration=5,
            started_at="2025-01-15T10:00:00+00:00",
            last_log="Building project...",
            commits_detected=["a1b2c3", "d4e5f6"],
            error=None,
        )
        assert state.project_id == "proj-1"
        assert state.container_id == "cid-abc"
        assert state.mode is LoopMode.CONTINUOUS
        assert state.status is LoopStatus.RUNNING
        assert state.iteration == 5
        assert state.started_at == "2025-01-15T10:00:00+00:00"
        assert state.last_log == "Building project..."
        assert state.commits_detected == ["a1b2c3", "d4e5f6"]
        assert state.error is None

    def test_commits_detected_not_shared(self):
        """Each instance gets its own list (no mutable default sharing)."""
        s1 = LoopState(project_id="a")
        s2 = LoopState(project_id="b")
        s1.commits_detected.append("hash1")
        assert s2.commits_detected == []

    def test_failed_state_with_error(self):
        state = LoopState(
            project_id="proj-2",
            status=LoopStatus.FAILED,
            error="Container exited with code 137",
        )
        assert state.status is LoopStatus.FAILED
        assert state.error == "Container exited with code 137"


# ---------------------------------------------------------------------------
# LoopState serialization — to_dict
# ---------------------------------------------------------------------------

class TestLoopStateToDict:
    def test_minimal_to_dict(self):
        state = LoopState(project_id="p1")
        d = state.to_dict()
        assert d == {
            "project_id": "p1",
            "container_id": None,
            "mode": "single",
            "status": "idle",
            "iteration": 0,
            "started_at": None,
            "last_log": "",
            "commits_detected": [],
            "error": None,
        }

    def test_full_to_dict(self):
        state = LoopState(
            project_id="proj-x",
            container_id="ctr-999",
            mode=LoopMode.SCHEDULED,
            status=LoopStatus.COMPLETED,
            iteration=10,
            started_at="2025-06-01T08:00:00Z",
            last_log="Done.",
            commits_detected=["abc", "def"],
            error=None,
        )
        d = state.to_dict()
        assert d["project_id"] == "proj-x"
        assert d["container_id"] == "ctr-999"
        assert d["mode"] == "scheduled"
        assert d["status"] == "completed"
        assert d["iteration"] == 10
        assert d["started_at"] == "2025-06-01T08:00:00Z"
        assert d["last_log"] == "Done."
        assert d["commits_detected"] == ["abc", "def"]
        assert d["error"] is None

    def test_to_dict_returns_copy_of_commits(self):
        """Mutating the returned dict must not affect the original state."""
        state = LoopState(project_id="p", commits_detected=["h1"])
        d = state.to_dict()
        d["commits_detected"].append("h2")
        assert state.commits_detected == ["h1"]

    def test_to_dict_values_are_json_serializable(self):
        """All values in to_dict() must be JSON-compatible primitives."""
        import json

        state = LoopState(
            project_id="p",
            mode=LoopMode.CONTINUOUS,
            status=LoopStatus.RUNNING,
            commits_detected=["x"],
        )
        # Should not raise
        serialized = json.dumps(state.to_dict())
        assert isinstance(serialized, str)


# ---------------------------------------------------------------------------
# LoopState deserialization — from_dict
# ---------------------------------------------------------------------------

class TestLoopStateFromDict:
    def test_full_round_trip(self):
        original = LoopState(
            project_id="rt-1",
            container_id="ctr-rt",
            mode=LoopMode.CONTINUOUS,
            status=LoopStatus.PAUSED,
            iteration=7,
            started_at="2025-03-20T12:00:00Z",
            last_log="Paused by user",
            commits_detected=["aaa", "bbb", "ccc"],
            error=None,
        )
        rebuilt = LoopState.from_dict(original.to_dict())
        assert rebuilt.project_id == original.project_id
        assert rebuilt.container_id == original.container_id
        assert rebuilt.mode is original.mode
        assert rebuilt.status is original.status
        assert rebuilt.iteration == original.iteration
        assert rebuilt.started_at == original.started_at
        assert rebuilt.last_log == original.last_log
        assert rebuilt.commits_detected == original.commits_detected
        assert rebuilt.error == original.error

    def test_minimal_dict(self):
        """from_dict with only project_id uses defaults for everything else."""
        state = LoopState.from_dict({"project_id": "min-1"})
        assert state.project_id == "min-1"
        assert state.container_id is None
        assert state.mode is LoopMode.SINGLE
        assert state.status is LoopStatus.IDLE
        assert state.iteration == 0
        assert state.started_at is None
        assert state.last_log == ""
        assert state.commits_detected == []
        assert state.error is None

    def test_missing_optional_fields(self):
        """Partial dicts should populate missing fields with defaults."""
        data = {
            "project_id": "partial",
            "mode": "continuous",
            "iteration": 3,
        }
        state = LoopState.from_dict(data)
        assert state.mode is LoopMode.CONTINUOUS
        assert state.iteration == 3
        assert state.status is LoopStatus.IDLE
        assert state.container_id is None
        assert state.last_log == ""

    def test_missing_project_id_raises(self):
        """project_id is mandatory — KeyError if absent."""
        with pytest.raises(KeyError):
            LoopState.from_dict({})

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError):
            LoopState.from_dict({"project_id": "x", "mode": "bogus"})

    def test_invalid_status_raises(self):
        with pytest.raises(ValueError):
            LoopState.from_dict({"project_id": "x", "status": "bogus"})

    def test_round_trip_with_error(self):
        original = LoopState(
            project_id="err-1",
            status=LoopStatus.FAILED,
            error="OOM killed",
        )
        rebuilt = LoopState.from_dict(original.to_dict())
        assert rebuilt.status is LoopStatus.FAILED
        assert rebuilt.error == "OOM killed"

    def test_round_trip_all_modes(self):
        for mode in LoopMode:
            state = LoopState(project_id="m", mode=mode)
            rebuilt = LoopState.from_dict(state.to_dict())
            assert rebuilt.mode is mode

    def test_round_trip_all_statuses(self):
        for status in LoopStatus:
            state = LoopState(project_id="s", status=status)
            rebuilt = LoopState.from_dict(state.to_dict())
            assert rebuilt.status is status

    def test_from_dict_does_not_mutate_input(self):
        data = {
            "project_id": "immut",
            "commits_detected": ["h1"],
        }
        original_commits = list(data["commits_detected"])
        state = LoopState.from_dict(data)
        state.commits_detected.append("h2")
        assert data["commits_detected"] == original_commits
