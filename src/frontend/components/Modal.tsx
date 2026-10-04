import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Modal({ title, children, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <header className="modal-header">
          <h2>{title}</h2>
          {onClose ? (
            <button type="button" onClick={onClose}>
              Close
            </button>
          ) : null}
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
