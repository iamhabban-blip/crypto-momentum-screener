"""Database engine and session factory."""

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_size=_settings.db_pool_size,
    max_overflow=5,
    pool_pre_ping=True,
    pool_recycle=1800,
)


@event.listens_for(engine, "connect")
def _set_session_limits(dbapi_conn, _record):
    # Guard rail: no single query may hold a connection for longer than this.
    with dbapi_conn.cursor() as cur:
        cur.execute(f"SET statement_timeout = {int(_settings.db_statement_timeout_ms)}")
        cur.execute("SET TIME ZONE 'UTC'")
    dbapi_conn.commit()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
