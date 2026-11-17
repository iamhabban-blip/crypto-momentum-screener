"""Small in-process sliding-window rate limiter for sensitive endpoints (login, refresh).

Per-account brute force is also stopped in the database by the lockout rule (see routers/auth.py),
so this limiter only has to slow down one client hammering many accounts.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: int = 60):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                retry = int(self.window - (now - q[0])) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please wait and try again.",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def client_ip(request: Request) -> str:
    # Behind the bundled nginx the real client IP arrives in X-Real-IP; nginx overwrites any
    # value the client sends, so it can't be spoofed through the proxy.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")
