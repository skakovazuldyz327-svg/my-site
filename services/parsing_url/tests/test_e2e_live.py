"""Live smoke against a running crawl4ai-api (Docker).

Skipped automatically if the service is not up, unless CRAWL4AI_E2E_WAIT_S > 0
(CI waits for health=ready, then runs these checks).
"""

import os
import time
from typing import Dict, Optional

import httpx
import pytest

BASE_URL = os.getenv("CRAWL4AI_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
WAIT_S = int(os.getenv("CRAWL4AI_E2E_WAIT_S", "0"))
API_KEY = os.getenv("API_KEY", "")

pytestmark = pytest.mark.e2e


def _headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["X-API-Key"] = API_KEY
    return headers


def _health() -> Optional[dict]:
    try:
        response = httpx.get(f"{BASE_URL}/health", timeout=5.0)
        if response.status_code != 200:
            return None
        return response.json()
    except Exception:
        return None


@pytest.fixture(scope="module")
def live_client():
    deadline = time.time() + WAIT_S
    while True:
        body = _health()
        if body and body.get("browser") == "ready":
            break
        if time.time() >= deadline:
            pytest.skip(
                f"Live service not ready at {BASE_URL} "
                f"(set CRAWL4AI_E2E_WAIT_S to wait in CI; last health={body!r})"
            )
        time.sleep(3)

    with httpx.Client(base_url=BASE_URL, headers=_headers(), timeout=120.0) as client:
        yield client


def test_e2e_health_ready(live_client):
    body = live_client.get("/health").json()
    assert body["browser"] == "ready"
    assert body["status"] == "ok"


def test_e2e_blocks_localhost(live_client):
    response = live_client.post("/parse", json={"url": "http://127.0.0.1/"})
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert body["markdown"] is None
    assert body["cleaned_html"] is None
    assert "non-public" in (body["error_message"] or "")


def test_e2e_parses_example_com(live_client):
    response = live_client.post(
        "/parse",
        json={"url": "https://example.com", "bypass_cache": True},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["error_message"] is None
    assert body["markdown"]
    assert "Example Domain" in body["markdown"] or "example" in body["markdown"].lower()
