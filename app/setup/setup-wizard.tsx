"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SetupEnvField } from "@/lib/setup-env";
import { signIn } from "next-auth/react";

type Props = {
  fields: SetupEnvField[];
  initialValues: Record<string, string>;
};
type FieldGroup = {
  id: string;
  label: string;
  fields: SetupEnvField[];
};

const DB_FIELD_KEYS = new Set([
  "POSTGRES_URL",
  "POSTGRES_TEST_URL",
  "CMS_DB_PREFIX",
  "NEXT_PUBLIC_ROOT_DOMAIN",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
]);

const STEPS = ["Database", "Admin User", "Optional Settings"] as const;

function getOptionalFieldGroups(optionalFields: SetupEnvField[]): FieldGroup[] {
  const groupOrder = [
    "general",
    "github",
    "google",
    "facebook",
    "apple",
    "vercel",
    "aws",
    "openai",
  ] as const;

  const groups: Record<(typeof groupOrder)[number], FieldGroup> = {
    general: { id: "general", label: "General", fields: [] },
    github: { id: "github", label: "GitHub", fields: [] },
    google: { id: "google", label: "Google", fields: [] },
    facebook: { id: "facebook", label: "Facebook", fields: [] },
    apple: { id: "apple", label: "Apple", fields: [] },
    vercel: { id: "vercel", label: "Vercel", fields: [] },
    aws: { id: "aws", label: "AWS / S3", fields: [] },
    openai: { id: "openai", label: "OpenAI", fields: [] },
  };

  for (const field of optionalFields) {
    const key = field.key;
    if (key.startsWith("AUTH_GITHUB_")) groups.github.fields.push(field);
    else if (key.startsWith("AUTH_GOOGLE_")) groups.google.fields.push(field);
    else if (key.startsWith("AUTH_FACEBOOK_")) groups.facebook.fields.push(field);
    else if (key.startsWith("AUTH_APPLE_")) groups.apple.fields.push(field);
    else if (
      key === "AUTH_BEARER_TOKEN" ||
      key === "PROJECT_ID_VERCEL" ||
      key === "TEAM_ID_VERCEL" ||
      key === "BLOB_READ_WRITE_TOKEN" ||
      key === "NEXT_PUBLIC_VERCEL_DEPLOYMENT_SUFFIX"
    ) groups.vercel.fields.push(field);
    else if (key.startsWith("AWS_")) groups.aws.fields.push(field);
    else if (key === "OPENAI_API_KEY") groups.openai.fields.push(field);
    else groups.general.fields.push(field);
  }

  return groupOrder.map((id) => groups[id]).filter((group) => group.fields.length > 0);
}

