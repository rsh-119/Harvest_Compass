import pytest

from app.http import describe


def test_describe_masks_keys_in_urls() -> None:
    e = RuntimeError(
        "403 for url 'https://api.data.gov.in/resource/x?api-key=SECRET123&format=json'"
    )
    out = describe(e)
    assert "SECRET123" not in out
    assert "api-key=***&format=json" in out
    assert out.startswith("RuntimeError: ")


def test_plain_errors_have_no_urls_or_exception_names() -> None:
    import httpx

    from app.http import plain

    req = httpx.Request("GET", "https://api.data.gov.in/resource/x?api-key=SECRET")
    e = httpx.HTTPStatusError("403", request=req, response=httpx.Response(403, request=req))
    assert plain(e) == "the source refused this server"
    assert plain(httpx.ReadTimeout("timed out", request=req)) == "no answer within 5 seconds"


def test_data_gov_in_breaker_skips_calls_after_a_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    import httpx

    from app.tools import mandi

    calls = 0

    async def refuse(*a: object, **k: object) -> None:
        nonlocal calls
        calls += 1
        req = httpx.Request("GET", "https://api.data.gov.in/")
        raise httpx.HTTPStatusError("403", request=req, response=httpx.Response(403, request=req))

    monkeypatch.setattr(mandi, "request_json", refuse)
    monkeypatch.setattr(mandi, "_skip_until", 0.0)
    for _ in range(3):
        with pytest.raises((httpx.HTTPStatusError, mandi.SourceSkipped)):
            asyncio.run(mandi._fetch_all(mandi.CURRENT_ID, {}))
    assert calls == 1  # the first refusal opened the breaker; the next two never left the server
