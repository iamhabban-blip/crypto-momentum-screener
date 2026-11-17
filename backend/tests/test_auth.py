from app.models import Role

from .conftest import PASSWORD, auth_header, login, make_user

CSRF = {"X-Requested-With": "trendscope"}


def test_login_success_sets_httponly_refresh_cookie(client):
    make_user("ana@example.com")
    r = login(client, "ANA@example.com")  # email is case-insensitive
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["user"]["email"] == "ana@example.com"
    cookie = r.headers["set-cookie"]
    assert "ts_refresh=" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert "Path=/api/auth" in cookie
    assert "password_hash" not in r.text


def test_wrong_password_and_unknown_email_look_identical(client):
    make_user("ana@example.com")
    a = login(client, "ana@example.com", "wrong-password-123")
    b = login(client, "nobody@example.com", "wrong-password-123")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_account_locks_after_five_failures(client):
    make_user("ana@example.com")
    for _ in range(5):
        assert login(client, "ana@example.com", "wrong-password-123").status_code == 401
    r = login(client, "ana@example.com")  # even the right password is refused while locked
    assert r.status_code == 423 and "Try again" in r.json()["detail"]


def test_per_ip_rate_limit(client):
    for i in range(10):
        login(client, f"x{i}@example.com", "whatever-123456")
    assert login(client, "y@example.com", "whatever-123456").status_code == 429


def test_protected_routes_need_a_token(client):
    assert client.get("/api/signals/latest").status_code == 401
    assert client.get("/api/signals/latest", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_refresh_rotates_and_detects_reuse(client):
    make_user("ana@example.com")
    login(client, "ana@example.com")
    old_cookie = client.cookies.get("ts_refresh")

    assert client.post("/api/auth/refresh").status_code == 403  # CSRF header required
    r = client.post("/api/auth/refresh", headers=CSRF)
    assert r.status_code == 200
    new_cookie = client.cookies.get("ts_refresh")
    assert new_cookie != old_cookie

    # Replaying the old token (after the grace window) = theft: the whole family is revoked.
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import update
    from app.db import SessionLocal
    from app.models import RefreshToken
    with SessionLocal() as db:
        db.execute(update(RefreshToken).where(RefreshToken.revoked_at.is_not(None))
                   .values(revoked_at=datetime.now(timezone.utc) - timedelta(minutes=5)))
        db.commit()
    client.cookies.clear()
    client.cookies.set("ts_refresh", old_cookie, domain="testserver.local", path="/api/auth")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 401
    client.cookies.clear()
    client.cookies.set("ts_refresh", new_cookie, domain="testserver.local", path="/api/auth")
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 401  # family is dead


def test_logout_revokes_session(client):
    make_user("ana@example.com")
    login(client, "ana@example.com")
    assert client.post("/api/auth/logout", headers=CSRF).status_code == 204
    assert client.post("/api/auth/refresh", headers=CSRF).status_code == 401


def test_password_change_invalidates_old_tokens(client):
    make_user("ana@example.com")
    h = auth_header(client, "ana@example.com")
    import time
    time.sleep(1.1)  # token iat has 1s resolution
    r = client.post("/api/auth/change-password", headers=h,
                    json={"current_password": PASSWORD, "new_password": "Brand-New-Passphrase-9"})
    assert r.status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401
    assert login(client, "ana@example.com", "Brand-New-Passphrase-9").status_code == 200


def test_weak_passwords_rejected(client):
    make_user("ana@example.com")
    h = auth_header(client, "ana@example.com")
    for weak in ("short", "password123", "aaaaaaaaaaaaaa", "ana-is-my-name-2024"):
        r = client.post("/api/auth/change-password", headers=h,
                        json={"current_password": PASSWORD, "new_password": weak})
        assert r.status_code == 422, weak


def test_roles_are_enforced(client):
    make_user("viewer@example.com", Role.viewer)
    make_user("analyst@example.com", Role.analyst)
    make_user("boss@example.com", Role.admin)
    v = auth_header(client, "viewer@example.com")
    a = auth_header(client, "analyst@example.com")
    b = auth_header(client, "boss@example.com")
    assert client.get("/api/admin/users", headers=v).status_code == 403
    assert client.get("/api/admin/users", headers=a).status_code == 403
    assert client.get("/api/admin/users", headers=b).status_code == 200
    assert client.post("/api/backtests", headers=v, json={}).status_code == 403
    assert client.post("/api/backtests", headers=a, json={}).status_code == 202


def test_last_admin_cannot_be_removed(client):
    boss = make_user("boss@example.com", Role.admin)
    h = auth_header(client, "boss@example.com")
    r = client.patch(f"/api/admin/users/{boss.id}", headers=h, json={"role": "viewer"})
    assert r.status_code == 400


def test_deactivating_a_user_ends_their_session_immediately(client):
    make_user("boss@example.com", Role.admin)
    ana = make_user("ana@example.com")
    boss_h = auth_header(client, "boss@example.com")
    ana_h = auth_header(client, "ana@example.com")
    import time
    time.sleep(1.1)
    assert client.patch(f"/api/admin/users/{ana.id}", headers=boss_h, json={"is_active": False}).status_code == 200
    assert client.get("/api/auth/me", headers=ana_h).status_code == 401


def test_settings_validation_and_audit(client):
    make_user("boss@example.com", Role.admin)
    h = auth_header(client, "boss@example.com")
    bad = {"min_quote_volume_24h": 1e6, "min_history_days": 30, "regime_mode": "flag",
           "weights": {"trend": 50, "volume": 50, "relative_strength": 10, "breakout": 0, "rsi": 0, "no_chase": 0}}
    assert client.put("/api/admin/settings", headers=h, json=bad).status_code == 422
    good = dict(bad, weights={"trend": 40, "volume": 20, "relative_strength": 10, "breakout": 10, "rsi": 10,
                              "no_chase": 10})
    assert client.put("/api/admin/settings", headers=h, json=good).status_code == 200
    log = client.get("/api/admin/audit", headers=h, params={"action": "settings_changed"}).json()
    assert log["total"] == 1 and log["items"][0]["meta"]["after"]["weights"]["trend"] == 40


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["x-frame-options"] == "DENY" and r.headers["x-content-type-options"] == "nosniff"
