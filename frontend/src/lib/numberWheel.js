export function preventNumberWheel() {
  document.addEventListener("wheel", (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement) || field.type !== "number" || document.activeElement !== field) return;
    event.preventDefault();
    field.blur();
  }, { passive: false });
}
