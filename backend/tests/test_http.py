from app.http import describe


def test_describe_masks_keys_in_urls() -> None:
    e = RuntimeError(
        "403 for url 'https://api.data.gov.in/resource/x?api-key=SECRET123&format=json'"
    )
    out = describe(e)
    assert "SECRET123" not in out
    assert "api-key=***&format=json" in out
    assert out.startswith("RuntimeError: ")
