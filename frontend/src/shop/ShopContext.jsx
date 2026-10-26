import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import { settings } from "../lib/catalog.js";
import { addLine, BAG_KEY, checkBag, droppedNote, fullBagNote, loadBag, retryPendingOrders, saveBag } from "../lib/order.js";
import { companyDetails } from "../pdf/company.js";
import BagDialog from "./BagDialog.jsx";
import CheckoutDialog from "./CheckoutDialog.jsx";
import OrderDialog from "./OrderDialog.jsx";
import SentDialog from "./SentDialog.jsx";

const ShopContext = createContext(null);
// Until the admin fills in the shop's details an invoice would be a sample, so buyers are not offered one.
const INVOICE_OFFERED = !companyDetails(settings.company).sample;
// An order the server did not confirm is sent again while the page stays open, not only on the next visit.
const PENDING_RETRY_MS = 60 * 1000;

export const useShop = () => useContext(ShopContext);

// Lines the admin removed meanwhile leave the saved bag at once, so the note about them is shown only once.
function openingBag() {
  const { bag, dropped } = checkBag();
  if (!dropped.length) return { bag, note: "" };
  saveBag(bag);
  return { bag, note: droppedNote(dropped) };
}

export function ShopProvider({ children }) {
  const [opening] = useState(openingBag);
  const [bag, setBagState] = useState(opening.bag);
  // Shown at the top of the bag until the buyer leaves it.
  const [note, setNote] = useState(opening.note);
  const [dialog, setDialog] = useState(null);
  const [order, setOrder] = useState(null);

  useEffect(() => {
    retryPendingOrders();
    const timer = setInterval(retryPendingOrders, PENDING_RETRY_MS);
    window.addEventListener("online", retryPendingOrders);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retryPendingOrders);
    };
  }, []);

  // Another tab changed the bag: without this, the next change here would write back the old bag over it.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === null || event.key === BAG_KEY) setBagState(loadBag());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setBag = useCallback((next) => {
    saveBag(next);
    setBagState(next);
  }, []);

  const addToBag = useCallback((line) => {
    const next = addLine(loadBag(), line);
    if (next) setBag(next);
    else setNote(fullBagNote);
  }, [setBag]);

  const openOrder = useCallback((product, size = "", qty = 1) => {
    setOrder({ product, size, qty, key: Date.now() });
    setDialog("order");
  }, []);

  const openBag = useCallback(() => setDialog("bag"), []);
  const close = useCallback(() => setDialog(null), []);
  const closeBag = useCallback(() => {
    setNote("");
    setDialog(null);
  }, []);
  const checkout = useCallback(() => {
    setNote("");
    setDialog("checkout");
  }, []);
  // The bag changed under the checkout (another tab, a product removed): the buyer sees it before anything is sent.
  const backToBag = useCallback((text = "") => {
    setNote(text);
    setDialog("bag");
  }, []);

  // saved: the promise sendOrder returned. Shown over the page the buyer comes back to from WhatsApp.
  const [sent, setSent] = useState(null);
  const showSent = useCallback((saved) => {
    if (!INVOICE_OFFERED) return;
    setSent({ saved, key: Date.now() });
    setDialog("sent");
  }, []);

  const value = useMemo(() => ({ bag, setBag, addToBag, openOrder, openBag, note }), [bag, setBag, addToBag, openOrder, openBag, note]);

  return (
    <ShopContext.Provider value={value}>
      {children}
      <ErrorBoundary resetKey={order?.key}>
        <OrderDialog open={dialog === "order"} order={order} onClose={close} onAdded={openBag} onSent={showSent} />
      </ErrorBoundary>
      <ErrorBoundary>
        <BagDialog open={dialog === "bag"} onClose={closeBag} onCheckout={checkout} />
      </ErrorBoundary>
      <ErrorBoundary>
        <CheckoutDialog open={dialog === "checkout"} onClose={close} onBag={backToBag} onSent={showSent} />
      </ErrorBoundary>
      <ErrorBoundary resetKey={sent?.key}>
        <SentDialog open={dialog === "sent"} sent={sent} onClose={close} />
      </ErrorBoundary>
    </ShopContext.Provider>
  );
}
