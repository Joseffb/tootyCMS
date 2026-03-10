import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("editor delete controls", () => {
  it("renders a typed delete affordance inside the More panel", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain("Danger Zone");
    expect(source).toContain("Delete Entry");
    expect(source).toContain('Type "delete" to permanently remove this untitled entry.');
    expect(source).toContain("Type \"${deleteConfirmationTarget}\" to permanently remove this entry.");
  });

  it("renders the delete dialog on an opaque system surface instead of a transparent overlay shell", () => {
    const source = readFileSync(
      path.join(process.cwd(), "components/editor/editor.tsx"),
      "utf8",
    );

    expect(source).toContain('DialogContent className="max-w-md border-stone-200 bg-white text-stone-900 shadow-2xl dark:border-stone-700 dark:bg-stone-950 dark:text-white"');
  });
});
