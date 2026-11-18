import asyncio
import ipaddress
import logging
import os
import secrets
import socket
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, HttpUrl

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("crawl4ai-service")

MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "2"))
PAGE_TIMEOUT_MS = int(os.getenv("PAGE_TIMEOUT_MS", "60000"))
REQUEST_TIMEOUT_S = float(os.getenv("REQUEST_TIMEOUT_S", "120"))
WARMUP_RETRY_S = float(os.getenv("WARMUP_RETRY_S", "30"))
API_KEY = os.getenv("API_KEY", "")
ALLOW_PRIVATE_URLS = os.getenv("ALLOW_PRIVATE_URLS", "false").lower() == "true"
ALLOW_INSECURE = os.getenv("ALLOW_INSECURE", "false").lower() == "true"

INDEX_HTML = Path(__file__).parent / "static" / "index.html"
# Images stay open (img-src *) because the sandboxed preview of a parsed page inherits this policy.
INDEX_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
        "img-src * data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-cache",
}


class ParseRequest(BaseModel):
    url: HttpUrl
    bypass_cache: bool = True


class ParseResponse(BaseModel):
    success: bool
    url: str
    markdown: Optional[str] = None
    cleaned_html: Optional[str] = None
    error_message: Optional[str] = None


class BlockedURLError(Exception):
    pass


def fail_response(url: str, error_message: str) -> ParseResponse:
    """API contract: on failure content fields are always null."""
    return ParseResponse(
        success=False,
        url=url,
        markdown=None,
        cleaned_html=None,
        error_message=error_message,
    )


class CrawlerHolder:
    """Lazily starts a single shared browser and replaces it if Chromium dies."""

    def __init__(self) -> None:
        self._crawler: Optional[AsyncWebCrawler] = None
        self._lock = asyncio.Lock()
        self.state = "starting"

    async def get(self) -> AsyncWebCrawler:
        if self._crawler is not None:
            return self._crawler
        async with self._lock:
            if self._crawler is None:
                if self.state != "error":
                    self.state = "starting"
                crawler = AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False))
                try:
                    await crawler.start()
                    # Abort private/loopback navigations and redirects before they load.
                    crawler.crawler_strategy.set_hook(
                        "on_page_context_created", _install_ssrf_route_guard
                    )
                except BaseException:
                    self.state = "error"
                    with suppress(Exception):
                        await crawler.close()
                    raise
                self._crawler = crawler
                self.state = "ready"
                logger.info("Browser started")
        return self._crawler

    @property
    def running(self) -> bool:
        return self._crawler is not None

    def _is_alive(self) -> bool:
        manager = getattr(getattr(self._crawler, "crawler_strategy", None), "browser_manager", None)
        browser = getattr(manager, "browser", None)
        return browser is None or browser.is_connected()

    async def reset_if_dead(self) -> bool:
        async with self._lock:
            if self._crawler is None or self._is_alive():
                return False
            logger.warning("Browser connection lost, restarting it")
            crawler, self._crawler = self._crawler, None
            self.state = "starting"
            with suppress(Exception):
                await crawler.close()
            return True

    async def close(self) -> None:
        if self._crawler is not None:
            await self._crawler.close()
            self._crawler = None
            logger.info("Browser stopped")


crawler_holder = CrawlerHolder()
semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
# Negative-only cache: remember blocked hosts briefly. Never cache "public" —
# a positive cache would widen the DNS-rebinding window.
_HOST_BLOCK_TTL_S = 60.0
_host_block_until: dict[str, float] = {}


