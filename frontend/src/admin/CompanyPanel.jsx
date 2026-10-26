import { useState } from "react";
import { COMPANY_LABELS, COMPANY_SAMPLE, companyDetails, DEFAULT_VAT_RATE } from "../pdf/company.js";

const FIELDS = [
  ["company_name", "Наименование (ИП или ТОО)", "ИП «Жулдыз»"],
  ["bin_iin", "БИН / ИИН — 12 цифр", "900101400123"],
  ["iik", "ИИК (расчётный счёт) — 20 знаков, начинается с KZ", "KZ12722S000012345678"],
  ["bank_name", "Банк", "АО «Kaspi Bank»"],
  ["bik", "БИК банка — 8 латинских букв или цифр", "CASPKZKA"],
  ["kbe", "Кбе — 2 цифры (ИП обычно 19, ТОО 17)", "19"],
  ["company_address", "Юридический / фактический адрес", COMPANY_SAMPLE.company_address],
  ["company_phone", "Телефон для счёта (если пусто — номер WhatsApp)", "+7 777 849 21 64"]
];

// The same rules the server checks; codes are compared without spaces and in capitals.
const CODES = {
  bin_iin: [/^\d{12}$/, "БИН / ИИН — ровно 12 цифр"],
  iik: [/^KZ[0-9A-Z]{18}$/, "ИИК — 20 знаков: KZ и ещё 18 цифр или латинских букв"],
  bik: [/^[0-9A-Z]{8}$/, "БИК — 8 латинских букв или цифр"],
  kbe: [/^\d{2}$/, "Кбе — 2 цифры"]
};

// The server cuts longer texts; codes may be typed with spaces, which are dropped.
const MAX_LENGTH = { company_name: 120, bank_name: 120, company_address: 200, company_phone: 40 };
const CODE_MAX_LENGTH = 30;

const code = (value) => String(value ?? "").replace(/\s/g, "").toUpperCase();

function initialForm(saved) {
  const given = saved && typeof saved === "object" ? saved : {};
  const form = Object.fromEntries(FIELDS.map(([field]) => [field, String(given[field] ?? "")]));
  form.is_vat_payer = given.is_vat_payer === true;
  form.vat_rate = String(given.vat_rate ?? DEFAULT_VAT_RATE);
  return form;
}

export default function CompanyPanel({ company, onSave }) {
  const [form, setForm] = useState(() => initialForm(company));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { missing } = companyDetails(company);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    for (const [field, [pattern, message]] of Object.entries(CODES)) {
      const value = code(form[field]);
      if (value && !pattern.test(value)) {
        setError(message);
        return;
      }
    }
    const rate = Number(String(form.vat_rate).replace(",", "."));
    if (form.is_vat_payer && !(rate > 0 && rate <= 30)) {
      setError("Ставка НДС — число больше 0 и не больше 30, например 12");
      return;
    }
    setError("");
    const next = { ...form, vat_rate: form.is_vat_payer ? rate : Number(company?.vat_rate) || DEFAULT_VAT_RATE };
    for (const field of Object.keys(CODES)) next[field] = code(form[field]);
    setSaving(true);
    await onSave(next);
    setSaving(false);
  };

  return (
    <section className="panel settings-panel">
      <h2>Реквизиты для счёта</h2>
      <p className="backup-note">
        {missing.length
          ? `Пока не заполнено: ${missing.map((field) => COMPANY_LABELS[field]).join(", ")}. До этого счёт скачивается как образец, а покупателям на сайте кнопка счёта не показывается.`
          : "Реквизиты заполнены: счёт можно скачать в карточке заказа, а покупатель видит кнопку счёта после отправки заказа."}
      </p>
      <form onSubmit={submit} noValidate>
        {FIELDS.map(([field, label, placeholder]) => (
          <label key={field}>
            {label}
            <input
              name={field}
              placeholder={placeholder}
              maxLength={MAX_LENGTH[field] || CODE_MAX_LENGTH}
              value={form[field]}
              onChange={(event) => set(field, event.target.value)}
            />
          </label>
        ))}
        <label className="check">
          <input type="checkbox" checked={form.is_vat_payer} onChange={(event) => set("is_vat_payer", event.target.checked)} />
          Плательщик НДС (без галочки в счёте будет «Без НДС»)
        </label>
        {form.is_vat_payer && (
          <label>
            Ставка НДС, %
            <input name="vat_rate" inputMode="decimal" value={form.vat_rate} onChange={(event) => set("vat_rate", event.target.value)} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-ghost" type="submit" disabled={saving}>Сохранить реквизиты</button>
      </form>
    </section>
  );
}
