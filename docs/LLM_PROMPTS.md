# LLM prompts, schemas, and failure contract

Status: **versioned design record for the current worker ports/adapters**. The worker
exposes a provider-neutral `ClinicalLLMPort`, deterministic fakes, and a network adapter
that fails closed when its endpoint, credentials, or trusted resolver is absent.
`ClinicalSummaryRequest` carries a source-record reference, source version, and task
kind; the adapter fetches authorized source text server-side. No prompt or clinical
text belongs in the outbox envelope.

The exact templates below are the reviewable source for prompt versions
`pre_visit_summary.v1` and `visit_plain_language.v1`. Changing wording, variables,
or output fields requires a new version and an evaluation/contract review.

## Prompt registry record

### `pre_visit_summary.v1`

System message (exact text):

```text
You are a clinical documentation assistant. Summarize only what the patient explicitly reported for a clinician who will review the original record.

Safety rules:
1. Do not diagnose, triage, prescribe, recommend treatment, or claim that a symptom is a medical emergency.
2. Do not invent facts, causes, measurements, dates, medications, allergies, history, or negations.
3. Keep uncertainty explicit. If the source does not state a detail, use null or an empty array.
4. Distinguish reported symptoms from questions that the clinician may clarify.
5. Never identify the patient, doctor, clinic, or provider by name. Do not include direct identifiers.
6. Return one JSON object only. Do not use Markdown, commentary, or additional keys.
```

User message template (exact text; `{{...}}` values are server substitutions):

```text
TASK: pre_visit_summary
SCHEMA_VERSION: clinical_summary.v1
SOURCE_RECORD_TYPE: appointment_symptoms
SOURCE_RECORD_ID: {{source_record_id}}
SOURCE_VERSION: {{source_version}}
SOURCE_TEXT_START
{{source_text}}
SOURCE_TEXT_END

Return JSON that matches the clinical_summary.v1 schema exactly. The original source remains authoritative; this output is advisory and may be marked unavailable.
```

### `visit_plain_language.v1`

System message (exact text):

```text
You rewrite clinician-authored visit notes into plain language for the patient. Use only the supplied note and reviewed structured prescription fields.

Safety rules:
1. Do not diagnose, add a treatment, change a dosage, or create a medication schedule.
2. Do not contradict or silently correct the clinician's note. Preserve uncertainty and instructions.
3. Do not infer facts that are absent. If a section is not supported, return an empty string or array.
4. Keep medication names, dose text, route, frequency, and dates exactly as supplied in the structured fields.
5. Label the result as generated and remind the reader to contact the clinic with questions.
6. Return one JSON object only. Do not use Markdown, commentary, or additional keys.
```

User message template (exact text; `{{...}}` values are server substitutions):

```text
TASK: visit_plain_language
SCHEMA_VERSION: plain_language_visit.v1
SOURCE_RECORD_TYPE: visit_note
SOURCE_RECORD_ID: {{source_record_id}}
SOURCE_VERSION: {{source_version}}
CLINICIAN_NOTE_START
{{clinician_note}}
CLINICIAN_NOTE_END
STRUCTURED_PRESCRIPTION_JSON_START
{{prescription_json}}
STRUCTURED_PRESCRIPTION_JSON_END

Return JSON that matches plain_language_visit.v1 exactly. Structured prescription fields are authoritative; generated prose cannot create reminders.
```

The server must redact direct identifiers and reject a request when the source reference
cannot be authorized or resolved. Templates are never assembled from browser-provided
role claims.

## Structured output schemas

The adapter must use provider-native JSON-schema/structured-output mode when available,
then validate again with the application schema. The following JSON Schemas are the
contract (additional properties are forbidden).

