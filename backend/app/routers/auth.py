"""Authentication.

* Access token: short-lived JWT (15 min) sent as `Authorization: Bearer`, kept in memory by the SPA.
* Refresh token: opaque random string in an httpOnly, SameSite=Strict cookie scoped to /api/auth.
  Rotated on every use; a replayed old token revokes the whole login family (theft detection).
* Brute force: per-IP rate limit + per-account lockout after N failures.
* CSRF: cookie-bearing endpoints also require the custom `X-Requested-With` header, which a
  cross-site form or image can't send.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import audit, get_current_user
from ..models import RefreshToken, User
from ..ratelimit import SlidingWindowLimiter, client_ip
from ..schemas import ChangePasswordIn, LoginIn, TokenOut, UserOut
from ..security import (
    create_access_token, hash_password, hash_refresh_token, new_refresh_token, password_problems,
    refresh_expiry, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()

COOKIE = "ts_refresh"
COOKIE_PATH = "/api/auth"
CSRF_HEADER = "x-requested-with"
REUSE_GRACE = timedelta(seconds=15)  # two browser tabs refreshing at the same moment

login_limiter = SlidingWindowLimiter(settings.login_rate_per_minute, 60)
refresh_limiter = SlidingWindowLimiter(60, 60)

BAD_LOGIN = HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_csrf_header(request: Request) -> None:
    if request.headers.get(CSRF_HEADER, "").lower() != "trendscope":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing request header.")


def _set_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        COOKIE, raw, max_age=settings.refresh_token_days * 86400, path=COOKIE_PATH,
        httponly=True, secure=settings.cookie_secure, samesite="strict",
    )


def _clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path=COOKIE_PATH, httponly=True, secure=settings.cookie_secure,
                           samesite="strict")


def _issue_session(db: Session, request: Request, response: Response, user: User,
                   family_id: uuid.UUID | None = None) -> TokenOut:
    raw, digest = new_refresh_token()
    db.add(RefreshToken(
        user_id=user.id, family_id=family_id or uuid.uuid4(), token_hash=digest,
        expires_at=refresh_expiry(), user_agent=request.headers.get("user-agent", "")[:255],
        ip=client_ip(request),
    ))
    access, ttl = create_access_token(user.id, user.role.value)
    _set_cookie(response, raw)
    return TokenOut(access_token=access, expires_in=ttl, user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    login_limiter.check(client_ip(request))
    email = body.email.lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email).with_for_update())

    if user is None:
        verify_password(body.password, None)  # same work as a real check: no timing leak
        audit(db, request, "login_failed", actor_email=email, reason="unknown_email")
        db.commit()
        raise BAD_LOGIN

    if user.locked_until and user.locked_until > _now():
        minutes = int((user.locked_until - _now()).total_seconds() // 60) + 1
        audit(db, request, "login_blocked_locked", user=user)
        db.commit()
        raise HTTPException(status.HTTP_423_LOCKED,
                            f"Too many failed attempts. Try again in {minutes} minute(s).")

    ok, new_hash = verify_password(body.password, user.password_hash)
    if not ok or not user.is_active:
        user.failed_login_count += 1
        reason = "inactive" if ok else "bad_password"
        if user.failed_login_count >= settings.max_failed_logins:
            user.locked_until = _now() + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_count = 0
            audit(db, request, "account_locked", user=user, minutes=settings.lockout_minutes)
        audit(db, request, "login_failed", user=user, reason=reason)
        db.commit()
        raise BAD_LOGIN

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = _now()
    if new_hash:
        user.password_hash = new_hash
    out = _issue_session(db, request, response, user)
    audit(db, request, "login_success", user=user)
    db.commit()
    return out


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_csrf_header(request)
    refresh_limiter.check(client_ip(request))
    raw = request.cookies.get(COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session.")

    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw))
                      .with_for_update())
    if token is None:
        _clear_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session not found.")

    if token.revoked_at is not None:
        if token.revoked_reason == "rotated" and _now() - token.revoked_at < REUSE_GRACE:
            # Another tab just rotated this token; the browser now holds the new cookie.
            raise HTTPException(status.HTTP_409_CONFLICT, "Session refresh in progress, retry.")
        # An old token came back: assume it was stolen and end every session in this family.
        db.execute(update(RefreshToken)
                   .where(RefreshToken.family_id == token.family_id, RefreshToken.revoked_at.is_(None))
                   .values(revoked_at=_now(), revoked_reason="reuse_detected"))
        user = db.get(User, token.user_id)
        audit(db, request, "refresh_token_reuse_detected", user=user, family=str(token.family_id))
        db.commit()
        _clear_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended for security reasons. Sign in again.")

    user = db.get(User, token.user_id)
    if token.expires_at < _now() or user is None or not user.is_active:
        token.revoked_at, token.revoked_reason = _now(), "expired"
        db.commit()
        _clear_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Sign in again.")

    token.revoked_at, token.revoked_reason = _now(), "rotated"
    out = _issue_session(db, request, response, user, family_id=token.family_id)
    db.commit()
    return out


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _require_csrf_header(request)
    raw = request.cookies.get(COOKIE)
    if raw:
        token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        if token:
            db.execute(update(RefreshToken)
                       .where(RefreshToken.family_id == token.family_id, RefreshToken.revoked_at.is_(None))
                       .values(revoked_at=_now(), revoked_reason="logout"))
            audit(db, request, "logout", user=db.get(User, token.user_id))
            db.commit()
    _clear_cookie(response)
    response.status_code = 204
    return response


@router.post("/logout-all", status_code=204)
def logout_all(request: Request, response: Response, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    _require_csrf_header(request)
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now(), revoked_reason="logout"))
    audit(db, request, "logout_all_sessions", user=user)
    db.commit()
    _clear_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordIn, request: Request, response: Response,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ok, _ = verify_password(body.current_password, user.password_hash)
    if not ok:
        audit(db, request, "password_change_failed", user=user)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    problems = password_problems(body.new_password, user.email)
    if problems:
        raise HTTPException(422, " ".join(problems))
    user.password_hash = hash_password(body.new_password)
    user.password_changed_at = _now()
    db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
               .values(revoked_at=_now(), revoked_reason="password_change"))
    audit(db, request, "password_changed", user=user)
    db.commit()
    _clear_cookie(response)
    response.status_code = 204
    return response
