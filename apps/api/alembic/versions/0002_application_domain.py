"""Add the application domain, clinical source, and integration state tables."""

# ruff: noqa: E501

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0002_application_domain"
down_revision: str | None = "0001_booking_foundation"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # These columns are deliberately added after the foundation revision so the
    # migration remains linear and existing Phase 1 rows remain valid.
    op.add_column(
        "patient_profiles",
        sa.Column("timezone", sa.Text(), nullable=False, server_default=sa.text("'UTC'")),
    )
    op.add_column("patient_profiles", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_check_constraint("ck_patient_profiles_version", "patient_profiles", "version > 0")
    op.add_column("doctors", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_check_constraint("ck_doctors_version", "doctors", "version > 0")
    op.add_column("doctor_leave", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_check_constraint("ck_doctor_leave_version", "doctor_leave", "version > 0")
    op.add_column("appointments", sa.Column("urgency", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_appointments_urgency",
        "appointments",
        "urgency IS NULL OR urgency IN ('routine', 'soon', 'urgent')",
    )
    op.add_column("outbox_events", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column(
        "outbox_events",
        sa.Column("correlation_id", sa.Text(), nullable=False, server_default=sa.text("'system'")),
    )
    op.create_check_constraint("ck_outbox_version", "outbox_events", "version > 0")

    op.create_table(
        "symptom_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("symptoms_text", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False, server_default=sa.text("'patient'")),
        sa.Column("created_by_actor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", "version", name="uq_symptom_versions_appointment"),
        sa.CheckConstraint("version > 0", name="ck_symptom_versions_version"),
        sa.CheckConstraint("source IN ('patient', 'imported')", name="ck_symptom_versions_source"),
    )
    op.create_index("ix_symptom_versions_appointment", "symptom_versions", ["appointment_id", "version"])

    op.create_table(
        "visits",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=False),
        sa.Column("doctor_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("urgency", sa.Text(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", name="uq_visits_appointment"),
        sa.CheckConstraint("status IN ('draft', 'completed')", name="ck_visits_status"),
        sa.CheckConstraint("version > 0", name="ck_visits_version"),
        sa.CheckConstraint("urgency IS NULL OR urgency IN ('routine', 'soon', 'urgent')", name="ck_visits_urgency"),
    )
    op.create_index("ix_visits_doctor_status", "visits", ["doctor_id", "status"])

    op.create_table(
        "visit_note_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("visit_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("notes_text", sa.Text(), nullable=False),
        sa.Column("author_actor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["author_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("visit_id", "version", name="uq_visit_note_versions_visit"),
        sa.CheckConstraint("version > 0", name="ck_visit_note_versions_version"),
    )
    op.create_index("ix_visit_note_versions_visit", "visit_note_versions", ["visit_id", "version"])

    op.create_table(
        "prescriptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("visit_id", sa.UUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'draft'")),
        sa.Column("advisory_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("visit_id", name="uq_prescriptions_visit"),
        sa.CheckConstraint("version > 0", name="ck_prescriptions_version"),
        sa.CheckConstraint("status IN ('draft', 'completed')", name="ck_prescriptions_status"),
    )

    op.create_table(
        "prescription_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("prescription_id", sa.UUID(), nullable=False),
        sa.Column("medication_name", sa.Text(), nullable=False),
        sa.Column("dosage", sa.Text(), nullable=False),
        sa.Column("route", sa.Text(), nullable=True),
        sa.Column("frequency", sa.Text(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("duration_days", sa.Integer(), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("prescriber_actor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["prescription_id"], ["prescriptions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prescriber_actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "frequency IN ('once_daily', 'twice_daily', 'three_times_daily', 'every_4_hours', 'as_needed')",
            name="ck_prescription_items_frequency",
        ),
        sa.CheckConstraint("duration_days IS NULL OR duration_days BETWEEN 1 AND 3650", name="ck_prescription_items_duration"),
        sa.CheckConstraint("end_date IS NULL OR end_date >= start_date", name="ck_prescription_items_dates"),
    )
    op.create_index("ix_prescription_items_prescription", "prescription_items", ["prescription_id"])

    op.create_table(
        "generated_artifacts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=True),
        sa.Column("visit_id", sa.UUID(), nullable=True),
        sa.Column("artifact_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("source_record_type", sa.Text(), nullable=False),
        sa.Column("source_record_id", sa.UUID(), nullable=False),
        sa.Column("source_versions", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("task_version", sa.Text(), nullable=False, server_default=sa.text("'v1'")),
        sa.Column("provider", sa.Text(), nullable=True),
        sa.Column("model", sa.Text(), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["visit_id"], ["visits.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("artifact_type IN ('pre_visit_brief', 'post_visit_summary')", name="ck_generated_artifacts_type"),
        sa.CheckConstraint("status IN ('pending', 'succeeded', 'failed')", name="ck_generated_artifacts_status"),
        sa.CheckConstraint("appointment_id IS NOT NULL OR visit_id IS NOT NULL", name="ck_generated_artifacts_owner"),
    )
    op.create_index("ix_generated_artifacts_appointment", "generated_artifacts", ["appointment_id", "artifact_type"])
    op.create_index("ix_generated_artifacts_visit", "generated_artifacts", ["visit_id", "artifact_type"])

    op.create_table(
        "reminder_preferences",
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("channel", sa.Text(), nullable=False, server_default=sa.text("'email'")),
        sa.Column("timezone", sa.Text(), nullable=False, server_default=sa.text("'UTC'")),
        sa.Column("local_times", sa.ARRAY(sa.Time()), nullable=False, server_default=sa.text("ARRAY['09:00']::time[]")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["patient_id"], ["patient_profiles.actor_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("patient_id"),
        sa.CheckConstraint("channel IN ('email', 'sms', 'push')", name="ck_reminder_preferences_channel"),
        sa.CheckConstraint("version > 0", name="ck_reminder_preferences_version"),
    )

    op.create_table(
        "reminder_occurrences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("prescription_item_id", sa.UUID(), nullable=False),
        sa.Column("prescription_version", sa.Integer(), nullable=False),
        sa.Column("occurrence_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["prescription_item_id"], ["prescription_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
        sa.CheckConstraint("status IN ('pending', 'sent', 'cancelled', 'failed')", name="ck_reminder_occurrences_status"),
    )
    op.create_index("ix_reminder_occurrences_due", "reminder_occurrences", ["status", "occurrence_at"])

    op.create_table(
        "integration_operations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=True),
        sa.Column("outbox_event_id", sa.UUID(), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("provider_reference", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["outbox_event_id"], ["outbox_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("outbox_event_id", "channel", name="uq_integration_operations_event_channel"),
        sa.CheckConstraint("state IN ('pending', 'succeeded', 'retrying', 'failed')", name="ck_integration_operations_state"),
        sa.CheckConstraint("version > 0", name="ck_integration_operations_version"),
    )
    op.create_index("ix_integration_operations_state", "integration_operations", ["channel", "state", "updated_at"])

    op.create_table(
        "appointment_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("appointment_id", sa.UUID(), nullable=False),
        sa.Column("from_status", sa.Text(), nullable=True),
        sa.Column("to_status", sa.Text(), nullable=False),
        sa.Column("old_starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("old_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["appointment_id"], ["appointments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["actors.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_appointment_history_appointment", "appointment_history", ["appointment_id", "created_at"])

    op.create_table(
        "leave_previews",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("doctor_id", sa.UUID(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expected_schedule_version", sa.Integer(), nullable=False),
        sa.Column("affected_hold_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("affected_appointment_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_actor_id", sa.UUID(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_actor_id"], ["actors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
        sa.CheckConstraint("starts_at < ends_at", name="ck_leave_previews_interval"),
        sa.CheckConstraint("expected_schedule_version > 0", name="ck_leave_previews_schedule_version"),
    )
    op.create_index("ix_leave_previews_doctor_expiry", "leave_previews", ["doctor_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_leave_previews_doctor_expiry", table_name="leave_previews")
    op.drop_table("leave_previews")
    op.drop_index("ix_appointment_history_appointment", table_name="appointment_history")
    op.drop_table("appointment_history")
    op.drop_index("ix_integration_operations_state", table_name="integration_operations")
    op.drop_table("integration_operations")
    op.drop_index("ix_reminder_occurrences_due", table_name="reminder_occurrences")
    op.drop_table("reminder_occurrences")
    op.drop_table("reminder_preferences")
    op.drop_index("ix_generated_artifacts_visit", table_name="generated_artifacts")
    op.drop_index("ix_generated_artifacts_appointment", table_name="generated_artifacts")
    op.drop_table("generated_artifacts")
    op.drop_index("ix_prescription_items_prescription", table_name="prescription_items")
    op.drop_table("prescription_items")
    op.drop_table("prescriptions")
    op.drop_index("ix_visit_note_versions_visit", table_name="visit_note_versions")
    op.drop_table("visit_note_versions")
    op.drop_index("ix_visits_doctor_status", table_name="visits")
    op.drop_table("visits")
    op.drop_index("ix_symptom_versions_appointment", table_name="symptom_versions")
    op.drop_table("symptom_versions")
    op.drop_constraint("ck_outbox_version", "outbox_events", type_="check")
    op.drop_column("outbox_events", "correlation_id")
    op.drop_column("outbox_events", "version")
    op.drop_constraint("ck_appointments_urgency", "appointments", type_="check")
    op.drop_column("appointments", "urgency")
    op.drop_constraint("ck_doctor_leave_version", "doctor_leave", type_="check")
    op.drop_column("doctor_leave", "version")
    op.drop_column("patient_profiles", "timezone")
    op.drop_constraint("ck_patient_profiles_version", "patient_profiles", type_="check")
    op.drop_column("patient_profiles", "version")
    op.drop_constraint("ck_doctors_version", "doctors", type_="check")
    op.drop_column("doctors", "version")
