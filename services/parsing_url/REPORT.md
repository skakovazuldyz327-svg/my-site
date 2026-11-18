# Отчёт: сервис парсинга в Docker

**Задача:** упаковать парсинг веб-страниц в Docker так, чтобы сервис запускался одной командой и переносился между проектами.

**Результат:** сервис работает на http://localhost:8000/ (тестовая страница, API, healthcheck). Версия API: **1.2.0**.

## Состав

| Файл | Назначение |
|------|------------|
| `Dockerfile` | Python 3.11, crawl4ai, headless Chromium, пользователь `app` |
| `docker-compose.yml` | Локальный запуск: порт `127.0.0.1:8000`, лимиты RAM/CPU, healthcheck |
| `docker-compose.prod.yml` | Оверлей: обязательный `API_KEY`, `ALLOW_INSECURE=false` |
| `requirements.txt` / `requirements-dev.txt` | Зависимости сервиса и pytest |
| `app/main.py` | `POST /parse`, `GET /health`, SSRF-guard, автоперезапуск браузера |
| `app/static/index.html` | Страница для ручного теста |
| `tests/` | Unit/API + live e2e |
| `README.md` | Инструкция |

## Запуск

```bash
cd services/parsing_url
docker compose up -d --build
```

Более безопасный режим:

```bash
# PowerShell
$env:API_KEY = "my-secret-key-2026"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Проверки

| Проверка | Результат |
|----------|-----------|
| Контейнер | `User=app`, mem 2g, cpus 1.0, `no-new-privileges`, healthy только при `browser=ready` |
| Валидация | пустой/`ftp`/`file`/`javascript` → HTTP 422 |
| SSRF | localhost, private, metadata, hex/decimal IP, nip.io → `success=false`, контент `null` |
| Контракт ошибок | при ошибке `markdown`/`cleaned_html` всегда `null`; при успехе `error_message=null` |
| Автотесты | `pytest -m "not e2e"` (unit); `pytest -m e2e` при живом сервисе |
| CI | GitHub Actions: `.github/workflows/parsing-url.yml` |

## Ограничения

- Картинки/скрипты внутри страницы не проверяются по IP; DNS-rebinding полностью закрывается только сетевой изоляцией.
- Для публикации в сеть: `docker-compose.prod.yml` + не открывать порт наружу без необходимости.
