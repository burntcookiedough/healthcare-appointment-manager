"""Deterministic fakes and fail-closed HTTP adapters for external providers.

The production adapters deliberately accept only reference-bearing requests.  A
trusted resolver supplies email addresses, OAuth access tokens, and source text at
execution time; none of those values can enter an outbox envelope or operational log.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .llm import output_model_for_task, output_schema_for_task
from .ports import (
    AdapterResult,
    CalendarRequest,
    ClinicalLLMPort,
    ClinicalSummaryRequest,
    EmailContent,
    EmailPort,
    EmailRequest,
    GoogleCalendarPort,
    OAuthCredentials,
    SummarySource,
    TrustedDataResolutionError,
    TrustedDataResolver,
)

LOGGER = logging.getLogger(__name__)


def _is_secure_endpoint(endpoint: str | None) -> bool:
    return endpoint is not None and endpoint.casefold().startswith("https://")


@dataclass(frozen=True, slots=True)
class AdapterCall:
    """Safe test trace of one adapter invocation."""

    idempotency_key: str
    request: object


class _DeterministicAdapter:
    def __init__(self, outcomes: Iterable[AdapterResult] | None = None) -> None:
        self._outcomes = deque(outcomes or ())
        self.calls: list[AdapterCall] = []
        self._call_number = 0

    def _result_for_next_call(self, *, provider_name: str) -> AdapterResult:
        self._call_number += 1
        if self._outcomes:
            return self._outcomes.popleft()
        return AdapterResult.success(provider_reference=f"fake-{provider_name}-{self._call_number}")


class DeterministicFakeEmailAdapter(_DeterministicAdapter, EmailPort):
    """Fake email adapter with a caller-controlled result sequence."""

    def send(self, request: EmailRequest, *, idempotency_key: str) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        return self._result_for_next_call(provider_name="email")


class DeterministicFakeGoogleCalendarAdapter(_DeterministicAdapter, GoogleCalendarPort):
    """Fake Google Calendar adapter with no network or OAuth behavior."""

    def upsert_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        return self._result_for_next_call(provider_name="calendar")


class DeterministicFakeClinicalLLMAdapter(_DeterministicAdapter, ClinicalLLMPort):
    """Fake clinical LLM adapter that returns normalized outcomes only."""

    def generate_summary(
        self, request: ClinicalSummaryRequest, *, idempotency_key: str
    ) -> AdapterResult:
        self.calls.append(AdapterCall(idempotency_key=idempotency_key, request=request))
        result = self._result_for_next_call(provider_name="llm")
        if result.outcome.value == "succeeded" and result.output is None:
            if request.task_kind == "pre_visit":
                output: dict[str, Any] = {
                    "urgency": "Low",
                    "chief_complaint": "Synthetic pre-visit concern",
                    "suggested_questions": [
                        "When did this start?",
                        "What makes it better or worse?",
                        "What should we monitor next?",
                    ],
                }
            else:
                output = {
                    "summary": "Synthetic patient-friendly follow-up summary.",
                    "next_steps": ["Follow the clinician's documented plan."],
                    "warning_signs": [],
                }
            result = result.model_copy(
                update={
                    "output": output,
                    "metadata": {
                        "provider": "fake",
                        "model": "deterministic",
                        "prompt_version": request.prompt_version,
                        "schema_version": request.schema_version,
                    },
                }
            )
        return result


# Friendly aliases for test and integration code.
FakeEmailAdapter = DeterministicFakeEmailAdapter
FakeGoogleCalendarAdapter = DeterministicFakeGoogleCalendarAdapter
FakeClinicalLLMAdapter = DeterministicFakeClinicalLLMAdapter


@dataclass(frozen=True, slots=True)
class HttpResponse:
    """Minimal response object used by adapters and deterministic transport fakes."""

    status_code: int
    headers: Mapping[str, str]
    body: bytes = b""


class HttpTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes = b"",
        timeout_seconds: float,
    ) -> HttpResponse:
        """Perform one HTTPS request without exposing response bodies to logs."""


class UrllibHttpTransport:
    """Small standard-library HTTPS transport; tests inject a fake instead."""

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes = b"",
        timeout_seconds: float,
    ) -> HttpResponse:
        request = Request(url, data=body or None, headers=dict(headers), method=method)
        try:
            with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
                return HttpResponse(
                    status_code=int(response.status),
                    headers={
                        str(key).casefold(): str(value) for key, value in response.headers.items()
                    },
                    body=response.read(1_000_000),
                )
        except HTTPError as error:
            # Provider response bodies are intentionally retained only in memory
            # for status classification and are never logged/persisted.
            return HttpResponse(
                status_code=int(error.code),
                headers={str(key).casefold(): str(value) for key, value in error.headers.items()},
                body=error.read(1_000_000),
            )
        except (TimeoutError, OSError, URLError) as error:
            raise TimeoutError("provider transport unavailable") from error


def _retry_after(headers: Mapping[str, str]) -> float | None:
    value = headers.get("retry-after") or headers.get("Retry-After")
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return min(3600.0, max(0.0, parsed))


def _classify_http(
    status_code: int, *, retry_code: str, terminal_code: str, headers: Mapping[str, str]
) -> AdapterResult | None:
    if 200 <= status_code < 300:
        return None
    if status_code == 408 or status_code == 429 or status_code >= 500:
        return AdapterResult.retryable(retry_code, retry_after_seconds=_retry_after(headers))
    return AdapterResult.terminal(terminal_code)


class InMemoryTrustedDataResolver:
    """Synthetic reference resolver for tests; it never accepts event PHI fields."""

    def __init__(
        self,
        *,
        email: Mapping[str, EmailContent] | None = None,
        calendar_credentials: Mapping[str, OAuthCredentials] | None = None,
        calendar_event_references: Mapping[str, str] | None = None,
        summaries: Mapping[str, SummarySource] | None = None,
        prescriptions: Mapping[str, object] | None = None,
    ) -> None:
        self.email = dict(email or {})
        self.calendar_credentials = dict(calendar_credentials or {})
        self.calendar_event_references = dict(calendar_event_references or {})
        self.summaries = dict(summaries or {})
        self.prescriptions = dict(prescriptions or {})

    def resolve_email(self, request: EmailRequest) -> EmailContent | None:
        if request.recipient_reference is None:
            return None
        return self.email.get(request.recipient_reference)

    def resolve_calendar_credentials(self, request: CalendarRequest) -> OAuthCredentials | None:
        key = request.credential_reference or "default"
        return self.calendar_credentials.get(key)

    def resolve_calendar_event_reference(self, request: CalendarRequest) -> str | None:
        if request.appointment_id is None:
            return None
        return self.calendar_event_references.get(str(request.appointment_id))

    def resolve_summary_source(self, request: ClinicalSummaryRequest) -> SummarySource | None:
        if request.source_record_reference is None:
            return None
        return self.summaries.get(str(request.source_record_reference))

    def resolve_prescription_schedule(
        self, prescription_id: Any, version: int | None
    ) -> object | None:
        return self.prescriptions.get(f"{prescription_id}:{version}") or self.prescriptions.get(
            str(prescription_id)
        )


class SendGridEmailAdapter(EmailPort):
    """Send one transactional email through SendGrid with safe failure mapping."""

    def __init__(
        self,
        *,
        api_key: str | None,
        from_email: str | None,
        resolver: TrustedDataResolver | None,
        endpoint: str = "https://api.sendgrid.com/v3/mail/send",
        timeout_seconds: float = 10.0,
        transport: HttpTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._from_email = from_email
        self._resolver = resolver
        self._endpoint = endpoint
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibHttpTransport()

    def send(self, request: EmailRequest, *, idempotency_key: str) -> AdapterResult:
        if (
            not self._api_key
            or not self._from_email
            or self._resolver is None
            or not _is_secure_endpoint(self._endpoint)
        ):
            return AdapterResult.terminal("PROVIDER_NOT_CONFIGURED")
        try:
            content = self._resolver.resolve_email(request)
        except TrustedDataResolutionError as error:
            return (
                AdapterResult.retryable(error.code)
                if error.retryable
                else AdapterResult.terminal(error.code)
            )
        except Exception:
            return AdapterResult.retryable("EMAIL_REFERENCE_ERROR")
        if content is None:
            return AdapterResult.terminal("EMAIL_REFERENCE_NOT_FOUND")
        payload: dict[str, Any] = {
            "personalizations": [{"to": [{"email": content.recipient_email}]}],
            "from": {"email": self._from_email},
            "subject": content.subject,
            "content": [{"type": "text/plain", "value": content.text_body}],
            "custom_args": {"worker_idempotency_key": idempotency_key},
        }
        if content.html_body is not None:
            payload["content"].append({"type": "text/html", "value": content.html_body})
        try:
            response = self._transport.request(
                "POST",
                self._endpoint,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotency_key,
                },
                body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                timeout_seconds=self._timeout_seconds,
            )
        except TimeoutError:
            return AdapterResult.retryable("EMAIL_TIMEOUT")
        except Exception:
            # No provider exception text is safe to persist or log.
            return AdapterResult.retryable("EMAIL_TRANSPORT_ERROR")
        classified = _classify_http(
            response.status_code,
            retry_code="EMAIL_PROVIDER_RETRYABLE",
            terminal_code="EMAIL_PROVIDER_REJECTED",
            headers=response.headers,
        )
        if classified is not None:
            return classified
        return AdapterResult.success(provider_reference=idempotency_key)


class GoogleCalendarOAuthAdapter(GoogleCalendarPort):
    """OAuth2 Google Calendar create/update/delete projection adapter."""

    def __init__(
        self,
        *,
        client_id: str | None,
        client_secret: str | None,
        resolver: TrustedDataResolver | None,
        endpoint: str = "https://www.googleapis.com/calendar/v3",
        timeout_seconds: float = 10.0,
        transport: HttpTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._resolver = resolver
        self._endpoint = endpoint.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._transport = transport or UrllibHttpTransport()

    def upsert_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        if (
            not self._client_id
            or not self._client_secret
            or self._resolver is None
            or not _is_secure_endpoint(self._endpoint)
        ):
            return AdapterResult.terminal("PROVIDER_NOT_CONFIGURED")
        try:
            credentials = self._resolver.resolve_calendar_credentials(request)
        except TrustedDataResolutionError as error:
            return (
                AdapterResult.retryable(error.code)
                if error.retryable
                else AdapterResult.terminal(error.code)
            )
        except Exception:
            return AdapterResult.retryable("CALENDAR_CREDENTIALS_ERROR")
        if credentials is None:
            return AdapterResult.terminal("CALENDAR_CREDENTIALS_NOT_FOUND")
        calendar_reference = quote(request.calendar_reference or "primary", safe="")
        event_reference = request.provider_event_reference
        action = request.action
        validator = getattr(self._resolver, "validate_calendar_event_reference", None)
        if action in {"update", "delete"} and callable(validator):
            try:
                event_reference = validator(request)
            except TrustedDataResolutionError as error:
                return (
                    AdapterResult.retryable(error.code)
                    if error.retryable
                    else AdapterResult.terminal(error.code)
                )
            except Exception:
                return AdapterResult.retryable("CALENDAR_REFERENCE_ERROR")
            if not event_reference:
                return AdapterResult.terminal("CALENDAR_EVENT_REFERENCE_MISSING")
        elif action == "delete" and not event_reference:
            # A cancellation must never fall through to the create branch.  The
            # provider event ID is trusted appointment state, not a value guessed
            # from the event UUID or accepted from free-form queue content.
            resolver_fn = getattr(self._resolver, "resolve_calendar_event_reference", None)
            if not callable(resolver_fn):
                return AdapterResult.terminal("CALENDAR_EVENT_REFERENCE_MISSING")
            try:
                event_reference = resolver_fn(request)
            except TrustedDataResolutionError as error:
                return (
                    AdapterResult.retryable(error.code)
                    if error.retryable
                    else AdapterResult.terminal(error.code)
                )
            except Exception:
                return AdapterResult.retryable("CALENDAR_REFERENCE_ERROR")
        if action in {"create", "update"} and (
            request.starts_at is None or request.ends_at is None
        ):
            return AdapterResult.terminal("INVALID_CALENDAR_REQUEST")
        if action == "create":
            method = "POST"
            url = f"{self._endpoint}/calendars/{calendar_reference}/events"
        elif action == "update":
            if not event_reference:
                return AdapterResult.terminal("CALENDAR_EVENT_REFERENCE_MISSING")
            method = "PATCH"
            encoded_event = quote(event_reference, safe="")
            url = f"{self._endpoint}/calendars/{calendar_reference}/events/{encoded_event}"
        else:
            if not event_reference:
                return AdapterResult.terminal("CALENDAR_EVENT_REFERENCE_MISSING")
            method = "DELETE"
            encoded_event = quote(event_reference, safe="")
            url = f"{self._endpoint}/calendars/{calendar_reference}/events/{encoded_event}"

        body: bytes = b""
        if action in {"create", "update"}:
            assert request.starts_at is not None and request.ends_at is not None
            calendar_body: dict[str, Any] = {
                "summary": request.event_label,
                # Google accepts a caller-supplied opaque event id.  Deriving it
                # from the durable operation key makes a retry a convergent create.
                "id": hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32],
                "start": {"dateTime": request.starts_at.isoformat()},
                "end": {"dateTime": request.ends_at.isoformat()},
                "extendedProperties": {"private": {"worker_idempotency_key": idempotency_key}},
            }
            if request.time_zone is not None:
                calendar_body["start"]["timeZone"] = request.time_zone
                calendar_body["end"]["timeZone"] = request.time_zone
            body = json.dumps(calendar_body, separators=(",", ":")).encode("utf-8")
        try:
            response = self._transport.request(
                method,
                url,
                headers={
                    "Authorization": f"{credentials.token_type} {credentials.access_token}",
                    "Content-Type": "application/json",
                    "Idempotency-Key": idempotency_key,
                },
                body=body,
                timeout_seconds=self._timeout_seconds,
            )
        except TimeoutError:
            return AdapterResult.retryable("CALENDAR_TIMEOUT")
        except Exception:
            return AdapterResult.retryable("CALENDAR_TRANSPORT_ERROR")
        classified = _classify_http(
            response.status_code,
            retry_code="CALENDAR_PROVIDER_RETRYABLE",
            terminal_code="CALENDAR_PROVIDER_REJECTED",
            headers=response.headers,
        )
        if action == "create" and response.status_code == 409:
            return AdapterResult.success(
                provider_reference=hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32]
            )
        if action == "delete" and response.status_code in {404, 410}:
            # A repeated cancellation is convergent once the provider confirms
            # that the event is already absent.
            return AdapterResult.success(provider_reference=event_reference or idempotency_key)
        if classified is not None:
            return classified
        provider_reference = event_reference or (
            hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()[:32]
            if action == "create"
            else idempotency_key
        )
        if response.body:
            try:
                decoded = json.loads(response.body.decode("utf-8"))
                if isinstance(decoded, dict) and isinstance(decoded.get("id"), str):
                    provider_reference = decoded["id"]
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass
        return AdapterResult.success(provider_reference=provider_reference)

    def create_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        return self.upsert_event(
            request.model_copy(update={"action": "create"}), idempotency_key=idempotency_key
        )

    def update_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        return self.upsert_event(
            request.model_copy(update={"action": "update"}), idempotency_key=idempotency_key
        )

    def delete_event(self, request: CalendarRequest, *, idempotency_key: str) -> AdapterResult:
        return self.upsert_event(
            request.model_copy(update={"action": "delete"}), idempotency_key=idempotency_key
        )


def _extract_json_output(decoded: Any, *, provider: str) -> Any:
    if isinstance(decoded, dict) and "output" in decoded:
        return decoded["output"]
    if provider == "openai" and isinstance(decoded, dict):
        choices = decoded.get("choices")
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            message = choices[0].get("message", {})
            if isinstance(message, dict):
                return message.get("parsed") or message.get("content")
    if provider == "gemini" and isinstance(decoded, dict):
        candidates = decoded.get("candidates")
        if isinstance(candidates, list) and candidates and isinstance(candidates[0], dict):
            content = candidates[0].get("content", {})
            if isinstance(content, dict):
                parts = content.get("parts")
                if isinstance(parts, list) and parts and isinstance(parts[0], dict):
                    return parts[0].get("text")
    return decoded


class HttpClinicalLLMAdapter(ClinicalLLMPort):
    """Provider-neutral structured-output adapter for OpenAI-compatible/Gemini HTTP."""

    def __init__(
        self,
        *,
        endpoint: str | None,
        api_key: str | None,
        provider: str = "generic",
        model: str = "",
        resolver: TrustedDataResolver | None,
        prompt_version: str = "clinical.v1",
        schema_version: str = "clinical.v1",
        timeout_seconds: float = 10.0,
        validation_retries: int = 2,
        transport: HttpTransport | None = None,
    ) -> None:
        self._endpoint = endpoint
        self._api_key = api_key
        self._provider = provider
        self._model = model
        self._resolver = resolver
        self._prompt_version = prompt_version
        self._schema_version = schema_version
        self._timeout_seconds = timeout_seconds
        self._validation_retries = max(0, min(validation_retries, 3))
        self._transport = transport or UrllibHttpTransport()

    def generate_summary(
        self, request: ClinicalSummaryRequest, *, idempotency_key: str
    ) -> AdapterResult:
        if self._provider in {"none", "disabled"}:
            return AdapterResult.terminal("PROVIDER_DISABLED")
        if (
            not self._endpoint
            or not self._api_key
            or not self._model
            or self._resolver is None
            or not _is_secure_endpoint(self._endpoint)
        ):
            return AdapterResult.terminal("PROVIDER_NOT_CONFIGURED")
        try:
            source = self._resolver.resolve_summary_source(request)
        except TrustedDataResolutionError as error:
            return (
                AdapterResult.retryable(error.code)
                if error.retryable
                else AdapterResult.terminal(error.code)
            )
        except Exception:
            return AdapterResult.retryable("SUMMARY_SOURCE_ERROR")
        if source is None:
            return AdapterResult.terminal("SUMMARY_SOURCE_NOT_FOUND")
        try:
            schema = output_schema_for_task(request.task_kind)
        except ValueError:
            return AdapterResult.terminal("UNSUPPORTED_SUMMARY_TASK")
        saw_invalid_output = False
        for validation_attempt in range(self._validation_retries + 1):
            feedback = (
                " The prior response failed validation; return corrected JSON only."
                if validation_attempt
                else ""
            )
            system_prompt = (
                "You are a clinical documentation assistant. Return only JSON that conforms to "
                "the supplied schema. Do not diagnose, prescribe, or invent facts." + feedback
            )
            payload = self._build_payload(
                request,
                source.source_text,
                schema,
                idempotency_key,
                system_prompt,
            )
            try:
                response = self._transport.request(
                    "POST",
                    self._endpoint,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                        "Idempotency-Key": idempotency_key,
                        **({"x-goog-api-key": self._api_key} if self._provider == "gemini" else {}),
                    },
                    body=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                    timeout_seconds=self._timeout_seconds,
                )
            except TimeoutError:
                return AdapterResult.retryable("LLM_TIMEOUT")
            except Exception:
                return (
                    AdapterResult.terminal("LLM_INVALID_OUTPUT")
                    if saw_invalid_output
                    else AdapterResult.retryable("LLM_TRANSPORT_ERROR")
                )
            classified = _classify_http(
                response.status_code,
                retry_code="LLM_PROVIDER_RETRYABLE",
                terminal_code="LLM_PROVIDER_REJECTED",
                headers=response.headers,
            )
            if classified is not None:
                return classified
            try:
                decoded = json.loads(response.body.decode("utf-8"))
                raw_output = _extract_json_output(decoded, provider=self._provider)
                if isinstance(raw_output, str):
                    raw_output = (
                        raw_output.strip().removeprefix("```json").removesuffix("```").strip()
                    )
                    raw_output = json.loads(raw_output)
                if not isinstance(raw_output, dict):
                    raise ValueError("output is not an object")
                output_model = output_model_for_task(request.task_kind)
                validated = output_model.model_validate(raw_output)
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
                saw_invalid_output = True
                continue
            return AdapterResult.success(
                provider_reference=f"{self._provider}:{self._model}",
                output=validated.model_dump(mode="json"),
                metadata={
                    "provider": self._provider,
                    "model": self._model,
                    "prompt_version": (
                        request.prompt_version
                        if request.prompt_version != "clinical.v1"
                        else self._prompt_version
                    ),
                    "schema_version": (
                        request.schema_version
                        if request.schema_version != "clinical.v1"
                        else self._schema_version
                    ),
                },
            )
        return AdapterResult.terminal("LLM_INVALID_OUTPUT")

    def _build_payload(
        self,
        request: ClinicalSummaryRequest,
        source_text: str,
        schema: dict[str, Any],
        idempotency_key: str,
        system_prompt: str,
    ) -> dict[str, Any]:
        if self._provider == "openai":
            return {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": source_text},
                ],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": request.task_kind,
                        "strict": True,
                        "schema": schema,
                    },
                },
                "user": idempotency_key,
            }
        if self._provider == "gemini":
            return {
                "contents": [{"role": "user", "parts": [{"text": source_text}]}],
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                },
            }
        return {
            "model": self._model,
            "prompt": source_text,
            "system_prompt": system_prompt,
            "response_schema": schema,
            "idempotency_key": idempotency_key,
        }


# Integration-friendly aliases.
SendGridAdapter = SendGridEmailAdapter
GoogleCalendarAdapter = GoogleCalendarOAuthAdapter
GoogleCalendarOAuth2Adapter = GoogleCalendarOAuthAdapter
ProviderNeutralLLMAdapter = HttpClinicalLLMAdapter
LLMHttpAdapter = HttpClinicalLLMAdapter
