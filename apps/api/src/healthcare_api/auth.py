"""Fail-closed Supabase-compatible bearer authentication and actor mapping."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import math
import time
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import Depends, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import Settings, get_settings
from .db import get_session
from .errors import ApiError
from .models import Actor, Doctor, PatientProfile

Role = Literal["patient", "doctor", "admin"]
bearer_scheme = HTTPBearer(auto_error=False, scheme_name="SupabaseBearer")


@dataclass(frozen=True, slots=True)
class ActorContext:
    """Authenticated application actor and profile references."""

    id: str
    subject_id: str
    role: Role
    patient_id: str | None = None
    doctor_id: str | None = None


def _b64decode(value: str) -> bytes:
    try:
        padded = value + "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(padded.encode("ascii"))
    except (ValueError, UnicodeError, binascii.Error) as exc:
        raise ValueError("invalid token encoding") from exc


def _json_segment(value: str) -> dict[str, Any]:
    decoded = json.loads(_b64decode(value))
    if not isinstance(decoded, dict):
        raise ValueError("token segment is not an object")
    return decoded


def _verify_public_key_signature(
    algorithm: str, public_key: str, message: bytes, signature: bytes
) -> None:
    """Verify configured PEM RSA/ECDSA keys without accepting algorithm confusion."""

    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa, utils

        key = serialization.load_pem_public_key(public_key.encode("utf-8"))
        if algorithm == "RS256" and isinstance(key, rsa.RSAPublicKey):
            key.verify(signature, message, padding.PKCS1v15(), hashes.SHA256())
            return
        if (
            algorithm == "ES256"
            and isinstance(key, ec.EllipticCurvePublicKey)
            and isinstance(key.curve, ec.SECP256R1)
        ):
            if len(signature) != 64:
                raise ValueError("invalid ECDSA signature length")
            r = int.from_bytes(signature[:32], "big")
            s = int.from_bytes(signature[32:], "big")
            key.verify(utils.encode_dss_signature(r, s), message, ec.ECDSA(hashes.SHA256()))
            return
    except Exception as exc:  # cryptography errors are intentionally normalized below
        raise ValueError("invalid token signature") from exc
    raise ValueError("configured key does not match token algorithm")


def verify_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    """Verify a Supabase JWT's structure, signature, issuer, audience, and lifetime.

    Only HS256 with ``SUPABASE_JWT_SECRET`` or RS256/ES256 with an explicitly
    configured PEM public key is accepted.  ``alg=none`` and algorithm/key confusion
    are rejected.  The function never makes a network call to a JWKS endpoint; hosted
    deployments must provision the current verification key through configuration.
    """

    active = settings or get_settings()
    try:
        parts = token.strip().split(".")
        if len(parts) != 3 or any(not part for part in parts):
            raise ValueError("malformed token")
        header = _json_segment(parts[0])
        claims = _json_segment(parts[1])
        signature = _b64decode(parts[2])
        algorithm = header.get("alg")
        if algorithm not in {"HS256", "RS256", "ES256"}:
            raise ValueError("unsupported token algorithm")
        message = f"{parts[0]}.{parts[1]}".encode("ascii")
        if algorithm == "HS256":
            if not active.supabase_jwt_secret:
                raise ValueError("JWT secret is not configured")
            expected = hmac.new(
                active.supabase_jwt_secret.encode("utf-8"), message, hashlib.sha256
            ).digest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError("invalid token signature")
        else:
            if not active.supabase_jwt_public_key:
                raise ValueError("JWT public key is not configured")
            _verify_public_key_signature(
                algorithm, active.supabase_jwt_public_key, message, signature
            )

        issuer = active.supabase_jwt_issuer
        audience = active.supabase_jwt_audience
        if not issuer or not audience:
            raise ValueError("JWT issuer and audience are not configured")
        if claims.get("iss") != issuer:
            raise ValueError("invalid token issuer")
        token_audience = claims.get("aud")
        audiences = token_audience if isinstance(token_audience, list) else [token_audience]
        if audience not in audiences:
            raise ValueError("invalid token audience")
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject.strip():
            raise ValueError("token subject is missing")
        expiry = claims.get("exp")
        if (
            not isinstance(expiry, (int, float))
            or isinstance(expiry, bool)
            or not math.isfinite(expiry)
            or expiry <= time.time()
        ):
            raise ValueError("token is expired")
        not_before = claims.get("nbf")
        if not_before is not None and (
            not isinstance(not_before, (int, float))
            or isinstance(not_before, bool)
            or not math.isfinite(not_before)
            or not_before > time.time()
        ):
            raise ValueError("token is not active")
        return claims
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, UnicodeError):
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.") from None


def _local_test_subject(token: str, settings: Settings) -> str | None:
    if not settings.auth_allow_local_test_tokens:
        return None
    if settings.app_env.casefold() not in {"local", "development", "test"}:
        return None
    if token.startswith("test:") and token[5:].strip():
        return token[5:].strip()
    return None


async def get_current_actor(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> ActorContext:
    """Verify the bearer credential, then resolve a provisioned active actor."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
    settings = get_settings()
    raw_token = credentials.credentials.strip()
    subject_id = _local_test_subject(raw_token, settings)
    if subject_id is None:
        claims = verify_access_token(raw_token, settings)
        subject_id = str(claims["sub"])
    result = await session.execute(
        select(Actor).where(Actor.subject_id == subject_id, Actor.is_active.is_(True))
    )
    actor = result.scalar_one_or_none()
    if actor is None:
        raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")

    patient_id: str | None = None
    doctor_id: str | None = None
    if actor.role == "patient":
        profile = await session.scalar(
            select(PatientProfile.actor_id).where(PatientProfile.actor_id == actor.id)
        )
        if profile is None:
            raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        patient_id = str(profile)
    elif actor.role == "doctor":
        profile = await session.scalar(select(Doctor.id).where(Doctor.actor_id == actor.id))
        if profile is None:
            raise ApiError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.")
        doctor_id = str(profile)

    # End the read transaction before a mutation service starts its own transaction.
    await session.commit()
    return ActorContext(
        id=str(actor.id),
        subject_id=actor.subject_id,
        role=actor.role,  # type: ignore[arg-type]
        patient_id=patient_id,
        doctor_id=doctor_id,
    )


def require_role(*roles: Role) -> Any:
    """Build a dependency enforcing a role without leaking resource details."""

    async def dependency(actor: ActorContext = Depends(get_current_actor)) -> ActorContext:
        if actor.role not in roles:
            raise ApiError(403, "FORBIDDEN", "Access is forbidden.")
        return actor

    return dependency
