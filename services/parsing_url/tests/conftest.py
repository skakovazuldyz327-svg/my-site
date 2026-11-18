import os

# App reads these at import time — set before any test imports app.main.
os.environ.setdefault("ALLOW_INSECURE", "true")
os.environ.setdefault("ALLOW_PRIVATE_URLS", "false")
os.environ.setdefault("API_KEY", "")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import pytest

from app import main as app_main


@pytest.fixture(autouse=True)
def _clear_ssrf_cache():
    app_main._host_public_cache.clear()
    yield
    app_main._host_public_cache.clear()


@pytest.fixture
def anyio_backend():
    return "asyncio"
