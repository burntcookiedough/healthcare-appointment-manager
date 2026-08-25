"""Async SQLAlchemy engine and session lifecycle."""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import Settings, get_settings


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    """Create an async engine for the configured PostgreSQL database."""

    active = settings or get_settings()
    return create_async_engine(
        active.database_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        echo=False,
    )


engine = create_engine()
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """Yield one request-scoped session and always close it."""

    async with SessionFactory() as session:
        yield session
