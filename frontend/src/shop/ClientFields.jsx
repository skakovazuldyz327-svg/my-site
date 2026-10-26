import { useRef, useState } from "react";
import { loadClient, validateClient } from "../lib/order.js";

export function useClientForm() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [bin, setBin] = useState("");
  const [address, setAddress] = useState("");
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [error, setError] = useState(null);
  const nameRef = useRef(null);
  const phoneRef = useRef(null);
  const binRef = useRef(null);

  const fill = () => {
    const saved = loadClient();
    setName((value) => value || saved.name || "");
    setPhone((value) => value || saved.phone || "");
    setCompany((value) => value || saved.company || "");
    setBin((value) => value || saved.bin || "");
    setAddress((value) => value || saved.address || "");
    if (saved.company || saved.bin || saved.address) setInvoiceOpen(true);
    setError(null);
  };

  const focusFirst = () => (name ? phoneRef : nameRef).current?.focus();

  const refs = { name: nameRef, phone: phoneRef, bin: binRef };
  const validate = () => {
    const result = validateClient(name, phone, { company, bin, address });
    if (result.error) {
      setError({ message: result.error, field: result.field });
      const input = refs[result.field].current;
      // A closed block hides its fields from focus, so it is opened first; onToggle brings the state along.
      const block = input.closest("details");
      if (block) block.open = true;
      input.focus();
      return null;
    }
    setError(null);
    return result.client;
  };

  return {
    name, setName, phone, setPhone, company, setCompany, bin, setBin, address, setAddress, invoiceOpen, setInvoiceOpen,
    error, nameRef, phoneRef, binRef, fill, focusFirst, validate
  };
}

export default function ClientFields({ form, idPrefix }) {
  return (
    <>
      <label>
        Ваше имя
        <input
          id={`${idPrefix}-name`}
          ref={form.nameRef}
          name="name"
          autoComplete="name"
          maxLength={60}
          required
          value={form.name}
          onChange={(event) => form.setName(event.target.value)}
          aria-invalid={form.error?.field === "name" || undefined}
        />
      </label>
      <label>
        Телефон
        <input
          id={`${idPrefix}-phone`}
          ref={form.phoneRef}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          placeholder="+7 777 123 45 67"
          required
          value={form.phone}
          onChange={(event) => form.setPhone(event.target.value)}
          aria-invalid={form.error?.field === "phone" || undefined}
        />
      </label>
      <details className="order-invoice" open={form.invoiceOpen} onToggle={(event) => form.setInvoiceOpen(event.currentTarget.open)}>
        <summary>Нужен счёт на оплату? Укажите данные (необязательно)</summary>
        <label>
          Организация (ТОО или ИП)
          <input id={`${idPrefix}-company`} name="organization" autoComplete="organization" maxLength={160} value={form.company} onChange={(event) => form.setCompany(event.target.value)} />
        </label>
        <label>
          БИН / ИИН
          <input
            id={`${idPrefix}-bin`}
            ref={form.binRef}
            name="bin"
            inputMode="numeric"
            maxLength={14}
            placeholder="12 цифр"
            value={form.bin}
            onChange={(event) => form.setBin(event.target.value)}
            aria-invalid={form.error?.field === "bin" || undefined}
          />
        </label>
        <label>
          Адрес доставки
          <input id={`${idPrefix}-address`} name="address" autoComplete="street-address" maxLength={200} value={form.address} onChange={(event) => form.setAddress(event.target.value)} />
        </label>
      </details>
      {form.error && <p className="form-error">{form.error.message}</p>}
    </>
  );
}
