"use client";

type Props = {
  formId: string;
  active: boolean;
};

export default function StatusToggleSubmit({ formId, active }: Props) {
  return (
    <button
      type="button"
      className={
        active
          ? "rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 hover:bg-emerald-200"
          : "rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-300"
      }
      onClick={() => {
        const approved = window.confirm(`Save status change to ${active ? "Inactive" : "Active"}?`);
        if (!approved) return;
        const form = document.getElementById(formId) as HTMLFormElement | null;
        form?.requestSubmit();
      }}
    >
      {active ? "Active" : "Inactive"}
    </button>
  );
}
