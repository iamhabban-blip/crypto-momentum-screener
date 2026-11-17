"""Password hashing, password policy, access tokens (JWT) and refresh tokens (opaque, rotated)."""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

# Argon2id with the library's OWASP-aligned defaults (memory-hard, resistant to GPU cracking).
_hasher = PasswordHasher()
# Used to burn the same CPU time when the email doesn't exist, so response timing can't reveal accounts.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))

COMMON_PASSWORDS = {
    "password", "password123", "123456789012", "qwertyuiop", "letmein12345", "iloveyou1234",
    "admin1234567", "welcome12345", "trendscope123", "passw0rd1234", "binance12345",
}


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> tuple[bool, str | None]:
    """Returns (ok, new_hash). new_hash is set when the stored hash uses outdated parameters."""
    if not password_hash:
        try:
            _hasher.verify(_DUMMY_HASH, password)
        except VerificationError:
            pass
        return False, None
    try:
        _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False, None
    return True, (_hasher.hash(password) if _hasher.check_needs_rehash(password_hash) else None)


def password_problems(password: str, email: str | None = None) -> list[str]:
    """Server-side password policy (NIST 800-63B style: length over complexity, block known-bad)."""
    problems = []
    if len(password) < 12:
        problems.append("Use at least 12 characters.")
    if len(password) > 128:
        problems.append("Use at most 128 characters.")
    if password.lower() in COMMON_PASSWORDS:
        problems.append("This password is too common.")
    if email and email.split("@")[0].lower() in password.lower():
        problems.append("Don't include your email name in the password.")
    if len(set(password)) < 5:
        problems.append("Use more varied characters.")
    return problems


# ── Access tokens ─────────────────────────────────────────────────────────────

def create_access_token(user_id: uuid.UUID, role: str) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(timezone.utc)
    ttl = timedelta(minutes=s.access_token_minutes)
    payload = {
        "sub": str(user_id), "role": role, "iss": s.jwt_issuer, "aud": s.jwt_audience,
        "iat": int(now.timestamp()), "exp": int((now + ttl).timestamp()), "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm="HS256"), int(ttl.total_seconds())


def decode_access_token(token: str) -> dict:
    s = get_settings()
    return jwt.decode(
        token, s.jwt_secret, algorithms=["HS256"], audience=s.jwt_audience, issuer=s.jwt_issuer,
        options={"require": ["sub", "exp", "iat", "iss", "aud"]},
    )


# ── Refresh tokens ────────────────────────────────────────────────────────────

def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the cookie, SHA-256 hash for the database)."""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def refresh_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=get_settings().refresh_token_days)
