FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CRAWL4_AI_BASE_DIRECTORY=/home/app

WORKDIR /app

COPY requirements.txt .

# The pip cache lives in a BuildKit cache mount, so it never lands in the image.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Headless crawling launches only chrome-headless-shell, so the full Chromium build is skipped.
RUN playwright install --with-deps --only-shell chromium \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/*

RUN useradd --create-home --home-dir /home/app --shell /usr/sbin/nologin app

USER app

# The first Chromium launch builds the fontconfig cache, which can exceed Playwright's
# 3-minute launch timeout on slow hosts; doing it at build time keeps container starts fast.
RUN timeout 600 /ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell \
        --no-sandbox --disable-gpu --disable-dev-shm-usage --dump-dom about:blank >/dev/null 2>&1; \
    ls /home/app/.cache/fontconfig >/dev/null

COPY --chown=app:app app ./app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
