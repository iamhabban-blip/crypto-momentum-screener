import os

import pytest
from sqlalchemy import create_engine, text

os.environ.setdefault("JWT_SECRET", "test-secret-0123456789abcdef0123456789abcdef")
os.environ.setdefault("COOKIE_SECURE", "false")

from app.config import get_settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Role, User  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "Correct-Horse-Battery-77"
TABLES = "watchlist_items, signals, scan_runs, refresh_tokens, audit_log, backtest_runs, app_settings, users"


@pytest.fixture(autouse=True)
def clean_db():
    owner = create_engine(get_settings().migrations_url)
    with owner.begin() as c:
        c.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    owner.dispose()
    from app.routers.auth import login_limiter, refresh_limiter
    login_limiter.reset()
    refresh_limiter.reset()
    yield


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app, base_url="http://testserver") as c:
        yield c


def make_user(email: str, role: Role = Role.viewer, password: str = PASSWORD) -> User:
    with SessionLocal() as db:
        u = User(email=email, full_name=email.split("@")[0], role=role, password_hash=hash_password(password))
        db.add(u)
        db.commit()
        return u


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def auth_header(client, email, password=PASSWORD) -> dict:
    r = login(client, email, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