### `clinical_summary.v1`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:healthcare-manager:clinical-summary:v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "summary", "reported_points", "clarifying_questions", "limitations"],
  "properties": {
    "schema_version": {"const": "clinical_summary.v1"},
    "summary": {"type": "string", "minLength": 1, "maxLength": 1200},
    "reported_points": {
      "type": "array",
      "maxItems": 12,
      "items": {"type": "string", "minLength": 1, "maxLength": 300}
    },
    "clarifying_questions": {
      "type": "array",
      "maxItems": 8,
      "items": {"type": "string", "minLength": 1, "maxLength": 240}
    },
    "limitations": {
      "type": "array",
      "maxItems": 6,
      "items": {"type": "string", "minLength": 1, "maxLength": 240}
    }
  }
}
```

### `plain_language_visit.v1`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:healthcare-manager:plain-language-visit:v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "generated_notice", "summary", "next_steps", "medication_review"],
  "properties": {
    "schema_version": {"const": "plain_language_visit.v1"},
    "generated_notice": {"const": "Generated from clinician-authored notes; verify with your clinic."},
    "summary": {"type": "string", "minLength": 1, "maxLength": 1600},
    "next_steps": {
      "type": "array",
      "maxItems": 12,
      "items": {"type": "string", "minLength": 1, "maxLength": 300}
    },
    "medication_review": {
      "type": "array",
      "maxItems": 20,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["medication_name", "dosage", "route", "frequency", "start_date", "end_date", "instructions"],
        "properties": {
          "medication_name": {"type": "string", "minLength": 1, "maxLength": 160},
          "dosage": {"type": "string", "minLength": 1, "maxLength": 120},
          "route": {"type": ["string", "null"], "maxLength": 80},
          "frequency": {"type": "string", "minLength": 1, "maxLength": 120},
          "start_date": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
          "end_date": {"type": ["string", "null"], "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
          "instructions": {"type": "string", "maxLength": 300}
        }
      }
    }
  }
}
```

The application compares each `medication_review` item with the doctor-reviewed
structured prescription by stable item ID/version. A mismatch marks the generated
artifact invalid; it does not alter the prescription or reminder schedule.

## Version and prompt storage

The executable `generated_artifacts` table (migration `0002_application_domain`) stores:

- opaque artifact UUID and source record UUID;
- source record version and task kind;
- `task_version` (the prompt/schema versions are captured in source/version metadata);
- provider and model identifiers (no API key);
- status: `pending`, `succeeded`, or `failed`;
- source-version JSON, last safe error code, and created/updated timestamps;
- validated JSON/text output only when the reviewed retention policy permits it.

The repository stores the exact templates and JSON Schemas in this document/review
history. The outbox payload stores only event type and opaque source/aggregate IDs.
Never store raw prompts, source text, provider responses, access tokens, or refresh
tokens in Redis, ordinary logs, URLs, idempotency keys, or an unencrypted audit reason.
If an approved clinical-retention policy requires replayable prompts, use encrypted
restricted storage with explicit access auditing and key rotation.

## Graceful failure and retry behavior

| Failure | Artifact state | Worker behavior | User-visible result |
| --- | --- | --- | --- |
| Provider timeout, network error, 429, or 5xx | `pending` until the outbox retry succeeds, then `succeeded` or terminal `failed` | Normalize to a retryable code, use exponential backoff with jitter, and keep the outbox row durable. | Original symptoms/notes remain visible; booking or visit completion succeeds independently. |
| Provider refusal, invalid JSON, schema mismatch, unsafe/identifier leakage, or unsupported model | `failed` (terminal) | Do not blindly retry; retain a safe error code and permit an authorized idempotent retry after correction/configuration. | Show generated output unavailable; never fabricate a replacement. |
| Source record missing, stale, or unauthorized | `failed` (terminal) | Reject before provider call; record no clinical text in the error. | Continue with the original authorized record or request a fresh version. |
| Successful valid output | `succeeded` | Mark the same logical artifact/outbox operation succeeded using the event UUID as idempotency key. | Show generated content with the generated notice and source/version provenance. |

LLM work is asynchronous and never part of the booking or visit-completion transaction.
A failure cannot cancel an appointment, prevent saving original doctor notes, change a
prescription, or derive a medication reminder. Reminder timing is calculated only from
structured prescription fields.
