"""FastAPI application: routers, security headers, CORS and first-admin bootstrap."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from .config import get_settings
from .db import SessionLocal
from .models import Role, User
from .routers import admin, auth, backtests, signals, watchlist
from .security import hash_password, password_problems

log = logging.getLogger("api")
settings = get_settings()


def bootstrap_admin() -> None:
    """Creates the first admin from BOOTSTRAP_ADMIN_* env vars, only if no admin exists yet."""
    email, password = settings.bootstrap_admin_email, settings.bootstrap_admin_password
    if not email or not password:
        return
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.role == Role.admin)):
            return
        problems = password_problems(password, email)
        if problems:
            log.error("BOOTSTRAP_ADMIN_PASSWORD rejected: %s", " ".join(problems))
            return
        db.add(User(email=email.lower(), full_name="Administrator", role=Role.admin,
                    password_hash=hash_password(password)))
        db.commit()
        log.info("created first admin %s", email)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    bootstrap_admin()
    yield


app = FastAPI(title="Trendscope API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/docs"):
        response.headers["Cache-Control"] = "no-store"
    return response


for r in (auth.router, signals.router, watchlist.router, backtests.router, admin.router):
    app.include_router(r)


@app.get("/api/health", tags=["health"])
def health():
    with SessionLocal() as db:
        db.execute(text("SELECT 1"))
    return {"status": "ok"}
