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
  const [enabledByProvider, setEnabledByProvider] = useState<Record<string, boolean>>({});
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);

  // Get error message added by next/auth in URL.
  const searchParams = useSearchParams();
  const error = searchParams?.get("error");

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
            callbackUrl: "/app",
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
      </form>

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
