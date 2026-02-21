"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SetupEnvField } from "@/lib/setup-env";

type Props = {
  fields: SetupEnvField[];
  initialValues: Record<string, string>;
};

export default function SetupWizard({ fields, initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [adminName, setAdminName] = useState(initialValues.SETUP_ADMIN_NAME ?? "");
  const [adminEmail, setAdminEmail] = useState(initialValues.SETUP_ADMIN_EMAIL ?? "");
  const hasOAuthProvider = useMemo(() => {
    const pairs: Array<[string, string]> = [
      ["AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"],
      ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
      ["AUTH_FACEBOOK_ID", "AUTH_FACEBOOK_SECRET"],
      ["AUTH_APPLE_ID", "AUTH_APPLE_SECRET"],
    ];
    return pairs.some(([idKey, secretKey]) => {
      return Boolean((values[idKey] || "").trim() && (values[secretKey] || "").trim());
    });
  }, [values]);

  const missingRequired = useMemo(
    () => fields.filter((field) => field.required && !(values[field.key] || "").trim()),
    [fields, values],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (missingRequired.length > 0) {
      setError(`Missing required fields: ${missingRequired.map((field) => field.key).join(", ")}`);
      return;
    }
    if (!adminName.trim() || !adminEmail.trim()) {
      setError("Admin Name and Admin Email are required.");
      return;
    }
    if (!hasOAuthProvider) {
      setError("At least one OAuth provider must be configured (ID + Secret).");
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/setup/env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values,
          adminName: adminName.trim(),
          adminEmail: adminEmail.trim().toLowerCase(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        requiresDbInit?: boolean;
      };
      if (!response.ok) {
        if (data.requiresDbInit) {
          setInfo(
            "Environment was saved, but DB schema could not be initialized automatically. Run `npx drizzle-kit push` once, then click Save Setup again.",
          );
          return;
        }
        throw new Error(data.error || "Failed to save environment values.");
      }
      router.push("/app/login");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save environment values.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <details className="rounded-md border border-stone-200 bg-stone-50 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-stone-800">
          CLI Install Help
        </summary>
        <div className="mt-3 space-y-3 text-xs text-stone-700">
          <p>Install CLIs (macOS/Homebrew):</p>
          <pre className="overflow-x-auto rounded bg-stone-900 p-2 text-stone-100">
{`brew install vercel/tap/vercel
brew install tinybirdco/tinybird/tb
brew install neonctl`}
          </pre>
          <p>Login commands:</p>
          <pre className="overflow-x-auto rounded bg-stone-900 p-2 text-stone-100">
{`vercel login
tb login
neonctl auth login`}
          </pre>
          <p>
            If already configured, bootstrap scripts skip re-provisioning and only fill missing values.
          </p>
          <p>
            Keys already provided by runtime env (for example Vercel-managed vars) are prefilled here but are not written into <code>.env</code>.
          </p>
        </div>
      </details>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">
            Admin Name *
          </span>
          <input
            type="text"
            value={adminName}
            placeholder="Site Owner"
            onChange={(event) => setAdminName(event.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
          />
          <span className="text-[11px] text-stone-500">Required. Used to verify first OAuth admin login.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">
            Admin Email *
          </span>
          <input
            type="email"
            value={adminEmail}
            placeholder="you@fernain.com"
            onChange={(event) => setAdminEmail(event.target.value)}
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
          />
          <span className="text-[11px] text-stone-500">Required. Must match first OAuth login email.</span>
        </label>
        {fields.map((field) => {
          const type = field.type ?? "text";
          return (
            <label key={field.key} className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">
                {field.label} {field.required ? "*" : ""}
              </span>
              <input
                type={type}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder ?? ""}
                onChange={(event) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: event.target.value,
                  }))
                }
                className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              />
              <span className="text-[11px] text-stone-500">{field.key}</span>
            </label>
          );
        })}
      </div>

      {error ? <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p> : null}
      {info ? <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{info}</p> : null}

      <p className="text-[11px] text-stone-500">
        Password fields may appear as dots in your browser even when values are already present.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Setup"}
        </button>
        <span className="text-xs text-stone-500">Saves env and initializes DB. First user is created on OAuth login.</span>
      </div>
    </form>
  );
}
