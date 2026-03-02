// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Form from "@/components/form";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "site-1" }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ update: vi.fn() }),
}));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    useFormStatus: () => ({ pending: false }),
  };
});

vi.mock("@/components/media/media-picker-field", () => ({
  default: ({ name, label }: { name: string; label: string }) => (
    <div data-testid={`media-field-${name}`}>{label}</div>
  ),
}));

describe("Form", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders image fields with the shared media picker", () => {
    render(
      <Form
        title="Site Card Image"
        description="desc"
        helpText="help"
        inputAttrs={{
          name: "image",
          type: "text",
          defaultValue: "",
        }}
        handleSubmit={async () => ({ ok: true })}
      />,
    );

    expect(screen.getByTestId("media-field-image")).toBeTruthy();
  });
});
