"""Request dependencies: the signed-in user, role checks and audit logging."""

import uuid
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import AuditLog, Role, User
from .ratelimit import client_ip
from .security import decode_access_token

_bearer = HTTPBearer(auto_error=False)
_ROLE_RANK = {Role.viewer: 0, Role.analyst: 1, Role.admin: 2}

UNAUTHORIZED = HTTPException(
    status.HTTP_401_UNAUTHORIZED, "Not signed in or session expired.", headers={"WWW-Authenticate": "Bearer"}
)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise UNAUTHORIZED
    try:
        claims = decode_access_token(creds.credentials)
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise UNAUTHORIZED
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise UNAUTHORIZED
    # A password change (or admin reset) invalidates every access token issued before it.
    issued = datetime.fromtimestamp(claims["iat"], tz=timezone.utc)
    if user.password_changed_at and issued < user.password_changed_at.replace(microsecond=0):
        raise UNAUTHORIZED
    return user


def require_role(minimum: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if _ROLE_RANK[user.role] < _ROLE_RANK[minimum]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this action.")
        return user
    return checker


def audit(db: Session, request: Request | None, action: str, user: User | None = None,
          target: str | None = None, actor_email: str | None = None, **meta) -> None:
    """Adds an audit entry to the current transaction (committed with the change it describes)."""
    db.add(AuditLog(
        user_id=user.id if user else None,
        actor_email=actor_email or (user.email if user else None),
        action=action,
        target=target,
        ip=client_ip(request) if request else None,
        user_agent=(request.headers.get("user-agent", "")[:255] if request else None),
        meta=meta,
    ))
