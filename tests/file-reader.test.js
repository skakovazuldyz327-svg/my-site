import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { canBeRead, fileKind } from "../shared/files.js";
import { cleanTurns } from "../server/ai/conversation.js";
import { createFileReader } from "../server/ai/files/index.js";
import { officeText } from "../server/ai/files/office.js";
import { plainText } from "../server/ai/files/text.js";
import { createAi } from "../server/ai/index.js";
import { createApp } from "../server/app.js";
import { silentLogger } from "../server/log.js";
import { createStore } from "../server/store/index.js";
import { createZip } from "../server/store/zip.js";
import { fakeProvider, replyCall, tempSite } from "./helpers.js";

const site = tempSite();
const store = createStore(site.config);
const reader = createFileReader({ store });
const SESSION = "visitor0001";

const zip = (parts) => createZip(Object.entries(parts).map(([name, text]) => ({ name, data: Buffer.from(text) })));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 2)]);
const save = (name, type, bytes, session = SESSION) => store.chatFiles.add({ name, type, session, text: "", bytes });
const ask = async (files, session = SESSION, extra = []) => {
  const turns = cleanTurns({ messages: [...extra, { role: "user", text: "посмотрите", files }] });
  await reader.attach(turns, session);
  return turns.at(-1).files;
};
const ref = (entry) => ({ id: entry.id, name: entry.name, size: entry.size, type: entry.type });

test("the server and the chat hint agree on which files the consultant reads", () => {
  assert.equal(fileKind({ name: "кровать.HEIC", type: "image/heic" }), "");
  assert.equal(fileKind({ name: "a.png", type: "" }), "image");
  assert.equal(fileKind({ name: "смета.xlsx" }), "office");
  assert.equal(fileKind({ name: "data", type: "application/ld+json" }), "text");
  assert.equal(fileKind({ name: "шаблон.dotx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.template" }), "");
  assert.equal(fileKind({ name: "чертёж.dwg", type: "application/acad" }), "");
  assert.equal(canBeRead({ name: "a.pdf", size: 10 * 1024 * 1024 }), true);
  assert.equal(canBeRead({ name: "a.pdf", size: 10 * 1024 * 1024 + 1 }), false);
});

test("Word, Excel, PowerPoint and OpenDocument files give their text", () => {
  const docx = zip({
    "word/document.xml": '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">Размер </w:t></w:r><w:r><w:t>160&amp;200</w:t></w:r></w:p><w:p><w:r><w:t>Жёсткость</w:t><w:tab/><w:t>средняя</w:t></w:r></w:p></w:body></w:document>',
    "word/media/photo.png": "x".repeat(1000)
  });
  assert.equal(officeText("заказ.docx", docx), "Размер 160&200\nЖёсткость\tсредняя\n");

  const xlsx = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Размеры" sheetId="1"/></sheets></workbook>',
    "xl/sharedStrings.xml": "<sst><si><t>Ширина</t></si><si><r><t>Дли</t></r><r><t>на</t></r></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>160</v></c><c r="B2" t="inlineStr"><is><t>200 см</t></is></c><c r="C2" s="1"/></row></sheetData></worksheet>'
  });
  assert.equal(officeText("размеры.xlsx", xlsx), "Лист «Размеры»:\nШирина\tДлина\n160\t200 см");

  const pptx = zip({
    "ppt/slides/slide10.xml": "<p:sld><a:p><a:r><a:t>Последний</a:t></a:r></a:p></p:sld>",
    "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Первый</a:t></a:r></a:p></p:sld>"
  });
  assert.equal(officeText("план.pptx", pptx), "Слайд 1:\nПервый\n\nСлайд 2:\nПоследний");

  const odt = zip({ "content.xml": "<office:text><text:h>Заявка</text:h><text:p>Кровать<text:s/>180<text:line-break/>Москва</text:p></office:text>" });
  assert.equal(officeText("заявка.odt", odt), "Заявка\nКровать 180\nМосква");

  const ods = zip({ "content.xml": "<table:table><table:table-row><table:table-cell><text:p>Ширина</text:p></table:table-cell><table:table-cell><text:p>160</text:p></table:table-cell></table:table-row></table:table>" });
  assert.equal(officeText("размеры.ods", ods), "Ширина\t160");
});

