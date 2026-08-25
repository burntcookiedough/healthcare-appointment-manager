"""Persist doctor-authored follow-up instructions on visits."""

# ruff: noqa: E501

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_visit_follow_up_instructions"
down_revision: str | None = "0002_application_domain"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("visits", sa.Column("follow_up_instructions", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_visits_follow_up_instructions_length",
        "visits",
        "follow_up_instructions IS NULL OR char_length(follow_up_instructions) <= 10000",
    )


def downgrade() -> None:
    op.drop_constraint("ck_visits_follow_up_instructions_length", "visits", type_="check")
    op.drop_column("visits", "follow_up_instructions")
