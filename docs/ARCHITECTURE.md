# Architecture

Status: Phase 0 contract draft pending bounded architecture review.

The target system consists of a Next.js web application, FastAPI service, PostgreSQL database, Redis/Celery worker system, generated TypeScript API client, and isolated adapters for Supabase Auth, LLM, SendGrid, and Google Calendar.

Detailed runtime boundaries, transaction paths, trust boundaries, and deployment topology will be frozen before feature implementation.