test("an archive that unpacks into gigabytes is refused instead of filling the memory", () => {
  const bomb = createZip([{ name: "word/document.xml", data: Buffer.alloc(31 * 1024 * 1024, 0x20) }]);
  assert.ok(bomb.length < 200 * 1024);
  assert.throws(() => officeText("бомба.docx", bomb));
});

test("old Windows text, UTF-16, RTF and HTML become readable text", () => {
  const cp1251 = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
  assert.equal(plainText("заметка.txt", cp1251), "Привет");
  assert.equal(plainText("заметка.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Матрас", "utf16le")])), "Матрас");
  assert.equal(plainText("заметка.txt", Buffer.from("\uFEFFутф")), "утф");

  const rtf = String.raw`{\rtf1\ansi\ansicpg1251{\fonttbl{\f0 Arial;}}{\*\generator Word;}\pard \'cc\'e0\'f2\'f0\'e0\'f1\par \u1050\'ca\u1088\'f0\u1086\'ee\u1074\'e2\u1072\'e0\u1090\'f2\u1100\'fc ?\par}`;
  assert.equal(plainText("письмо.rtf", Buffer.from(rtf)).trim(), "Матрас\nКровать ?");

  const html = "<html><head><title>x</title><style>p{}</style></head><body><p>Размер&nbsp;160</p><script>alert(1)</script><table><tr><td>A</td><td>B</td></tr></table></body></html>";
  assert.equal(plainText("стр.html", Buffer.from(html)).trim(), "Размер 160\nA\tB");
});

test("a file is read only for the chat that uploaded it", async () => {
  const entry = await save("размеры.txt", "text/plain", Buffer.from("кровать 160 на 200"));
  const [own] = await ask([ref(entry)]);
  assert.equal(own.status, "read");
  assert.equal(own.excerpt, "кровать 160 на 200");

  const [other] = await ask([ref(entry)], "stranger001");
  assert.equal(other.status, "missing");
  assert.equal(other.excerpt, undefined);

  const [noSession] = await ask([ref(entry)], "../../etc");
  assert.equal(noSession.status, "missing");

  const [guessed] = await ask([{ ...ref(entry), id: "0123456789ab" }]);
  assert.equal(guessed.status, "missing");
});

test("the browser's claimed type is ignored: photos and PDFs are checked by their bytes", async () => {
  const png = await save("фото.jpg", "image/jpeg", PNG);
  const fake = await save("вирус.png", "image/png", Buffer.from("MZ executable"));
  const pdf = await save("чек.pdf", "application/pdf", Buffer.from("%PDF-1.4 test"));
  const notPdf = await save("не-чек.pdf", "application/pdf", Buffer.from("hello"));
  const dwg = await save("чертёж.dwg", "application/acad", Buffer.from("AC1032"));
  const [photo, virus, receipt, broken, drawing] = await ask([png, fake, pdf, notPdf, dwg].map(ref));
  assert.match(photo.data, /^data:image\/png;base64,/);
  assert.equal(virus.status, "unreadable");
  assert.equal(virus.data, undefined);
  assert.match(receipt.data, /^data:application\/pdf;base64,/);
  assert.equal(broken.status, "unreadable");
  assert.equal(drawing.status, "unreadable");
});

test("photos travel only for the latest messages and within the budget", async () => {
  const photos = await Promise.all([1, 2, 3, 4].map((n) => save(`фото${n}.jpg`, "image/jpeg", JPEG)));
  const old = await save("старое.jpg", "image/jpeg", JPEG);
  const turns = cleanTurns({
    messages: [
      { role: "user", text: "старое фото", files: [ref(old)] },
      { role: "bot", text: "вижу" },
      { role: "user", text: "ещё", files: [] },
      { role: "bot", text: "ок" },
      { role: "user", text: "вот четыре", files: photos.map(ref) }
    ]
  });
  await reader.attach(turns, SESSION);
  const latest = turns.at(-1).files;
  assert.deepEqual(latest.map((file) => file.status), ["read", "read", "read", "limit"]);
  assert.equal(turns[0].files[0].status, "earlier");
});

