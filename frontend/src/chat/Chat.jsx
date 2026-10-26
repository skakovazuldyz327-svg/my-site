import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHAT_MAX_FILES, CHAT_MAX_SIZE, chatRequest, fileSize, readAttachment } from "../lib/attachments.js";
import { CHAT_KEY, askAi, cleanHandoff, loadThread, rulesHistory, saveThread, uploadChatFiles } from "../lib/chatThread.js";
import { askConsultant, consultantHandoff } from "../lib/consultant.js";
import { storageGet, storageRemove, storageSet } from "../lib/storage.js";
import { ChatTurn, FileChip } from "./ChatParts.jsx";

const CHAT_SEEN = "zhuldyz-consultant-seen";
const CHAT_WIDTH = "zhuldyz-consultant-width";
const CHAT_HEIGHT = "zhuldyz-consultant-height";
const chatPrompts = [];

function rem() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function clampWidth(width) {
  if (!width) return 0;
  const r = rem();
  const min = 18 * r;
  const max = Math.max(min, Math.min(48 * r, window.innerWidth - 2.2 * r));
  return Math.round(Math.min(max, Math.max(min, width)));
}

function clampHeight(height) {
  if (!height) return 0;
  const r = rem();
  const min = 20 * r;
  const max = Math.max(min, window.innerHeight - 6 * r);
  return Math.round(Math.min(max, Math.max(min, height)));
}

function store(key, value, save) {
  if (!save) return;
  if (value) storageSet(key, value);
  else storageRemove(key);
}

