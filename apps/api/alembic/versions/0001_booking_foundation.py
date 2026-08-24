"""Create the Phase 1 PostgreSQL booking foundation."""

# SQL DDL is intentionally kept readable as migration statements.
# ruff: noqa: E501

from collections.abc import Sequence

from alembic import op

revision: str = "0001_booking_foundation"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.execute(
        """
        CREATE TABLE actors (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            subject_id text NOT NULL UNIQUE,
            role text NOT NULL CHECK (role IN ('patient', 'doctor', 'admin')),
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE patient_profiles (
            actor_id uuid PRIMARY KEY REFERENCES actors(id) ON DELETE RESTRICT,
            display_name text NOT NULL DEFAULT 'Patient',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE doctors (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_id uuid NOT NULL UNIQUE REFERENCES actors(id) ON DELETE RESTRICT,
            display_name text NOT NULL,
            credentials text,
            specialization text,
            timezone text NOT NULL DEFAULT 'UTC',
            appointment_durations_minutes integer[] NOT NULL DEFAULT ARRAY[30]::integer[],
            is_active boolean NOT NULL DEFAULT true,
            schedule_version integer NOT NULL DEFAULT 1 CHECK (schedule_version > 0),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE doctor_working_hours (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
            weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
            starts_local time NOT NULL,
            ends_local time NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (starts_local < ends_local),
            UNIQUE (doctor_id, weekday, starts_local, ends_local)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_working_hours_doctor_weekday ON doctor_working_hours (doctor_id, weekday)"
    )
    op.execute(
        """
        CREATE TABLE doctor_leave (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            reason text,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (starts_at < ends_at)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_doctor_leave_doctor_interval ON doctor_leave (doctor_id, starts_at, ends_at)"
    )
    op.execute(
        """
        CREATE TABLE slot_holds (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            patient_id uuid NOT NULL REFERENCES patient_profiles(actor_id) ON DELETE RESTRICT,
            doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            slot_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
            expires_at timestamptz NOT NULL,
            status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'converted')),
            version integer NOT NULL DEFAULT 1 CHECK (version > 0),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (starts_at < ends_at),
            EXCLUDE USING gist (doctor_id WITH =, slot_range WITH &&) WHERE (status = 'active')
        )
        """
    )
    op.execute("CREATE INDEX ix_slot_holds_patient_status ON slot_holds (patient_id, status)")
    op.execute(
        "CREATE INDEX ix_slot_holds_doctor_status_expiry ON slot_holds (doctor_id, status, expires_at)"
    )
    op.execute(
        """
        CREATE TABLE appointments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            patient_id uuid NOT NULL REFERENCES patient_profiles(actor_id) ON DELETE RESTRICT,
            doctor_id uuid NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
            starts_at timestamptz NOT NULL,
            ends_at timestamptz NOT NULL,
            slot_range tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
            status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'in_progress', 'completed', 'cancelled_patient', 'cancelled_doctor', 'cancelled_admin', 'cancelled_doctor_leave')),
            symptoms_text text NOT NULL,
            version integer NOT NULL DEFAULT 1 CHECK (version > 0),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CHECK (starts_at < ends_at),
            EXCLUDE USING gist (doctor_id WITH =, slot_range WITH &&) WHERE (status IN ('confirmed', 'in_progress'))
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_appointments_patient_starts ON appointments (patient_id, starts_at)"
    )
    op.execute("CREATE INDEX ix_appointments_doctor_starts ON appointments (doctor_id, starts_at)")
    op.execute("CREATE INDEX ix_appointments_status_starts ON appointments (status, starts_at)")
    op.execute(
        """
        CREATE TABLE idempotency_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
            method varchar(8) NOT NULL,
            route_template text NOT NULL,
            idempotency_key text NOT NULL,
            request_fingerprint varchar(64) NOT NULL,
            status_code integer,
            response_body jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz,
            UNIQUE (actor_id, method, route_template, idempotency_key)
        )
        """
    )
    op.execute("CREATE INDEX ix_idempotency_created_at ON idempotency_records (created_at)")
    op.execute(
        """
        CREATE TABLE outbox_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            event_type text NOT NULL,
            aggregate_type text NOT NULL,
            aggregate_id uuid NOT NULL,
            appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
            dedupe_key text NOT NULL,
            payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'retrying', 'failed')),
            attempt_count integer NOT NULL DEFAULT 0,
            next_attempt_at timestamptz NOT NULL DEFAULT now(),
            last_error_code text,
            created_at timestamptz NOT NULL DEFAULT now(),
            processed_at timestamptz,
            UNIQUE (event_type, aggregate_type, aggregate_id, dedupe_key)
        )
        """
    )
    op.execute("CREATE INDEX ix_outbox_appointment_id ON outbox_events (appointment_id)")
    op.execute("CREATE INDEX ix_outbox_claimable ON outbox_events (status, next_attempt_at)")
    op.execute(
        """
        CREATE TABLE audit_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            actor_id uuid REFERENCES actors(id) ON DELETE SET NULL,
            action text NOT NULL,
            resource_type text NOT NULL,
            resource_id uuid,
            request_id text,
            outcome text NOT NULL,
            reason jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_audit_events_resource ON audit_events (resource_type, resource_id, created_at)"
    )
    op.execute("CREATE INDEX ix_audit_events_actor_created ON audit_events (actor_id, created_at)")
    op.execute(
        """
        CREATE FUNCTION reject_audit_mutation() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_events are immutable';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_immutable
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events")
    op.execute("DROP FUNCTION IF EXISTS reject_audit_mutation()")
    op.drop_table("audit_events")
    op.drop_table("outbox_events")
    op.drop_table("idempotency_records")
    op.drop_table("appointments")
    op.drop_table("slot_holds")
    op.drop_table("doctor_leave")
    op.drop_table("doctor_working_hours")
    op.drop_table("doctors")
    op.drop_table("patient_profiles")
    op.drop_table("actors")
