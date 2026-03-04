"use client";

import { useEffect, useRef } from "react";

type Props = {
  formId: string;
  name: string;
  defaultValue?: string;
  multiline?: boolean;
  className?: string;
  confirmText?: string;
};

export default function InlineEditableField({
  formId,
  name,
  defaultValue = "",
  multiline = false,
  className,
  confirmText = "Save this change?",
}: Props) {
  const editableRef = useRef<HTMLDivElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const savedValueRef = useRef(defaultValue);

  useEffect(() => {
    savedValueRef.current = defaultValue;
    if (editableRef.current) {
      editableRef.current.textContent = defaultValue;
    }
    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = defaultValue;
    }
  }, [defaultValue]);

  return (
    <>
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={name}
        className={className || "text-sm text-stone-900 outline-none"}
        onInput={(event) => {
          const next = event.currentTarget.textContent || "";
          if (hiddenInputRef.current) {
            hiddenInputRef.current.value = next;
          }
        }}
        onKeyDown={(event) => {
          if (!multiline && event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const next = (event.currentTarget.textContent || "").trim();
          const prev = savedValueRef.current.trim();
          if (next === prev) return;

          const approved = window.confirm(confirmText);
          if (!approved) {
            event.currentTarget.textContent = savedValueRef.current;
            if (hiddenInputRef.current) {
              hiddenInputRef.current.value = savedValueRef.current;
            }
            return;
          }

          savedValueRef.current = next;
          if (hiddenInputRef.current) {
            hiddenInputRef.current.value = next;
          }
          const form = document.getElementById(formId) as HTMLFormElement | null;
          form?.requestSubmit();
        }}
      />
      <input ref={hiddenInputRef} type="hidden" form={formId} name={name} defaultValue={defaultValue} />
    </>
  );
}
