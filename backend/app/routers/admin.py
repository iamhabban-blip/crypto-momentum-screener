"""Admin-only management: users, screener settings, audit log. Every change is audit-logged."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from engine.settings_store import DEFAULTS, SETTINGS_KEY

from ..db import get_db
from ..deps import audit, require_role
from ..models import AppSetting, AuditLog, RefreshToken, Role, User
from ..schemas import AuditOut, Page, ResetPasswordIn, ScreenerSettings, UserCreateIn, UserOut, UserUpdateIn
from ..security import hash_password, password_problems

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require_role(Role.admin)


def _now():
    return datetime.now(timezone.utc)


def _get_user(db: Session, user_id: uuid.UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(404, "User not found.")
    return user


def _active_admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin, User.is_active))


def _revoke_sessions(db: Session, user_id: uuid.UUID) -> None:
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now(), revoked_reason="admin"))


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    return db.scalars(select(User).order_by(User.created_at)).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreateIn, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(admin_only)):
    email = body.email.lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(409, "A user with this email already exists.")
    problems = password_problems(body.password, email)
    if problems:
        raise HTTPException(422, " ".join(problems))
    user = User(email=email, full_name=body.full_name.strip(), role=body.role,
                password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    audit(db, request, "user_created", user=admin, target=email, role=body.role.value)
    db.commit()
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdateIn, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(admin_only)):
    user = _get_user(db, user_id)
    changes = body.model_dump(exclude_unset=True)
    losing_admin = (changes.get("role") not in (None, Role.admin) or changes.get("is_active") is False) \
        and user.role == Role.admin and user.is_active
    if losing_admin and user.id == admin.id:
        raise HTTPException(400, "You can't remove your own admin access. Ask another admin.")
    if losing_admin and _active_admins(db) <= 1:
        raise HTTPException(400, "There must always be at least one active admin.")
    for k, v in changes.items():
        setattr(user, k, v)
    if changes.get("is_active") is False or "role" in changes:
        _revoke_sessions(db, user.id)        # take effect immediately, not at next token refresh
        user.password_changed_at = _now()    # also invalidates live access tokens
    audit(db, request, "user_updated", user=admin, target=user.email,
          changes={k: (v.value if hasattr(v, "value") else v) for k, v in changes.items()})
    db.commit()
    return user


@router.post("/users/{user_id}/unlock", response_model=UserOut)
def unlock_user(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(admin_only)):
    user = _get_user(db, user_id)
    user.locked_until = None
    user.failed_login_count = 0
    audit(db, request, "user_unlocked", user=admin, target=user.email)
    db.commit()
    return user


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(user_id: uuid.UUID, body: ResetPasswordIn, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(admin_only)):
    user = _get_user(db, user_id)
    problems = password_problems(body.new_password, user.email)
    if problems:
        raise HTTPException(422, " ".join(problems))
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = _now()
    user.locked_until, user.failed_login_count = None, 0
    _revoke_sessions(db, user.id)
    audit(db, request, "password_reset_by_admin", user=admin, target=user.email)
    db.commit()


@router.post("/users/{user_id}/revoke-sessions", status_code=204)
def revoke_sessions(user_id: uuid.UUID, request: Request, db: Session = Depends(get_db),
                    admin: User = Depends(admin_only)):
    user = _get_user(db, user_id)
    _revoke_sessions(db, user.id)
    user.password_changed_at = _now()
    audit(db, request, "sessions_revoked_by_admin", user=admin, target=user.email)
    db.commit()


# ── Screener settings ─────────────────────────────────────────────────────────

@router.get("/settings", response_model=ScreenerSettings)
def get_settings_(db: Session = Depends(get_db), _: User = Depends(admin_only)):
    row = db.get(AppSetting, SETTINGS_KEY)
    return ScreenerSettings(**{**DEFAULTS, **(row.value if row else {})})


@router.put("/settings", response_model=ScreenerSettings)
def put_settings(body: ScreenerSettings, request: Request, db: Session = Depends(get_db),
                 admin: User = Depends(admin_only)):
    row = db.get(AppSetting, SETTINGS_KEY)
    before = row.value if row else DEFAULTS
    if row is None:
        row = AppSetting(key=SETTINGS_KEY, value=body.model_dump(), updated_by=admin.id)
        db.add(row)
    else:
        row.value, row.updated_by = body.model_dump(), admin.id
    audit(db, request, "settings_changed", user=admin, target=SETTINGS_KEY, before=before, after=body.model_dump())
    db.commit()
    return body


# ── Audit log ─────────────────────────────────────────────────────────────────

@router.get("/audit", response_model=Page)
def audit_log(action: str | None = None, email: str | None = None,
              limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
              db: Session = Depends(get_db), _: User = Depends(admin_only)):
    q = select(AuditLog)
    if action:
        q = q.where(AuditLog.action == action)
    if email:
        q = q.where(func.lower(AuditLog.actor_email).contains(email.lower()))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(AuditLog.id.desc()).limit(limit).offset(offset)).all()
    return Page(total=total, items=[AuditOut.model_validate(r).model_dump(mode="json") for r in rows])
