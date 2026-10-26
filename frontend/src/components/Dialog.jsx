import { useEffect, useLayoutEffect, useRef } from "react";

export default function Dialog({ id, open, onClose, className, labelledBy, children }) {
  const ref = useRef(null);
  const openRef = useRef(open);
  openRef.current = open;

  useLayoutEffect(() => {
    const dialog = ref.current;
    // The browser returns focus to the opener only if the dialog is closed while still in the document.
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      id={id}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        // A file input inside the dialog fires a bubbling cancel when its picker is dismissed.
        if (event.target === event.currentTarget && openRef.current) onClose();
      }}
      onClose={() => {
        // The close event arrives asynchronously and may be stale: the dialog can already be reopened by then.
        if (openRef.current && !ref.current.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
