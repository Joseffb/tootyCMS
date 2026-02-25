"use client";

import { ReactNode } from "react";

type Props = {
  label: string;
  className?: string;
  disabled?: boolean;
  confirmMessage?: string;
  children?: ReactNode;
};

export default function ConfirmSubmitButton({ label, className, disabled, confirmMessage, children }: Props) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={className}
      onClick={(event) => {
        if (!confirmMessage) return;
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      {children ?? label}
    </button>
  );
}
