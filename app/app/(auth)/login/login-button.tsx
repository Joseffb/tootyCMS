"use client";

import LoadingDots from "@/components/icons/loading-dots";
import { getProviders, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function LoginButton() {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [enabledByProvider, setEnabledByProvider] = useState<Record<string, boolean>>({});

  // Get error message added by next/auth in URL.
  const searchParams = useSearchParams();
  const error = searchParams?.get("error");

  useEffect(() => {
    const errorMessage = Array.isArray(error) ? error.pop() : error;
    errorMessage && toast.error(errorMessage);
  }, [error]);

  useEffect(() => {
    let mounted = true;
    getProviders().then((result) => {
      if (!mounted || !result) return;
      setProviders(Object.values(result).map((provider) => ({
        id: provider.id,
        name: provider.name,
      })));
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/provider-settings")
      .then((response) => response.json())
      .then((data) => {
        if (!mounted || !data?.enabled) return;
        setEnabledByProvider(data.enabled);
      })
      .catch(() => {
        // Keep defaults (enabled) on network errors.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const providerOrder = ["github", "google", "facebook", "apple"];
  const labelById: Record<string, string> = {
    github: "GitHub",
    google: "Google",
    facebook: "Facebook",
    apple: "Apple",
  };

  const configuredById = Object.fromEntries(
    providers.map((provider) => [provider.id, true]),
  );
  const showUnconfigured = process.env.NEXT_PUBLIC_DEBUG_MODE === "true";
  const visibleProviders = providerOrder
    .filter((id) => enabledByProvider[id] !== false)
    .filter((id) => showUnconfigured || configuredById[id] === true)
    .map((id) => ({
      id,
      name: labelById[id] ?? id,
      configured: configuredById[id] === true,
    }));

  return (
    <div className="space-y-2">
      {visibleProviders.length === 0 && (
        <p className="text-center text-sm text-stone-500 dark:text-stone-400">
          No auth providers are configured.
        </p>
      )}
      {visibleProviders.map((provider) => {
        const isLoading = loadingProvider === provider.id;
        const isDisabled = !provider.configured || !!loadingProvider;
        return (
          <button
            key={provider.id}
            disabled={isDisabled}
            onClick={() => {
              if (!provider.configured) return;
              setLoadingProvider(provider.id);
              signIn(provider.id);
            }}
            className={`${
              isLoading
                ? "cursor-not-allowed bg-stone-50 dark:bg-stone-800"
                : !provider.configured
                ? "cursor-not-allowed bg-stone-100 opacity-70 dark:bg-stone-900"
                : "bg-white hover:bg-stone-50 active:bg-stone-100 dark:bg-black dark:hover:border-white dark:hover:bg-black"
            } group my-2 flex h-10 w-full items-center justify-center space-x-2 rounded-md border border-stone-200 transition-colors duration-75 focus:outline-none dark:border-stone-700`}
          >
            {isLoading ? (
              <LoadingDots color="#A8A29E" />
            ) : (
              <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
                {provider.configured
                  ? `Login with ${labelById[provider.id] ?? provider.name}`
                  : `${labelById[provider.id] ?? provider.name} (not configured)`}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
