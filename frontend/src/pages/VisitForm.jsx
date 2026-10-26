import { useRef, useState } from "react";
import { openWhatsApp, whatsapp } from "../lib/catalog.js";

export default function VisitForm() {
  const formRef = useRef(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    const { name, phone, need, note } = formRef.current.elements;
    const clientName = name.value.trim().replace(/\s+/g, " ");
    const digits = phone.value.replace(/\D/g, "");
    setSent(false);
    const fail = (message, input) => {
      setError(message);
      input.focus();
    };
    if (clientName.length < 2) return fail("Напишите, как к вам обращаться.", name);
    if (digits.length < 10 || digits.length > 15) return fail("Проверьте номер телефона — нужно 10–15 цифр.", phone);
    setError("");

    const lines = [
      "Здравствуйте, Жулдыз! Заявка с сайта.",
      `Имя: ${clientName}`,
      `Телефон: ${phone.value.trim()}`,
      `Что подобрать: ${need.value}`,
    ];
    if (note.value.trim()) lines.push(`О сне: ${note.value.trim()}`);
    openWhatsApp(`https://wa.me/${whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`);
    setSent(true);
    formRef.current.reset();
  };

  return (
    <form className="form" id="form" noValidate ref={formRef} onSubmit={submit}>
      <label>
        Имя
        <input type="text" name="name" autoComplete="name" required />
      </label>
      <label>
        Телефон
        <input type="tel" name="phone" autoComplete="tel" placeholder="+7" required />
      </label>
      <label>
        Что нужно подобрать
        <select name="need">
          <option>Матрас</option>
          <option>Кровать</option>
          <option>Аксессуары</option>
          <option>Пока не знаю — разберёмся</option>
        </select>
      </label>
      <label>
        Пара слов о сне
        <textarea name="note" rows={3} placeholder="Сплю на боку, вес около…, старый матрас просел…"></textarea>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn btn-solid" type="submit">Отправить заявку в WhatsApp</button>
      {sent && <p className="form-ok">Спасибо! Открылся WhatsApp с вашей заявкой — останется нажать «Отправить».</p>}
    </form>
  );
}
