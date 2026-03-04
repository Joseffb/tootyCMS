"use client";

type Props = {
  formId: string;
  name: string;
  defaultChecked?: boolean;
  label: string;
  className?: string;
  confirmText?: string;
};

export default function InlineCheckboxAutoSave({
  formId,
  name,
  defaultChecked = false,
  label,
  className,
  confirmText = "Save this change?",
}: Props) {
  return (
    <label className={className || "inline-flex items-center gap-1 text-xs text-stone-700"}>
      <input
        form={formId}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-3.5 w-3.5 rounded border-stone-300"
        onChange={(event) => {
          const approved = window.confirm(confirmText);
          if (!approved) {
            event.currentTarget.checked = !event.currentTarget.checked;
            return;
          }
          const form = document.getElementById(formId) as HTMLFormElement | null;
          form?.requestSubmit();
        }}
      />
      {label}
    </label>
  );
}