export default function SetupWizard({ fields, initialValues }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const [adminName, setAdminName] = useState(initialValues.SETUP_ADMIN_NAME ?? "");
  const [adminEmail, setAdminEmail] = useState(initialValues.SETUP_ADMIN_EMAIL ?? "");
  const [adminPhone, setAdminPhone] = useState(initialValues.SETUP_ADMIN_PHONE ?? "");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [finishRequested, setFinishRequested] = useState(false);

  const dbFields = useMemo(
    () => fields.filter((field) => DB_FIELD_KEYS.has(field.key)),
    [fields],
  );

  const optionalFields = useMemo(
    () => fields.filter((field) => !DB_FIELD_KEYS.has(field.key)),
    [fields],
  );
  const optionalGroups = useMemo(() => getOptionalFieldGroups(optionalFields), [optionalFields]);

  const missingRequiredDb = useMemo(
    () => dbFields.filter((field) => field.required && !(values[field.key] || "").trim()),
    [dbFields, values],
  );

  const missingRequiredAll = useMemo(
    () => fields.filter((field) => field.required && !(values[field.key] || "").trim()),
    [fields, values],
  );

  function nextStep() {
    setError(null);
    setFinishRequested(false);
    if (stepIndex === 0) {
      if (missingRequiredDb.length > 0) {
        setError(`Missing required database fields: ${missingRequiredDb.map((field) => field.key).join(", ")}`);
        return;
      }
      setStepIndex(1);
      return;
    }

    if (stepIndex === 1) {
      if (!adminName.trim() || !adminEmail.trim()) {
        setError("Admin Name and Admin Email are required.");
        return;
      }
      if (!adminPassword || adminPassword.length < 8) {
        setError("Admin password must be at least 8 characters.");
        return;
      }
      if (adminPassword !== adminPasswordConfirm) {
        setError("Admin password confirmation does not match.");
        return;
      }
      setStepIndex(2);
    }
  }

  function prevStep() {
    setError(null);
    setFinishRequested(false);
    setStepIndex((current) => Math.max(0, current - 1));
  }

  async function signInWithRetry(email: string, password: string, callbackUrl: string): Promise<{
    ok: boolean;
    url?: string;
    error?: string;
  }> {
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const authResult = (await signIn("native", {
        email,
        password,
        redirect: false,
        callbackUrl,
      })) as
        | string
        | {
            ok?: boolean;
            url?: string | null;
            error?: string;
          }
        | undefined;

      if (typeof authResult === "string" && authResult.trim()) {
        return { ok: true, url: authResult };
      }
      if (authResult && typeof authResult === "object") {
        if (authResult.ok && !authResult.error) {
          return { ok: true, url: authResult.url || "/app" };
        }
        if (authResult.error) lastError = authResult.error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: false, error: lastError || "Native sign-in failed" };
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stepIndex < 2) {
      nextStep();
      return;
    }
    if (!finishRequested) {
      setError("Review step 3 and click Finish Setup to apply configuration.");
      return;
    }

    if (missingRequiredAll.length > 0) {
      setError(`Missing required fields: ${missingRequiredAll.map((field) => field.key).join(", ")}`);
      return;
    }

    if (!adminName.trim() || !adminEmail.trim()) {
      setError("Admin Name and Admin Email are required.");
      return;
    }
    if (!adminPassword || adminPassword.length < 8) {
      setError("Admin password must be at least 8 characters.");
      return;
    }
    if (adminPassword !== adminPasswordConfirm) {
      setError("Admin password confirmation does not match.");
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
          adminPhone: adminPhone.trim(),
          adminPassword,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        requiresDbInit?: boolean;
        mainSiteId?: string | null;
      };

      if (!response.ok) {
        if (data.requiresDbInit) {
          setInfo(
            "Environment was saved, but DB schema could not be initialized automatically. Run `npx drizzle-kit push` once, then click Finish Setup again.",
          );
          return;
        }
        throw new Error(data.error || "Failed to save environment values.");
      }

      const mainSiteId = String(data.mainSiteId || "").trim();
      const destinationPath = mainSiteId ? `/site/${mainSiteId}` : "/app";
      const signInResult = await signInWithRetry(adminEmail.trim().toLowerCase(), adminPassword, destinationPath);
      if (signInResult.ok) {
        router.push(destinationPath);
      } else {
        const message = encodeURIComponent(
          `Setup completed, but auto sign-in failed: ${signInResult.error || "Unknown error"}`,
        );
        router.push(`/app/login?error=${message}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save environment values.");
    } finally {
      setSaving(false);
    }
  }

  function renderField(field: SetupEnvField) {
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
        <span className="text-[11px] text-stone-500">
          {field.helpText ? `${field.helpText} (${field.key})` : field.key}
        </span>
      </label>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, index) => {
          const active = stepIndex === index;
          const complete = stepIndex > index;
          return (
            <div
              key={step}
              className={`rounded-lg border px-4 py-3 text-sm ${
                active
                  ? "border-stone-900 bg-stone-900 text-white"
                  : complete
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-stone-200 bg-stone-50 text-stone-500"
              }`}
            >
              <div className="font-semibold">Step {index + 1}</div>
              <div>{step}</div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        {stepIndex === 0 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-cal text-2xl text-stone-900">Database Settings</h2>
              <p className="mt-1 text-sm text-stone-600">
                Configure connection and core runtime identity. These are required for boot.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">{dbFields.map(renderField)}</div>
          </div>
        ) : null}

        {stepIndex === 1 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-cal text-2xl text-stone-900">Admin User</h2>
              <p className="mt-1 text-sm text-stone-600">
                Create the first native network admin account for this install.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Admin Name *</span>
                <input
                  type="text"
                  value={adminName}
                  placeholder="Site Owner"
                  onChange={(event) => setAdminName(event.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Admin Email *</span>
                <input
                  type="email"
                  value={adminEmail}
                  placeholder="you@example.com"
                  onChange={(event) => setAdminEmail(event.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
                <span className="text-[11px] text-stone-500">Required. Used for first native admin login identity.</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Telephone (optional)</span>
                <input
                  type="tel"
                  value={adminPhone}
                  placeholder="+1 555 123 4567"
                  onChange={(event) => setAdminPhone(event.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
                <span className="text-[11px] text-stone-500">Optional. Stored for future MMS/contact workflows.</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Admin Password *</span>
                <input
                  type="password"
                  value={adminPassword}
                  placeholder="At least 8 characters"
                  onChange={(event) => setAdminPassword(event.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-700">Confirm Password *</span>
                <input
                  type="password"
                  value={adminPasswordConfirm}
                  placeholder="Repeat password"
                  onChange={(event) => setAdminPasswordConfirm(event.target.value)}
                  className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                />
              </label>
            </div>
          </div>
        ) : null}

        {stepIndex === 2 ? (
          <div className="space-y-4">
            <div>
              <h2 className="font-cal text-2xl text-stone-900">Optional Settings</h2>
              <p className="mt-1 text-sm text-stone-600">
                Configure providers, storage, and debug options now, or leave them blank and add later.
              </p>
            </div>

            <details className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-stone-800">CLI Install Help</summary>
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
              </div>
            </details>

            <div className="space-y-3">
              {optionalGroups.map((group, idx) => (
                <details
                  key={group.id}
                  open={idx === 0}
                  className="rounded-lg border border-stone-200 bg-stone-50"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-stone-800">
                    {group.label} ({group.fields.length})
                  </summary>
                  <div className="border-t border-stone-200 bg-white px-4 py-4">
                    <div className="grid gap-4 md:grid-cols-2">{group.fields.map(renderField)}</div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {info ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{info}</p> : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={prevStep}
          disabled={stepIndex === 0 || saving}
          className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500">Step {stepIndex + 1} of {STEPS.length}</span>
          {stepIndex < 2 ? (
            <button
              type="button"
              onClick={nextStep}
              disabled={saving}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              onClick={() => setFinishRequested(true)}
              disabled={saving}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Finishing..." : "Finish Setup"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
