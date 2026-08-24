"""Small explicit event-handler registry."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterable

from .envelope import EventEnvelope
from .results import ProcessingResult

EventHandler = Callable[[EventEnvelope], ProcessingResult | Awaitable[ProcessingResult]]


class HandlerRegistry:
    """Map versioned event type names to pure handler callables."""

    def __init__(self, handlers: Iterable[tuple[str, EventHandler]] = ()) -> None:
        self._handlers: dict[str, EventHandler] = {}
        for event_type, handler in handlers:
            self.register(event_type, handler)

    def register(self, event_type: str, handler: EventHandler, *, replace: bool = False) -> None:
        normalized = event_type.strip()
        if not normalized:
            raise ValueError("event_type cannot be empty")
        if normalized in self._handlers and not replace:
            raise ValueError(f"handler already registered for {normalized}")
        self._handlers[normalized] = handler

    def resolve(self, event_type: str) -> EventHandler | None:
        return self._handlers.get(event_type)

    @property
    def event_types(self) -> frozenset[str]:
        return frozenset(self._handlers)
