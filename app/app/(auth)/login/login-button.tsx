"use client";

import LoadingDots from "@/components/icons/loading-dots";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function LoginButton() {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [forgotBusy, setForgotBusy] = useState<"request" | "reset" | null>(null);
  const [enabledByProvider, setEnabledByProvider] = useState<Record<string, boolean>>({});
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);

  // Get error message added by next/auth in URL.
  const searchParams = useSearchParams();
  const error = searchParams?.get("error");
  const callbackUrl = String(searchParams?.get("callbackUrl") || "").trim() || "/app";

  useEffect(() => {
    const errorMessage = Array.isArray(error) ? error.pop() : error;
    errorMessage && toast.error(errorMessage);
  }, [error]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/provider-settings")
      .then((response) => response.json())
      .then((data) => {
        if (!mounted || !data?.enabled) return;
        setEnabledByProvider(data.enabled);
        if (Array.isArray(data.providers)) {
          setProviders(data.providers.map((provider: { id: string; name: string }) => ({
            id: provider.id,
            name: provider.name,
          })));
        }
      })
      .catch(() => {
        // Keep defaults (enabled) on network errors.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const visibleProviders = providers.filter((provider) => enabledByProvider[provider.id] !== false);

  return (
    <div className="space-y-2">
      <form
        className="space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-700"
        onSubmit={(event) => {
          event.preventDefault();
          if (!email.trim() || !password) return;
          setLoadingProvider("native");
          signIn("native", {
            email: email.trim().toLowerCase(),
            password,
            callbackUrl,
          });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
        />
        <button
          type="submit"
          disabled={loadingProvider !== null}
          className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {loadingProvider === "native" ? "Signing in..." : "Login with Email"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForgot((value) => !value);
            setForgotEmail((prev) => prev || email.trim().toLowerCase());
          }}
          className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-900"
        >
          {showForgot ? "Back To Login" : "Forgot Password?"}
        </button>
      </form>

      {showForgot ? (
        <div className="space-y-2 rounded-md border border-stone-200 p-3 dark:border-stone-700">
          <input
            type="email"
            value={forgotEmail}
            onChange={(event) => setForgotEmail(event.target.value)}
            placeholder="Email"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <button
            type="button"
            disabled={forgotBusy !== null || !forgotEmail.trim()}
            onClick={async () => {
              try {
                setForgotBusy("request");
                const response = await fetch("/api/auth/native/password-reset", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "request",
                    email: forgotEmail.trim().toLowerCase(),
                  }),
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok) {
                  throw new Error(String((json as any)?.error || "Failed to send reset code."));
                }
                toast.success("If eligible, a reset code was sent.");
              } catch (err: any) {
                toast.error(err instanceof Error ? err.message : "Failed to send reset code.");
              } finally {
                setForgotBusy(null);
              }
            }}
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-60 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-900"
          >
            {forgotBusy === "request" ? "Sending..." : "Send Reset Code"}
          </button>
          <input
            type="text"
            value={resetCode}
            onChange={(event) => setResetCode(event.target.value)}
            placeholder="Reset code"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password (min 8 chars)"
            className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <button
            type="button"
            disabled={forgotBusy !== null || !forgotEmail.trim() || !resetCode.trim() || !newPassword}
            onClick={async () => {
              try {
                setForgotBusy("reset");
                const response = await fetch("/api/auth/native/password-reset", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "reset",
                    email: forgotEmail.trim().toLowerCase(),
                    code: resetCode.trim(),
                    password: newPassword,
                  }),
                });
                const json = await response.json().catch(() => ({}));
                if (!response.ok || !(json as any)?.ok) {
                  throw new Error(String((json as any)?.error || "Password reset failed."));
                }
                toast.success("Password reset successful. Log in with your new password.");
                setShowForgot(false);
                setEmail(forgotEmail.trim().toLowerCase());
                setPassword("");
                setResetCode("");
                setNewPassword("");
              } catch (err: any) {
                toast.error(err instanceof Error ? err.message : "Password reset failed.");
              } finally {
                setForgotBusy(null);
              }
            }}
            className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {forgotBusy === "reset" ? "Resetting..." : "Reset Password"}
          </button>
        </div>
      ) : null}

      {visibleProviders.length === 0 && (
        <p className="text-center text-sm text-stone-500 dark:text-stone-400">
          Native auth is active. Enable an auth plugin to use OAuth sign-in.
        </p>
      )}
      {visibleProviders.map((provider) => {
        const isLoading = loadingProvider === provider.id;
        const isDisabled = !!loadingProvider;
        return (
          <button
            key={provider.id}
            disabled={isDisabled}
            onClick={() => {
              setLoadingProvider(provider.id);
              signIn(provider.id);
            }}
            className={`${
              isLoading
                ? "cursor-not-allowed bg-stone-50 dark:bg-stone-800"
                : "bg-white hover:bg-stone-50 active:bg-stone-100 dark:bg-black dark:hover:border-white dark:hover:bg-black"
            } group my-2 flex h-10 w-full items-center justify-center space-x-2 rounded-md border border-stone-200 transition-colors duration-75 focus:outline-none dark:border-stone-700`}
          >
            {isLoading ? (
              <LoadingDots color="#A8A29E" />
            ) : (
              <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                {`Login with ${provider.name}`}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
