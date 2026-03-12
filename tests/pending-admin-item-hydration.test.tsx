// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PendingAdminItemHydration,
  ReplaceAdminItemUrlInPlace,
} from "@/components/admin/pending-admin-item-hydration";

const {
  refreshMock,
  replaceMock,
  pathnameState,
  searchParamsState,
} = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  pathnameState: { value: "/app/site/test-site/domain/post/item/test-post" },
  searchParamsState: { value: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    replace: replaceMock,
  }),
  usePathname: () => pathnameState.value,
  useSearchParams: () => searchParamsState.value,
}));

describe("PendingAdminItemHydration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockReset();
    replaceMock.mockReset();
    pathnameState.value = "/app/site/test-site/domain/post/item/test-post";
    searchParamsState.value = new URLSearchParams();
    window.history.replaceState({}, "", "/app/site/test-site/domain/post/item/test-post");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps pending query state in place while hydration is in progress", async () => {
    pathnameState.value = "/app/cp/site/test-site/domain/post/item/test-post";
    searchParamsState.value = new URLSearchParams("pending=1");

    render(<PendingAdminItemHydration canonicalPath="/app/site/test-site/domain/post/item/test-post" />);

    expect(replaceMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(refreshMock).toHaveBeenCalled();
  });

  it("normalizes non-pending query variants back to the canonical path", () => {
    searchParamsState.value = new URLSearchParams("foo=1");

    render(<PendingAdminItemHydration canonicalPath="/app/site/test-site/domain/post/item/test-post" />);

    expect(replaceMock).toHaveBeenCalledWith("/app/site/test-site/domain/post/item/test-post");
  });

  it("keeps pending editor urls in place and refreshes until the editor surface is ready", async () => {
    searchParamsState.value = new URLSearchParams("pending=1");
    window.history.replaceState({}, "", "/app/site/test-site/domain/post/item/test-post?pending=1");

    render(
      <ReplaceAdminItemUrlInPlace
        canonicalPath="/app/site/test-site/domain/post/item/test-post"
        waitForEditorReady
      />,
    );

    expect(window.location.search).toBe("?pending=1");

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(refreshMock).toHaveBeenCalled();
    expect(window.location.search).toBe("?pending=1");
  });
});
