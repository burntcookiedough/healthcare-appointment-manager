-- Synthetic local-only demo data for the current 0001/0002 application schema.
-- Run only after: cd apps/api && uv run alembic upgrade head
-- This file creates no Supabase Auth users and contains no real identity data.
-- Local API smoke checks use test:<subject_id> only when AUTH_ALLOW_LOCAL_TEST_TOKENS=true.

INSERT INTO actors (id, subject_id, role, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo.patient', 'patient', true),
  ('00000000-0000-0000-0000-000000000002', 'demo.doctor', 'doctor', true),
  ('00000000-0000-0000-0000-000000000003', 'demo.admin', 'admin', true)
ON CONFLICT (id) DO UPDATE
SET subject_id = EXCLUDED.subject_id,
    role = EXCLUDED.role,
    is_active = true;

INSERT INTO patient_profiles (actor_id, display_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Patient')
ON CONFLICT (actor_id) DO UPDATE
SET display_name = EXCLUDED.display_name;

INSERT INTO doctors (
  id,
  actor_id,
  display_name,
  credentials,
  specialization,
  timezone,
  appointment_durations_minutes,
  is_active,
  schedule_version
)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002',
  'Dr. Demo Rao',
  'MBBS',
  'General Medicine',
  'Asia/Kolkata',
  ARRAY[30, 60]::integer[],
  true,
  1
)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    credentials = EXCLUDED.credentials,
    specialization = EXCLUDED.specialization,
    timezone = EXCLUDED.timezone,
    appointment_durations_minutes = EXCLUDED.appointment_durations_minutes,
    is_active = true;

INSERT INTO doctor_working_hours (doctor_id, weekday, starts_local, ends_local)
VALUES
  ('00000000-0000-0000-0000-000000000010', 0, '09:00', '17:00'),
  ('00000000-0000-0000-0000-000000000010', 1, '09:00', '17:00'),
  ('00000000-0000-0000-0000-000000000010', 2, '09:00', '17:00'),
  ('00000000-0000-0000-0000-000000000010', 3, '09:00', '17:00'),
  ('00000000-0000-0000-0000-000000000010', 4, '09:00', '17:00')
ON CONFLICT (doctor_id, weekday, starts_local, ends_local) DO NOTHING;
