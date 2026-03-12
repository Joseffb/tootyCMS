import { createKernelForRequest } from "@/lib/plugin-runtime";

type ContentTransformContext = {
  siteId: string;
  routeKind: string;
  entry?: {
    id: string;
    dataDomain: string;
    meta?: Array<{ key?: string; value?: string }>;
  };
};

type ContentTransformKernel = Pick<
  Awaited<ReturnType<typeof createKernelForRequest>>,
  "applyFilters"
>;

export async function applyThemeContentTransform(
  kernel: ContentTransformKernel,
  html: string,
  context: ContentTransformContext,
) {
  const input = String(html || "");
  if (!input) return "";
  const transformed = await kernel.applyFilters("content:transform", input, context);
  return typeof transformed === "string" ? transformed : input;
}
