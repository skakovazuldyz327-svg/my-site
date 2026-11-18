from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main as app_main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_main, "ensure_warmup", lambda: None)

    async def _noop_close():
        return None

    monkeypatch.setattr(app_main.crawler_holder, "close", _noop_close)
    app_main.crawler_holder.state = "ready"
    with TestClient(app_main.app) as test_client:
        yield test_client


def test_health_ready(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "browser": "ready"}


def test_health_error_status(client):
    app_main.crawler_holder.state = "error"
    response = client.get("/health")
    assert response.json() == {"status": "error", "browser": "error"}


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"url": ""},
        {"url": "not-a-url"},
        {"url": "ftp://example.com/"},
        {"url": "file:///etc/passwd"},
        {"url": "javascript:alert(1)"},
    ],
)
def test_parse_rejects_bad_urls(client, payload):
    response = client.post("/parse", json=payload)
    assert response.status_code == 422


def test_parse_blocks_private_before_crawl(client, monkeypatch):
    crawl = AsyncMock()
    monkeypatch.setattr(app_main, "_crawl", crawl)
    response = client.post("/parse", json={"url": "http://127.0.0.1/"})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["markdown"] is None
    assert body["cleaned_html"] is None
    assert "non-public" in body["error_message"]
    crawl.assert_not_awaited()


def test_fail_contract_null_content_on_crawl_error(client, monkeypatch):
    async def fake_public(url: str) -> None:
        return None

    async def fake_crawl(url, run_config):
        return SimpleNamespace(
            success=False,
            redirected_url=url,
            markdown="# leaked",
            cleaned_html="<p>leaked</p>",
            error_message="Blocked by anti-bot protection",
        )

    monkeypatch.setattr(app_main, "ensure_public_url", fake_public)
    monkeypatch.setattr(app_main, "_crawl", fake_crawl)

    response = client.post("/parse", json={"url": "https://example.com/"})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["markdown"] is None
    assert body["cleaned_html"] is None
    assert body["error_message"] == "Blocked by anti-bot protection"


def test_success_null_error_message(client, monkeypatch):
    async def fake_public(url: str) -> None:
        return None

    async def fake_crawl(url, run_config):
        return SimpleNamespace(
            success=True,
            redirected_url=url,
            markdown="Hello",
            cleaned_html="<p>Hello</p>",
            error_message="",
        )

    monkeypatch.setattr(app_main, "ensure_public_url", fake_public)
    monkeypatch.setattr(app_main, "_crawl", fake_crawl)

    response = client.post("/parse", json={"url": "https://example.com/"})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["markdown"] == "Hello"
    assert body["cleaned_html"] == "<p>Hello</p>"
    assert body["error_message"] is None


def test_blocks_redirect_to_private_after_crawl(client, monkeypatch):
    async def fake_crawl(url, run_config):
        return SimpleNamespace(
            success=True,
            redirected_url="http://127.0.0.1/secret",
            markdown="secret",
            cleaned_html="<p>secret</p>",
            error_message="",
        )

    # Initial URL is treated as public; final redirected_url must be blocked.
    async def selective_public(url: str) -> None:
        if "127.0.0.1" in url:
            raise app_main.BlockedURLError("URL host '127.0.0.1' resolves to a non-public address")

    monkeypatch.setattr(app_main, "ensure_public_url", selective_public)
    monkeypatch.setattr(app_main, "_crawl", fake_crawl)

    response = client.post("/parse", json={"url": "https://example.com/"})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["markdown"] is None
    assert body["cleaned_html"] is None
    assert "non-public" in body["error_message"]


def test_fail_response_helper():
    body = app_main.fail_response("https://x.test/", "boom")
    assert body.success is False
    assert body.markdown is None
    assert body.cleaned_html is None
    assert body.error_message == "boom"
