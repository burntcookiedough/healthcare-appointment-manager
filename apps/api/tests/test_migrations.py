from pathlib import Path

from alembic.script import ScriptDirectory


def test_alembic_revision_ids_fit_version_column_and_have_one_head() -> None:
    script = ScriptDirectory(str(Path(__file__).resolve().parents[1] / "alembic"))
    revisions = list(script.walk_revisions())
    revision_ids = [revision.revision for revision in revisions]

    assert revision_ids
    assert all(len(revision_id) <= 32 for revision_id in revision_ids), revision_ids
    assert len(script.get_heads()) == 1
