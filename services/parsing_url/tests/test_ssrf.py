import asyncio
import socket

import pytest

from app.main import BlockedURLError, ensure_public_url


def _addr(ip: str, port: int = 80):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))


@pytest.mark.asyncio
async def test_blocks_loopback_and_private(monkeypatch):
    cases = {
        "127.0.0.1": "127.0.0.1",
        "localhost": "127.0.0.1",
        "10.0.0.1": "10.0.0.1",
        "192.168.1.1": "192.168.1.1",
        "169.254.169.254": "169.254.169.254",
        "0.0.0.0": "0.0.0.0",
    }

    for host, ip in cases.items():
        async def fake_getaddrinfo(h, port, *args, _ip=ip, **kwargs):
            return [_addr(_ip, port if isinstance(port, int) else 80)]

        monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
        with pytest.raises(BlockedURLError, match="non-public"):
            await ensure_public_url(f"http://{host}/")


@pytest.mark.asyncio
async def test_allows_public_ip(monkeypatch):
    async def fake_getaddrinfo(host, port, *args, **kwargs):
        return [_addr("93.184.216.34", port if isinstance(port, int) else 80)]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    await ensure_public_url("https://example.com/")


@pytest.mark.asyncio
async def test_rejects_unsupported_scheme():
    with pytest.raises(BlockedURLError, match="Unsupported URL scheme"):
        await ensure_public_url("ftp://example.com/")


@pytest.mark.asyncio
async def test_resolve_failure(monkeypatch):
    async def boom(host, port, *args, **kwargs):
        raise socket.gaierror(11001, "getaddrinfo failed")

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", boom)
    with pytest.raises(BlockedURLError, match="Cannot resolve"):
        await ensure_public_url("http://no-such-host.invalid/")


@pytest.mark.asyncio
async def test_negative_cache_skips_dns_but_public_not_cached(monkeypatch):
    calls = {"n": 0}

    async def private_then_unused(host, port, *args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return [_addr("127.0.0.1", 80)]
        return [_addr("93.184.216.34", 80)]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", private_then_unused)
    with pytest.raises(BlockedURLError, match="non-public"):
        await ensure_public_url("http://evil.test/")
    # Second call must use negative cache (no extra DNS).
    with pytest.raises(BlockedURLError, match="non-public"):
        await ensure_public_url("http://evil.test/")
    assert calls["n"] == 1

    # Public hosts must be re-resolved every time (no positive cache / rebinding).
    calls["n"] = 0

    async def public_ip(host, port, *args, **kwargs):
        calls["n"] += 1
        return [_addr("93.184.216.34", 80)]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", public_ip)
    await ensure_public_url("https://example.com/")
    await ensure_public_url("https://example.com/")
    assert calls["n"] == 2