test("documents share one text budget, newest first", async () => {
  const big = await save("большой.txt", "text/plain", Buffer.from("я".repeat(20000)));
  const files = await Promise.all([1, 2, 3, 4].map((n) => save(`док${n}.txt`, "text/plain", Buffer.from(`${n}`.repeat(9000)))));
  const result = await ask(files.map(ref), SESSION, [{ role: "user", text: "раньше", files: [ref(big)] }]);
  assert.deepEqual(result.map((file) => file.excerpt?.length || 0), [8000, 8000, 8000, 0]);
  assert.ok(result.slice(0, 3).every((file) => file.truncated));
  assert.equal(result[3].status, "limit");
});

test("photos and PDFs together stay under the request size the AI service accepts", async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]);
  const photos = await Promise.all([1, 2, 3].map((n) => save(`большое${n}.jpg`, "image/jpeg", big)));
  const result = await ask(photos.map(ref));
  assert.deepEqual(result.map((file) => file.status), ["read", "read", "limit"]);
});

test("real Word, Excel and PowerPoint quirks: text boxes once, line breaks, dates", () => {
  const box = "<w:p><w:r><mc:AlternateContent><mc:Choice Requires=\"wps\"><w:txbxContent><w:p><w:r><w:t>Рамка</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Рамка</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>";
  const breaks = '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>А</w:t><w:cr/><w:t>Б</w:t><w:br w:type="page"/><w:t>В</w:t><w:noBreakHyphen/><w:t>Г</w:t></w:r></w:p>';
  assert.equal(officeText("a.docx", zip({ "word/document.xml": `<w:body>${box}${breaks}</w:body>` })).trim(), "Рамка\n\nА\nБ\nВ-Г");

  const slide = '<p:sld><a:p><a:r><a:t>Заголовок</a:t></a:r><a:br><a:rPr lang="ru-RU"/></a:br><a:r><a:t>строка 2</a:t></a:r></a:p></p:sld>';
  assert.equal(officeText("a.pptx", zip({ "ppt/slides/slide1.xml": slide })), "Слайд 1:\nЗаголовок\nстрока 2");

  const xlsx = zip({
    "xl/workbook.xml": '<sheets><sheet name="Доставка" sheetId="1"/></sheets>',
    "xl/styles.xml": '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/><numFmt numFmtId="165" formatCode="#,##0 &quot;м&quot;"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": '<sheetData><row r="1"><c r="A1" s="1"><v>45580</v></c><c r="B1" s="2"><v>45580.5</v></c><c r="C1" s="3"><v>160</v></c><c r="D1"><f>2+2</f><v>4</v></c><c r="E1" t="b"><v>1</v></c></row></sheetData>'
  });
  assert.equal(officeText("a.xlsx", xlsx), "Лист «Доставка»:\n15.10.2024\t15.10.2024 12:00\t160\t4\tИСТИНА");

  const odt = zip({ "content.xml": "<office:text><text:p/><text:h>Заголовок</text:h><text:p text:style-name=\"P1\"/><text:p>Абзац</text:p></office:text>" });
  assert.equal(officeText("a.odt", odt), "Заголовок\nАбзац");
});

