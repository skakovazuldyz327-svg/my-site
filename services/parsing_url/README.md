# Crawl4AI Service

Легковесный REST-микросервис на FastAPI поверх [crawl4ai](https://github.com/unclecode/crawl4ai) (`AsyncWebCrawler` + headless Chromium в Docker).

## Структура

```
parsing_url/
├── app/
│   └── main.py          # FastAPI: POST /parse, GET /health
├── Dockerfile           # python:3.11-slim + Playwright Chromium
├── docker-compose.yml   # сервис crawl4ai-api, порт 8000
├── requirements.txt
└── .dockerignore
```

## 1. Запуск

Требуется Docker с Compose v2.

```bash
cd parsing_url
docker compose up -d --build
```

Проверить статус (через ~30 секунд контейнер должен стать `healthy`):

```bash
docker compose ps
docker compose logs -f crawl4ai-api
```

Остановка:

```bash
docker compose down
```

## 2. Проверка API

### Health-check

```bash
curl http://localhost:8000/health
# {"status":"ok","browser":"ready"}
```

`browser` показывает состояние Chromium: `starting` (запускается), `ready` (готов), `error` (не удалось запустить; сервис повторяет попытку каждые 30 секунд, а Docker помечает контейнер как `unhealthy`). Первый запуск браузера на слабой машине может занять несколько минут.

### Парсинг страницы

Linux / macOS / Git Bash:

```bash
curl -X POST http://localhost:8000/parse \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "bypass_cache": true}'
```

Windows PowerShell (`curl.exe` в PowerShell 5 ломает кавычки в JSON, поэтому используйте `Invoke-RestMethod`):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/parse `
  -ContentType "application/json" `
  -Body '{"url": "https://example.com", "bypass_cache": true}'
```

Пример ответа:

```json
{
  "success": true,
  "url": "https://example.com/",
  "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
  "cleaned_html": "<div><h1>Example Domain</h1>...</div>",
  "error_message": null
}
```

Если страницу не удалось загрузить, сервис отвечает HTTP 200 с `"success": false` и текстом ошибки в `error_message`. Некорректный URL в запросе возвращает HTTP 422.

Интерактивная документация Swagger: http://localhost:8000/docs

## Безопасность

- **Доступ только с этого компьютера.** Порт опубликован как `127.0.0.1:8000`. Чтобы открыть сервис для локальной сети, замените в `docker-compose.yml` строку на `"8000:8000"` и обязательно задайте `API_KEY`.
- **API-ключ.** Если переменная `API_KEY` задана, `/parse` требует заголовок `X-API-Key`; без него или с неверным ключом сервис вернёт HTTP 401. `/health` доступен без ключа.

  ```powershell
  $env:API_KEY = "мой-секретный-ключ"; docker compose up -d
  ```

  ```bash
  curl -X POST http://localhost:8000/parse \
    -H "Content-Type: application/json" \
    -H "X-API-Key: мой-секретный-ключ" \
    -d '{"url": "https://example.com"}'
  ```

- **Внутренние адреса заблокированы.** URL, которые указывают на `localhost`, приватные сети (`10.x`, `172.16–31.x`, `192.168.x`), `169.254.x` (метаданные облаков) и `host.docker.internal`, отклоняются с `"success": false`. Если редирект увёл на такой адрес, контент тоже не возвращается. Отключить проверку можно через `ALLOW_PRIVATE_URLS=true`.

## Надёжность

- Если Chromium упал, сервис замечает это, перезапускает браузер и один раз повторяет запрос.
- Каждый запрос ограничен по времени (`REQUEST_TIMEOUT_S`), включая ожидание очереди и запуск браузера.
- Контейнер ограничен 2 ГБ памяти (`mem_limit` в `docker-compose.yml`).

## Настройки

Переменные окружения (задаются в `docker-compose.yml`):

| Переменная           | По умолчанию | Описание                                          |
|----------------------|--------------|---------------------------------------------------|
| `MAX_CONCURRENCY`    | `2`          | Максимум одновременных запросов к браузеру        |
| `PAGE_TIMEOUT_MS`    | `60000`      | Таймаут загрузки страницы, мс                     |
| `REQUEST_TIMEOUT_S`  | `240`        | Общий таймаут одного запроса `/parse`, секунды    |
| `API_KEY`            | пусто        | Если задан, `/parse` требует заголовок `X-API-Key` |
| `ALLOW_PRIVATE_URLS` | `false`      | Разрешить парсинг localhost и приватных сетей     |
| `LOG_LEVEL`          | `INFO`       | Уровень логирования                               |
