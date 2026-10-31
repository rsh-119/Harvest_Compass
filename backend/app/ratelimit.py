"""Protect paid credits (OpenRouter, Sarvam) on a public link: per-visitor and global caps.

ponytail: in-memory sliding windows, so limits reset on restart and only hold on one instance.
That's fine for one free Render instance; use Redis if we ever run several.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

PER_VISITOR = (10, 60.0)  # 10 paid calls a minute per visitor
GLOBAL = (300, 3600.0)  # and 300 an hour for everyone together

_hits: dict[str, deque[float]] = defaultdict(deque)


def _allow(key: str, limit: int, window: float, now: float) -> bool:
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def visitor_ip(request: Request) -> str:
    # Render sits behind Cloudflare, which overwrites CF-Connecting-IP with the real client.
    # Otherwise take the right-most X-Forwarded-For entry (added by our proxy, not the client).
    if ip := request.headers.get("cf-connecting-ip"):
        return ip
    if xff := request.headers.get("x-forwarded-for"):
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def limit(request: Request) -> None:
    """FastAPI dependency for the routes that spend credits."""
    now = time.monotonic()
    if not _allow("ip:" + visitor_ip(request), *PER_VISITOR, now):
        raise HTTPException(429, "बहुत सारे सवाल — एक मिनट रुककर पूछें (too many requests)")
    if not _allow("global", *GLOBAL, now):
        raise HTTPException(429, "अभी बहुत लोग पूछ रहे हैं — थोड़ी देर बाद (service busy)")