def require_api_key(key: Optional[str] = Security(api_key_header)) -> None:
    # Headers arrive latin-1 decoded and compare_digest rejects non-ASCII str, so compare raw bytes.
    if API_KEY and not (
        key and secrets.compare_digest(key.encode("latin-1", "replace"), API_KEY.encode("utf-8"))
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


def _remember_blocked_host(host: str) -> None:
    _host_block_until[host] = asyncio.get_running_loop().time() + _HOST_BLOCK_TTL_S


def _is_recently_blocked(host: str) -> bool:
    until = _host_block_until.get(host)
    if until is None:
        return False
    if asyncio.get_running_loop().time() >= until:
        _host_block_until.pop(host, None)
        return False
    return True


async def ensure_public_url(url: str) -> None:
    """Rejects URLs whose host resolves to a loopback, private, link-local or reserved address."""
    if ALLOW_PRIVATE_URLS:
        return
    parts = urlsplit(url)
    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise BlockedURLError(f"Unsupported URL scheme '{scheme or '?'}'")
    host = parts.hostname or ""
    if not host:
        raise BlockedURLError("URL has no hostname")
    port = parts.port or (443 if scheme == "https" else 80)

    if _is_recently_blocked(host):
        raise BlockedURLError(f"URL host '{host}' resolves to a non-public address")

    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise BlockedURLError(f"Cannot resolve host '{host}': {exc}") from exc

    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        if not ip.is_global:
            _remember_blocked_host(host)
            raise BlockedURLError(f"URL host '{host}' resolves to a non-public address ({ip})")


async def _install_ssrf_route_guard(page, context=None, **kwargs):
    """Playwright route: block document/XHR hops (incl. redirects) to non-public hosts.

    Checking every image/font would stall Chromium under CPU limits; subresources
    remain a residual risk — use network isolation for internet-facing deploys.
    """

    async def _handler(route):
        if ALLOW_PRIVATE_URLS:
            await route.continue_()
            return
        request = route.request
        # document = top-level navigations and HTTP redirects between them
        if request.resource_type not in ("document", "xhr", "fetch"):
            await route.continue_()
            return
        req_url = request.url
        parts = urlsplit(req_url)
        if parts.scheme in ("data", "blob", "about"):
            await route.continue_()
            return
        try:
            await ensure_public_url(req_url)
        except BlockedURLError as exc:
            logger.warning("SSRF guard blocked %s (%s)", req_url, exc)
            await route.abort("blockedbyclient")
            return
        except Exception:
            logger.exception("SSRF guard failed for %s", req_url)
            await route.abort("failed")
            return
        await route.continue_()

    await page.route("**/*", _handler)
    return page


async def _warmup() -> None:
    while True:
        try:
            await crawler_holder.get()
            return
        except Exception:
            logger.exception("Browser warmup failed, retrying in %.0fs", WARMUP_RETRY_S)
            await asyncio.sleep(WARMUP_RETRY_S)


_warmup_task: Optional[asyncio.Task] = None


def ensure_warmup() -> None:
    global _warmup_task
    if _warmup_task is None or _warmup_task.done():
        _warmup_task = asyncio.create_task(_warmup())


async def recover_browser() -> None:
    """After a failed request: drop a dead browser and keep starting a new one in the background."""
    await crawler_holder.reset_if_dead()
    if not crawler_holder.running:
        ensure_warmup()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not API_KEY:
        if ALLOW_INSECURE:
            logger.warning("API_KEY is empty — /parse is open (ALLOW_INSECURE=true)")
        else:
            raise RuntimeError(
                "API_KEY is required when ALLOW_INSECURE=false. "
                "Set API_KEY or ALLOW_INSECURE=true for local use."
            )
    ensure_warmup()
    try:
        yield
    finally:
        if _warmup_task is not None:
            _warmup_task.cancel()
            with suppress(asyncio.CancelledError):
                await _warmup_task
        await crawler_holder.close()


app = FastAPI(title="Crawl4AI Service", version="1.2.0", lifespan=lifespan)


@app.get("/", include_in_schema=False)
async def index() -> FileResponse:
    return FileResponse(INDEX_HTML, headers=INDEX_HEADERS)


@app.get("/health")
async def health():
    browser = crawler_holder.state
    if browser == "ready":
        status = "ok"
    elif browser == "error":
        status = "error"
    else:
        status = "starting"
    return {"status": status, "browser": browser}


async def _crawl(url: str, run_config: CrawlerRunConfig):
    """Runs the crawl, retrying once on a fresh browser if Chromium died mid-request."""
    for attempt in range(2):
        crawler = await crawler_holder.get()
        try:
            async with semaphore:
                result = await crawler.arun(url=url, config=run_config)
        except Exception:
            if attempt == 0 and await crawler_holder.reset_if_dead():
                continue
            raise
        if not result.success and attempt == 0 and await crawler_holder.reset_if_dead():
            continue
        return result


@app.post("/parse", response_model=ParseResponse, dependencies=[Depends(require_api_key)])
async def parse(body: ParseRequest) -> ParseResponse:
    url = str(body.url)
    run_config = CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS if body.bypass_cache else CacheMode.ENABLED,
        page_timeout=PAGE_TIMEOUT_MS,
        verbose=False,
    )

    try:
        await ensure_public_url(url)
        result = await asyncio.wait_for(_crawl(url, run_config), timeout=REQUEST_TIMEOUT_S)
        # Defense in depth: final URL after redirects (route guard already blocked private hops).
        final_url = getattr(result, "redirected_url", None) or url
        if final_url != url:
            await ensure_public_url(final_url)
    except BlockedURLError as exc:
        return fail_response(url, str(exc))
    except asyncio.TimeoutError:
        logger.warning("Request timed out for %s", url)
        await recover_browser()
        return fail_response(url, f"Request timed out after {REQUEST_TIMEOUT_S:.0f}s")
    except Exception as exc:
        logger.exception("Crawl failed for %s", url)
        await recover_browser()
        return fail_response(url, str(exc))

    success = bool(result.success)
    if not success:
        return fail_response(
            url, result.error_message or "Crawl failed"
        )

    markdown = result.markdown
    if markdown is not None:
        markdown = getattr(markdown, "raw_markdown", None) or str(markdown)

    return ParseResponse(
        success=True,
        url=url,
        markdown=markdown,
        cleaned_html=result.cleaned_html,
        # crawl4ai reports "" on success; the API contract is null.
        error_message=result.error_message or None,
    )
