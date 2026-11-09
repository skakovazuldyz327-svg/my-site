import asyncio
import ipaddress
import logging
import os
import secrets
import socket
from contextlib import asynccontextmanager, suppress
from typing import Optional
from urllib.parse import urlsplit

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig
from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, HttpUrl

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("crawl4ai-service")

MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "2"))
PAGE_TIMEOUT_MS = int(os.getenv("PAGE_TIMEOUT_MS", "60000"))
REQUEST_TIMEOUT_S = float(os.getenv("REQUEST_TIMEOUT_S", "240"))
WARMUP_RETRY_S = float(os.getenv("WARMUP_RETRY_S", "30"))
API_KEY = os.getenv("API_KEY", "")
ALLOW_PRIVATE_URLS = os.getenv("ALLOW_PRIVATE_URLS", "false").lower() == "true"


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


def require_api_key(key: Optional[str] = Security(api_key_header)) -> None:
    # Headers arrive latin-1 decoded and compare_digest rejects non-ASCII str, so compare raw bytes.
    if API_KEY and not (
        key and secrets.compare_digest(key.encode("latin-1", "replace"), API_KEY.encode("utf-8"))
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


async def ensure_public_url(url: str) -> None:
    """Rejects URLs whose host resolves to a loopback, private, link-local or reserved address."""
    if ALLOW_PRIVATE_URLS:
        return
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise BlockedURLError(f"Cannot resolve host '{host}': {exc}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise BlockedURLError(f"URL host '{host}' resolves to a non-public address ({ip})")


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
    ensure_warmup()
    try:
        yield
    finally:
        if _warmup_task is not None:
            _warmup_task.cancel()
            with suppress(asyncio.CancelledError):
                await _warmup_task
        await crawler_holder.close()


app = FastAPI(title="Crawl4AI Service", version="1.1.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "browser": crawler_holder.state}


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
        if result.redirected_url and result.redirected_url != url:
            await ensure_public_url(result.redirected_url)
    except BlockedURLError as exc:
        return ParseResponse(success=False, url=url, error_message=str(exc))
    except asyncio.TimeoutError:
        logger.warning("Request timed out for %s", url)
        await recover_browser()
        return ParseResponse(
            success=False, url=url, error_message=f"Request timed out after {REQUEST_TIMEOUT_S:.0f}s"
        )
    except Exception as exc:
        logger.exception("Crawl failed for %s", url)
        await recover_browser()
        return ParseResponse(success=False, url=url, error_message=str(exc))

    markdown = result.markdown
    if markdown is not None:
        markdown = getattr(markdown, "raw_markdown", None) or str(markdown)

    success = bool(result.success)
    return ParseResponse(
        success=success,
        url=url,
        markdown=markdown,
        cleaned_html=result.cleaned_html,
        # crawl4ai reports "" on success; the API contract is null.
        error_message=result.error_message or (None if success else "Crawl failed"),
    )
