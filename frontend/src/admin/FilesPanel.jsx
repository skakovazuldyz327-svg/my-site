import { useState } from "react";
import { formatDate } from "./utils.js";

const decimal = (value) => value.toFixed(1).replace(/\.0$/, "").replace(".", ",");

function size(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${decimal(bytes / 1024 / 1024)} МБ`;
  return `${decimal(bytes / 1024 / 1024 / 1024)} ГБ`;
}

function FileCard({ file, onDownload, onDelete }) {
  const [busy, setBusy] = useState(false);
  const run = (action) => async () => {
    setBusy(true);
    await action(file);
    setBusy(false);
  };

  return (
    <li className="card">
      <div className="order-head client-head">
        <div>
          <p className="list-name chat-file-name">{file.name}</p>
          <p className="list-meta">{formatDate(file.createdAt)} · {size(file.size)}</p>
        </div>
        {file.session && <span className="card-badge" title="Этот номер клиент пришлёт вам в сообщении WhatsApp. Файлы с одинаковым номером — от одного посетителя">чат {file.session.slice(0, 6).toUpperCase()}</span>}
      </div>
      {file.text && <p className="chat-file-text">«{file.text}»</p>}
      <div className="order-actions">
        <button className="order-btn" type="button" disabled={busy} onClick={run(onDownload)}>Скачать</button>
        <button className="order-btn order-btn-danger" type="button" disabled={busy} onClick={run(onDelete)}>Удалить</button>
      </div>
    </li>
  );
}

export default function FilesPanel({ hidden, files, usage, onRefresh, onDownload, onDelete }) {
  return (
    <section className="panel" hidden={hidden}>
      <div className="panel-head">
        <h1>Файлы из чата <span className="count">· {files.length}</span></h1>
        <button className="btn btn-ghost" type="button" onClick={onRefresh}>Обновить</button>
      </div>
      {usage && (
        <p className="backup-note">
          Занято {size(usage.usedBytes)} из {size(usage.totalBytes)}. Файлы хранятся {usage.days} дней, потом удаляются сами — нужные скачайте.
        </p>
      )}
      <ul className="cards">
        {files.length ? (
          files.map((file) => <FileCard key={file.id} file={file} onDownload={onDownload} onDelete={onDelete} />)
        ) : (
          <li className="empty">Здесь появятся файлы и фото, которые клиенты пришлют в чате на сайте.</li>
        )}
      </ul>
    </section>
  );
}
