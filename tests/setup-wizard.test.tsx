import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupWizard from "@/app/setup/setup-wizard";

const { pushMock, refreshMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

const signInMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: refreshMock,
  }),
}));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

describe("SetupWizard", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    signInMock.mockReset();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch);
  });

  it("routes to /app when native sign-in returns ok without url", async () => {
    signInMock.mockResolvedValue({ ok: true, url: null });

    render(
      <SetupWizard
        fields={[
          { key: "POSTGRES_URL", label: "Postgres URL", required: true, type: "text" },
          { key: "DEBUG_MODE", label: "Debug", required: false, type: "text" },
        ]}
        initialValues={{
          POSTGRES_URL: "postgres://example",
          DEBUG_MODE: "true",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByPlaceholderText("Site Owner"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "password123" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Finish Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish Setup" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/app");
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("routes to login with error when native auto-login fails", async () => {
    signInMock.mockResolvedValue({ ok: false, error: "CredentialsSignin" });

    render(
      <SetupWizard
        fields={[
          { key: "POSTGRES_URL", label: "Postgres URL", required: true, type: "text" },
          { key: "DEBUG_MODE", label: "Debug", required: false, type: "text" },
        ]}
        initialValues={{
          POSTGRES_URL: "postgres://example",
          DEBUG_MODE: "true",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByPlaceholderText("Site Owner"), { target: { value: "Admin" } });
    fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "admin@example.com" } });
    fireEvent.change(screen.getByPlaceholderText("At least 8 characters"), { target: { value: "password123" } });
    fireEvent.change(screen.getByPlaceholderText("Repeat password"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Finish Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish Setup" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalled();
    });
    const pushedUrl = String(pushMock.mock.calls.at(-1)?.[0] ?? "");
    expect(pushedUrl.startsWith("/app/login?error=")).toBe(true);
    expect(decodeURIComponent(pushedUrl)).toContain("CredentialsSignin");
  });
});
