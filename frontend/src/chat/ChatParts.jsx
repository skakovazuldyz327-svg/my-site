import { canRead, fileSize } from "../lib/attachments.js";
import { linkWithChatLabel } from "../lib/chatThread.js";

export function FileChip({ file, showStatus }) {
  return (
    <span className="chat-file">
      <span className="chat-file-icon" aria-hidden="true">{(file.name.split(".").pop() || "файл").slice(0, 4)}</span>
      <span>
        <strong>{file.name}</strong>
        <small>
          {showStatus
            ? `${fileSize(file.size)} · ${canRead(file) ? "консультант прочитает" : "прочитать не получится"}`
            : fileSize(file.size)}
        </small>
      </span>
    </span>
  );
}

function FilesBlock({ files }) {
  return (
    <div className="chat-files">
      {files.map((file, index) =>
        file.src ? (
          <img key={index} className="chat-file-img" src={file.src} alt={file.name} title={file.name} />
        ) : (
          <FileChip key={index} file={file} />
        )
      )}
    </div>
  );
}

function ProductLink({ product }) {
  return (
    <a className="chat-card" href={product.id ? `product.html?id=${encodeURIComponent(product.id)}` : "products.html"}>
      {typeof product.image === "string" && product.image.startsWith("images/") && <img src={product.image} alt="" />}
      <span>
        <strong>{product.name}</strong>
        <small>{[product.price, product.meta].filter(Boolean).join(" · ")}</small>
      </span>
    </a>
  );
}

function Handoff({ handoff, withFiles }) {
  const link = withFiles === "saved" ? linkWithChatLabel(handoff.link) : handoff.link;
  return (
    <div className="chat-handoff">
      <p className="chat-handoff-title">Связаться с Жулдыз</p>
      {handoff.note && <p className="chat-handoff-note">{handoff.note}</p>}
      <div className="chat-handoff-actions">
        <a className="chat-handoff-wa" href={link} target="_blank" rel="noopener">Написать в WhatsApp</a>
        {handoff.phone && <a className="chat-handoff-call" href={`tel:${handoff.phone}`}>Позвонить</a>}
      </div>
      <p className="chat-handoff-note">
        {withFiles === "saved"
          ? "Сообщение с вашим вопросом и номером чата уже написано, а файлы из чата Жулдыз уже получила — прикладывать их заново не нужно."
          : withFiles
            ? "Сообщение с вашим вопросом уже написано. Файлы из чата прикрепите в WhatsApp сами — по ссылке они не передаются."
            : "Сообщение с вашим вопросом уже написано — останется нажать «Отправить»."}
      </p>
    </div>
  );
}

const UPLOAD_NOTES = {
  sending: "Передаю файлы Жулдыз…",
  saved: "✓ Жулдыз получила файлы",
  failed: "Файлы не дошли до Жулдыз — отправьте их ей в WhatsApp"
};

export function ChatTurn({ item, withFiles }) {
  return (
    <div className={`chat-turn chat-turn-${item.role}`}>
      {item.files?.length > 0 && <FilesBlock files={item.files} />}
      {item.files?.length > 0 && UPLOAD_NOTES[item.upload] && (
        <p className={`chat-upload chat-upload-${item.upload}`}>{UPLOAD_NOTES[item.upload]}</p>
      )}
      {item.text && <p className={`chat-msg chat-msg-${item.role}`}>{item.text}</p>}
      {(item.products || []).map((product, index) => <ProductLink key={index} product={product} />)}
      {item.handoff && <Handoff handoff={item.handoff} withFiles={withFiles} />}
    </div>
  );
}
