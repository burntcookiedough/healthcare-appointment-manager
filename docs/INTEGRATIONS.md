# External integration setup

These steps describe configuration that a deployment operator may perform later. No
provider account is configured, no secret is committed, and no hosted URL is implied by
this repository. Phase 1 uses deterministic fake adapters, so local booking and worker
tests do not require external network calls.

## Google Cloud OAuth 2.0 and Calendar

The application should use a server-side OAuth flow. The browser never receives a
client secret or refresh token, and Calendar is only a projection of an appointment.

1. Create or select a Google Cloud project dedicated to the environment. Record the
   project ID in the deployment secret store, not in source.
2. In **APIs & Services → Library**, enable **Google Calendar API**.
3. In **OAuth consent screen**, choose the organization-appropriate user type, add the
   application name/support contact, and configure the privacy/terms URLs required by
   the environment. Add only the Calendar scope needed by the reviewed feature:
   `https://www.googleapis.com/auth/calendar.events`. Keep the app in testing while
   validating and add synthetic operator accounts as test users.
4. In **Credentials → Create credentials → OAuth client ID**, choose **Web application**.
   Add exact HTTPS redirect URIs for every environment. The local placeholder is
   `http://localhost:8000/api/v1/integrations/google/callback`; replace the hosted
   origin after deployment. Google compares the URI byte-for-byte, including path and
   scheme.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   `GOOGLE_REDIRECT_URI` in the API/worker secret store. Leave
   `GOOGLE_REFRESH_TOKEN` blank until a user completes consent.
6. The future API integration route generates a state/CSRF value, sends the user to
   Google's authorization endpoint with `access_type=offline` and an explicit consent
   policy, validates the returned state, exchanges the code server-side, and stores the
   refresh token encrypted. It must not put the code, token, symptoms, notes, or
   prescription in a URL or queue payload.
7. Set `GOOGLE_CALENDAR_ID` to `primary` for the connected account or to an
   explicitly shared calendar ID. Confirm the account has permission to create/update
   events. Calendar titles and descriptions contain only minimum scheduling data; never
   include clinical text.
8. Run a synthetic appointment through the adapter with a deterministic idempotency key.
   The same logical operation must upsert one event, record the provider event ID and
   status, and retry without creating duplicates. A Calendar outage leaves the
   PostgreSQL appointment confirmed.
9. Before production, review OAuth verification, consent, token encryption/key
   rotation, revocation handling, calendar reconciliation, and data-retention policy.

Current state: no Google OAuth route or real adapter exists. The worker's
`DeterministicFakeGoogleCalendarAdapter` is the only executable implementation.

## SendGrid

1. Create a SendGrid account/project for the environment and complete sender/domain
   authentication (SPF/DKIM) before sending mail.
2. Create a restricted API key with only **Mail Send** permission. Copy it once into
   the platform secret store as `SENDGRID_API_KEY`; never commit it or expose it as
   `NEXT_PUBLIC_*`.
3. Verify a sender address and set `SENDGRID_FROM_EMAIL` to that exact address.
   The local placeholder `notifications@example.invalid` is intentionally unusable.
4. Create/version notification templates outside the application source or use the
   approved template registry. Queue payloads should carry an opaque template key and
   appointment/event ID; render recipient and body data inside the server-side adapter.
5. Configure suppression, bounce, unsubscribe, rate limits, and a monitored sender
   identity. Do not send clinical text in subject lines, previews, or provider logs.
6. Exercise transient failure, permanent rejection, and redelivery with fake adapters.
   A transient failure records an attempt and retry time; a terminal failure remains
   visible for an authorized operator retry. Neither changes appointment validity.

Current state: no SendGrid adapter or durable dispatcher is wired. The worker's fake
email adapter validates result/idempotency behavior without network access.

## LLM provider

1. Choose a provider/model only after privacy, data-processing, retention, residency,
   and clinical-safety review. Create a project-scoped key with the narrowest available
   permissions and store it as `LLM_API_KEY`.
2. Set `LLM_PROVIDER`, `LLM_MODEL`, and bounded `LLM_TIMEOUT_SECONDS` in the worker
   secret/config store. Keep `LLM_PROVIDER=none` and the key blank for local fake
   operation.
3. Register the exact prompt and schema versions from
   [`LLM_PROMPTS.md`](LLM_PROMPTS.md). Pin a model/version where the provider allows it;
   a prompt or schema change requires a new version and evaluation evidence.
4. Implement the adapter behind `ClinicalLLMPort`. It receives an authorized source
   reference, fetches the minimum necessary text server-side, strips direct
   identifiers, requests provider-native structured JSON, validates the response
   again, and stores only the approved generated artifact/provenance fields.
5. Set provider timeouts and normalize timeout/network/429/5xx as retryable; normalize
   refusal, invalid JSON/schema, unsafe content, and unauthorized/missing source as
   terminal. Use the bounded worker backoff and the outbox event UUID as idempotency
   key when the provider supports it.
6. Test prompt-injection text, empty/long input, unsupported language, refusal, timeout,
   malformed output, and duplicate delivery with synthetic fixtures. Generated output
   must be labeled advisory; it cannot diagnose, prescribe, change notes, or create
   reminders.
7. Confirm the UI shows original symptoms/notes when generation is pending, unavailable,
   or failed. A provider outage must never block booking, saving notes, or completing a
   visit.

Current state: no real LLM adapter, prompt endpoint, or generated-artifact migration is
present. The deterministic fake clinical adapter only returns normalized success/retry/
terminal outcomes.

## Secret and operational checklist

- Configure one secret per environment; do not share local/demo secrets with hosted
  environments.
- Keep OAuth refresh tokens, provider keys, database URLs, and Redis URLs server-side.
- Use TLS/private URLs for hosted database/Redis connections.
- Redact provider exception text and all clinical/identity fields from logs.
- Grant the worker only the provider permissions it needs; the web process receives no
  provider secret.
- Record provider status separately from appointment/visit status and expose only safe
  error codes through API integration-health views.
- Revoke and rotate a credential immediately if it appears in a commit, log, screenshot,
  queue payload, or browser bundle.