test("an old .doc or a broken file renamed to .docx is reported as unreadable, not as empty", async () => {
  assert.throws(() => officeText("a.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...Buffer.alloc(600)])), /not an office document/);
  assert.throws(() => officeText("a.xlsx", Buffer.from("not a zip")), /not an office document/);
  const legacy = await save("старый.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("not a zip"));
  const program = await save("readme.txt", "text/plain", Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]));
  const [doc, exe] = await ask([ref(legacy), ref(program)]);
  assert.equal(doc.status, "unreadable");
  assert.equal(exe.status, "unreadable");
});

test("RTF keeps escaped characters and ignores Word's line wrapping; SVG gives its text", () => {
  const rtf = "{\\rtf1\\ansi\\ansicpg1251 \\{x\\} и \\\\par слэш\\par\r\nВторая стро\r\nка\\~конец\\par}";
  assert.equal(plainText("a.rtf", Buffer.from(rtf)).trim(), "{x} и \\par слэш\nВторая строка конец");
  assert.equal(plainText("план.svg", Buffer.from("<svg><style>t{}</style><text>Ширина</text><text>160</text></svg>")).trim(), "Ширина 160");
});

test("a file crafted to keep the reader busy for minutes is given up on while the site keeps answering", async () => {
  const slow = await save("ловушка.html", "text/html", Buffer.from("<script".repeat(250000)));
  const quick = createFileReader({ store, timeoutMs: 500 });
  const turns = () => cleanTurns({ messages: [{ role: "user", text: "посмотрите", files: [ref(slow)] }] });
  let longestPause = 0;
  let last = Date.now();
  const ticker = setInterval(() => {
    longestPause = Math.max(longestPause, Date.now() - last);
    last = Date.now();
  }, 20);
  const started = Date.now();
  try {
    const first = turns();
    await quick.attach(first, SESSION);
    assert.equal(first[0].files[0].status, "unreadable");
    assert.ok(Date.now() - started < 5000);
    assert.ok(longestPause < 400, `the server stood still for ${longestPause} ms`);

    const again = Date.now();
    const second = turns();
    await quick.attach(second, SESSION);
    assert.equal(second[0].files[0].status, "unreadable");
    assert.ok(Date.now() - again < 100, "a file that timed out is not read again");
  } finally {
    clearInterval(ticker);
  }
});

test("too big and empty files are described, not sent", async () => {
  const empty = await save("пусто.txt", "text/plain", Buffer.from("  \n "));
  const big = { id: "aaaaaaaaaaaa", name: "огромный.pdf", size: 20 * 1024 * 1024, type: "application/pdf" };
  const [blank] = await ask([ref(empty)]);
  assert.equal(blank.status, "empty");
  const { insertChatFile } = await import("../server/store/chatFiles.js");
  insertChatFile(store.db, { ...big, session: SESSION, text: "", time: Date.now() });
  const [huge] = await ask([big]);
  assert.equal(huge.status, "too-big");
  assert.equal(huge.data, undefined);
});

describeUploadAndChat();

function describeUploadAndChat() {
  const provider = fakeProvider("fake", [replyCall({ text: "Вижу размеры 160 на 200.", handoff: "none" })]);
  const ai = createAi({ config: site.config, store, logger: silentLogger, providers: [provider] });
  const server = createApp({ config: site.config, store, logger: silentLogger, ai });
  let base = "";

  before(() => new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  })));
  after(() => {
    server.close();
    store.close();
    site.cleanup();
  });

  const upload = async (name, type, body) => {
    const response = await fetch(`${base}/api/chat/files`, {
      method: "POST",
      headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(name), "X-Chat-Session": "chatflow01", "X-Chat-Text": "" },
      body
    });
    assert.equal(response.status, 200);
    return { id: (await response.json()).id, name, size: body.length, type };
  };

  test("an uploaded document and photo reach the model through the chat endpoint", async () => {
    const docx = await upload("размеры.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip({ "word/document.xml": "<w:p><w:t>Кровать 160 на 200</w:t></w:p>" }));
    const photo = await upload("кровать.png", "image/png", PNG);
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: "chatflow01",
        messages: [{ role: "user", text: "", files: [{ ...docx, excerpt: "подделка от браузера" }, { ...photo, images: ["data:image/png;base64,AAAA"] }] }]
      })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "Вижу размеры 160 на 200.");

    const [message] = provider.calls[0].messages;
    assert.match(message.text, /\[Клиент прикрепил файл «размеры\.docx», [^\]]+\]\nСодержимое файла:\nКровать 160 на 200/);
    assert.match(message.text, /\[Клиент прикрепил фото «кровать\.png»[^\]]+\] — приложено к сообщению\./);
    assert.doesNotMatch(message.text, /подделка/);
    assert.deepEqual(message.images, [`data:image/png;base64,${PNG.toString("base64")}`]);
  });
}