export default function Chat() {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState(loadThread);
  const threadRef = useRef(thread);
  const [chips, setChips] = useState(() => (thread.some((item) => item.role === "user") ? ["Написать Жулдыз"] : chatPrompts));
  const [badge, setBadge] = useState(() => !storageGet(CHAT_SEEN));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState({ pending: [], reading: 0 });
  const filesRef = useRef(files);
  const [attachNote, setAttachNote] = useState("");
  const [width, setWidthState] = useState(() => clampWidth(Number(storageGet(CHAT_WIDTH)) || 0));
  const [height, setHeightState] = useState(() => clampHeight(Number(storageGet(CHAT_HEIGHT)) || 0));
  const [resizing, setResizing] = useState("");
  const [dragover, setDragover] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);

  const panelRef = useRef(null);
  const logRef = useRef(null);
  const fieldRef = useRef(null);
  const fileInputRef = useRef(null);
  const photoInputRef = useRef(null);
  const attachRef = useRef(null);
  const attachMenuRef = useRef(null);
  const launchRef = useRef(null);

  const close = () => {
    if (panelRef.current.contains(document.activeElement)) launchRef.current.focus();
    setOpen(false);
  };

  const setWidth = (value, save = true) => {
    const next = clampWidth(value);
    setWidthState(next);
    store(CHAT_WIDTH, next, save);
  };

  const setHeight = (value, save = true) => {
    const next = clampHeight(value);
    setHeightState(next);
    store(CHAT_HEIGHT, next, save);
  };

  const updateFiles = (change) => {
    filesRef.current = change(filesRef.current);
    setFiles(filesRef.current);
  };

  const remember = (item) => {
    const next = [...threadRef.current, item].slice(-40);
    threadRef.current = next;
    saveThread(next);
    setThread(next);
    return next;
  };

  const patch = (target, change) => {
    const next = threadRef.current.map((item) => (item === target ? { ...item, ...change } : item));
    threadRef.current = next;
    saveThread(next);
    setThread(next);
  };

  useLayoutEffect(() => {
    const log = logRef.current;
    log.scrollTop = log.scrollHeight;
  }, [thread, busy, open]);

  // On a phone the focus would open the keyboard over the answer that has just arrived.
  useEffect(() => {
    if (open && !busy && !window.matchMedia("(pointer: coarse)").matches) fieldRef.current.focus();
  }, [open, busy]);

  // Another tab wrote the conversation: take it over, or the next message here would erase that tab's messages.
  // While an answer is on its way the thread stays as is, because the reply is matched to the message by identity.
  useEffect(() => {
    const onStorage = (event) => {
      if ((event.key !== null && event.key !== CHAT_KEY) || busyRef.current) return;
      threadRef.current = loadThread();
      setThread(threadRef.current);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    const onWheel = (event) => {
      event.preventDefault();
      const field = fieldRef.current;
      const box = event.target.closest("textarea") && field.scrollHeight > field.clientHeight ? field : logRef.current;
      const step = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1;
      box.scrollTop += event.deltaY * step;
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!attachMenu) return undefined;
    attachMenuRef.current.querySelector("button").focus();
    const onPointer = (event) => {
      if (!attachMenuRef.current.contains(event.target) && !attachRef.current.contains(event.target)) setAttachMenu(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [attachMenu]);

  useEffect(() => {
    if (busy || !open) setAttachMenu(false);
  }, [busy, open]);

  useEffect(() => {
    const onResize = () => {
      const savedWidth = Number(storageGet(CHAT_WIDTH));
      const savedHeight = Number(storageGet(CHAT_HEIGHT));
      if (savedWidth) setWidthState(clampWidth(savedWidth));
      if (savedHeight) setHeightState(clampHeight(savedHeight));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setBadge(false);
      storageSet(CHAT_SEEN, "1");
    }
  };

  const addFiles = async (list) => {
    const picked = [...(list || [])];
    if (!picked.length || busy) return;
    const { pending, reading } = filesRef.current;
    const room = CHAT_MAX_FILES - pending.length - reading;
    const big = picked.filter((file) => file.size > CHAT_MAX_SIZE);
    const fit = picked.filter((file) => file.size <= CHAT_MAX_SIZE);
    const take = fit.slice(0, Math.max(0, room));
    if (big.length) setAttachNote(`Слишком большой файл (больше ${fileSize(CHAT_MAX_SIZE)}): ${big.map((file) => file.name).join(", ")}.`);
    else if (fit.length > take.length) setAttachNote(`Можно прикрепить не больше ${CHAT_MAX_FILES} файлов за раз.`);
    else setAttachNote("");
    updateFiles((state) => ({ ...state, reading: state.reading + take.length }));
    for (const file of take) {
      let item;
      try {
        item = await readAttachment(file);
      } catch {
        item = { name: file.name || "файл", size: file.size, type: file.type || "", src: "", file };
      }
      updateFiles((state) => ({ pending: [...state.pending, item], reading: state.reading - 1 }));
    }
  };

  const pickFrom = (input) => {
    setAttachMenu(false);
    input.current.click();
  };

  const onPicked = (event) => {
    addFiles(event.target.files);
    event.target.value = "";
    fieldRef.current.focus();
  };

  const closeAttachMenu = () => {
    setAttachMenu(false);
    attachRef.current.focus();
  };

  // Escape closes only the menu: the chat's own Escape listener sits on document and never sees the stopped event.
  const attachMenuKeys = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeAttachMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...attachMenuRef.current.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length].focus();
  };

  const removeFile = (index) => {
    updateFiles((state) => ({ ...state, pending: state.pending.filter((_, i) => i !== index) }));
    setAttachNote("");
  };

  const sendChat = (raw) => {
    const message = String(raw || "").trim();
    if (busy || filesRef.current.reading) return;
    const attached = filesRef.current.pending;
    if (!message && !attached.length) return;
    updateFiles((state) => ({ ...state, pending: [] }));
    setAttachNote("");
    const userItem = { role: "user", text: message, products: [], files: attached, upload: attached.length ? "sending" : "" };
    const next = remember(userItem);
    setText("");
    fieldRef.current.style.height = "";
    busyRef.current = true;
    setBusy(true);
    const history = rulesHistory(next);
    let upload = "";
    // Upload first: the consultant reads the files on the server by the ids the upload returns.
    (attached.length ? uploadChatFiles(attached, message) : Promise.resolve(null))
      .then((ids) => {
        if (attached.length) {
          upload = ids ? (ids.every(Boolean) ? "saved" : "failed") : "";
          patch(userItem, ids ? { files: attached.map((file, index) => (ids[index] ? { ...file, id: ids[index] } : file)), upload } : { upload });
        }
        return askAi(chatRequest(threadRef.current));
      })
      .catch(() => null)
      .then((aiAnswer) => {
        let answer = aiAnswer;
        if (!answer && attached.length && !message) {
          answer = {
            text: upload === "saved"
              ? "Файл получила и передаю Жулдыз — она посмотрит его лично. Если хотите, чтобы я помогла с подбором прямо сейчас, напишите в двух словах, что на нём."
              : "Файл не дошёл до сайта — отправьте его Жулдыз в WhatsApp по кнопке ниже, она посмотрит лично. А если хотите, чтобы я помогла с подбором прямо сейчас, напишите в двух словах, что на нём.",
            products: [],
            suggestions: [],
            handoff: consultantHandoff(history, "general")
          };
        }
        if (!answer) {
          try {
            answer = askConsultant(history);
          } catch {
            answer = null;
          }
        }
        if (!answer || typeof answer.text !== "string") {
          answer = {
            text: "Что-то пошло не так с ответом. Давайте я передам ваш вопрос Жулдыз — она ответит лично.",
            products: [],
            suggestions: [],
            handoff: consultantHandoff(history, "stuck")
          };
        }
        const item = { role: "bot", text: answer.text, products: answer.products || [], files: [] };
        const handoff = cleanHandoff(answer.handoff);
        if (handoff) item.handoff = handoff;
        remember(item);
        setChips(answer.suggestions || []);
      })
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const startResize = (axis) => (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const box = panelRef.current.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    setResizing(axis);
    const move = (e) => {
      if (axis.includes("x")) setWidth(box.width + (startX - e.clientX), false);
      if (axis.includes("y")) setHeight(box.height + (startY - e.clientY), false);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      setResizing("");
      const size = panelRef.current.getBoundingClientRect();
      if (axis.includes("x")) setWidth(size.width);
      if (axis.includes("y")) setHeight(size.height);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const resetSize = (axis) => () => {
    if (axis.includes("x")) setWidth(0);
    if (axis.includes("y")) setHeight(0);
  };

  const resizeByKey = (event) => {
    const step = event.shiftKey ? 64 : 24;
    const rect = panelRef.current.getBoundingClientRect();
    if (event.key === "ArrowLeft") setWidth(rect.width + step);
    else if (event.key === "ArrowRight") setWidth(rect.width - step);
    else if (event.key === "ArrowUp") setHeight(rect.height + step);
    else if (event.key === "ArrowDown") setHeight(rect.height - step);
    else if (event.key === "Home") {
      setWidth(0);
      setHeight(0);
    } else return;
    event.preventDefault();
  };

  const stepHeight = (direction) => setHeight(panelRef.current.getBoundingClientRect().height + direction * 80);

  const userFiles = thread.filter((item) => item.role === "user" && item.files && item.files.length);
  const withFiles = !userFiles.length ? "" : userFiles.every((item) => item.upload === "saved") ? "saved" : "manual";
  const showAttachments = files.pending.length > 0 || files.reading > 0 || Boolean(attachNote);
  const chatClass = ["chat", open && "is-open", resizing && "is-resizing"].filter(Boolean).join(" ");
  const panelStyle = {
    "--chat-width": width ? `${width}px` : undefined,
    "--chat-height": height ? `${height}px` : undefined
  };

  return (
    <div className={chatClass} data-resizing={resizing || undefined}>
      <section
        ref={panelRef}
        className={dragover ? "chat-panel is-dragover" : "chat-panel"}
        id="chat-panel"
        role="dialog"
        aria-label="Чат с консультантом Жулдыз"
        hidden={!open}
        style={panelStyle}
        onDragOver={(event) => {
          if (!event.dataTransfer || ![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          setDragover(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDragover(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer || !event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragover(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div
          className="chat-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Размер чата: стрелки влево и вправо меняют ширину, вверх и вниз — высоту"
          aria-valuenow={width || undefined}
          tabIndex={0}
          title="Тяните влево-вправо — ширина, вверх-вниз — высота. Двойной клик — исходный размер"
          onPointerDown={startResize("xy")}
          onDoubleClick={resetSize("xy")}
          onKeyDown={resizeByKey}
        ></div>
        <div
          className="chat-resize-top"
          aria-hidden="true"
          title="Потяните, чтобы изменить высоту"
          onPointerDown={startResize("y")}
          onDoubleClick={resetSize("y")}
        ></div>
        <div
          className="chat-resize-corner"
          aria-hidden="true"
          title="Потяните, чтобы изменить размер"
          onPointerDown={startResize("xy")}
          onDoubleClick={resetSize("xy")}
        ></div>
        <div className="chat-head">
          <span className="chat-avatar" aria-hidden="true">✦</span>
          <div>
            <p className="chat-name">Жулдыз</p>
            <p className="chat-status">ИИ-консультант по сну</p>
          </div>
          <div className="chat-size" role="group" aria-label="Высота чата">
            <button className="chat-size-btn" type="button" aria-label="Уменьшить высоту чата" title="Уменьшить высоту" onClick={() => stepHeight(-1)}>−</button>
            <span className="chat-size-label" aria-hidden="true">↕ Высота</span>
            <button className="chat-size-btn" type="button" aria-label="Увеличить высоту чата" title="Увеличить высоту" onClick={() => stepHeight(1)}>+</button>
          </div>
          <button className="chat-close" type="button" aria-label="Закрыть чат" onClick={close}>×</button>
        </div>
        <div className="chat-log" role="log" aria-live="polite" ref={logRef}>
          {thread.map((item, index) => <ChatTurn key={index} item={item} withFiles={withFiles} />)}
          {busy && (
            <p className="chat-msg chat-msg-bot chat-typing" aria-label="Консультант печатает"><i></i><i></i><i></i></p>
          )}
        </div>
        <div className="chat-chips" hidden={!chips.length}>
          {chips.map((label) => (
            <button key={label} type="button" onClick={() => sendChat(label)}>{label}</button>
          ))}
        </div>
        <div className="chat-attachments" hidden={!showAttachments}>
          {files.pending.map((file, index) => (
            <span className="chat-attachment" key={index}>
              {file.src ? (
                <>
                  <img src={file.src} alt="" />
                  <span className="chat-attachment-name">{file.name}</span>
                </>
              ) : (
                <FileChip file={file} showStatus />
              )}
              <button className="chat-attachment-remove" type="button" aria-label={`Убрать ${file.name}`} onClick={() => removeFile(index)}>×</button>
            </span>
          ))}
          {files.reading > 0 && <span className="chat-attachments-note">Загружаю файл…</span>}
          {attachNote && <span className="chat-attachments-note">{attachNote}</span>}
        </div>
        <form
          className="chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            sendChat(text);
          }}
        >
          <div className="chat-input">
            <button
              ref={attachRef}
              className="chat-attach"
              type="button"
              aria-label="Прикрепить файл или фото"
              aria-haspopup="menu"
              aria-expanded={attachMenu}
              title="Прикрепить файл или фото"
              disabled={busy || files.pending.length + files.reading >= CHAT_MAX_FILES}
              onClick={() => (attachMenu ? closeAttachMenu() : setAttachMenu(true))}
              onKeyDown={(event) => {
                if (event.key === "Escape" && attachMenu) {
                  event.stopPropagation();
                  setAttachMenu(false);
                }
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
            </button>
            {attachMenu && (
              <div className="chat-attach-menu" role="menu" aria-label="Что прикрепить" ref={attachMenuRef} onKeyDown={attachMenuKeys}>
                <button className="chat-attach-item" type="button" role="menuitem" onClick={() => pickFrom(photoInputRef)}>
                  <span className="chat-attach-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M4 7.5h3l1.6-2.2h6.8L17 7.5h3v11H4z" /><circle cx="12" cy="12.8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>
                  </span>
                  <span>
                    <strong>Фото</strong>
                    <small>Из галереи или с камеры</small>
                  </span>
                </button>
                <button className="chat-attach-item" type="button" role="menuitem" onClick={() => pickFrom(fileInputRef)}>
                  <span className="chat-attach-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M6 3.5h8l4 4v13H6z" /><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" d="M14 3.5v4h4" /></svg>
                  </span>
                  <span>
                    <strong>Файл</strong>
                    <small>Любой формат, до {Math.round(CHAT_MAX_SIZE / 1024 / 1024)} МБ</small>
                  </span>
                </button>
              </div>
            )}
            <input ref={photoInputRef} className="chat-file-input" type="file" accept="image/*" multiple hidden onChange={onPicked} />
            <input ref={fileInputRef} className="chat-file-input" type="file" multiple hidden onChange={onPicked} />
            <label className="chat-field">
              <span className="visually-hidden">Сообщение</span>
              <textarea
                ref={fieldRef}
                name="text"
                rows={1}
                placeholder="Напишите сообщение…"
                disabled={busy}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onInput={(event) => {
                  const field = event.currentTarget;
                  field.style.height = "auto";
                  field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendChat(text);
                  }
                }}
                onPaste={(event) => {
                  const pasted = event.clipboardData && event.clipboardData.files;
                  if (!pasted || !pasted.length) return;
                  event.preventDefault();
                  addFiles(pasted);
                }}
              ></textarea>
            </label>
          </div>
          <button className="chat-send" type="submit" aria-label="Отправить" disabled={busy}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3.4 11.2 20.2 3.6c.8-.4 1.6.4 1.3 1.2l-4.2 15.2c-.3.9-1.4 1.1-2 .4l-4.2-4.6-3.4 2.2c-.8.5-1.8-.2-1.6-1.1l1-4.2-3.7-1.5c-.9-.4-.9-1.6 0-2z" /></svg>
          </button>
        </form>
        <p className="chat-privacy">Отвечает ИИ: сообщения и файлы обрабатывает сервис OpenAI. Не присылайте данные банковских карт.</p>
      </section>
      <button
        ref={launchRef}
        className="chat-launch"
        type="button"
        aria-expanded={open}
        aria-controls="chat-panel"
        aria-label={open ? "Закрыть чат" : "Открыть чат"}
        onClick={toggle}
      >
        <svg className="chat-icon-open" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M5 4.5h14a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H11l-4.2 3.1c-.7.5-1.8 0-1.8-.9V16.7A2 2 0 0 1 3 14.7V6.5a2 2 0 0 1 2-2z" /></svg>
        <svg className="chat-icon-close" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
        {badge && <span className="chat-badge">1</span>}
      </button>
    </div>
  );
}
