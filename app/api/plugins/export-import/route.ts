import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { userCan } from "@/lib/authorization";
import { createKernelForRequest } from "@/lib/plugin-runtime";

type ActionName = "providers" | "export" | "import.inspect" | "import.apply";

type Body = {
  action?: ActionName;
  siteId?: string | null;
  format?: string | null;
  options?: Record<string, unknown> | null;
  payload?: unknown;
  payloadUrl?: string | null;
};

function toSafeString(value: unknown) {
  return String(value || "").trim();
}

async function resolvePayload(body: Body) {
  const directPayload = body.payload;
  if (directPayload !== undefined && directPayload !== null && String(directPayload).trim() !== "") {
    return directPayload;
  }

  const payloadUrl = toSafeString(body.payloadUrl);
  if (!payloadUrl) return null;
  if (!/^https?:\/\//i.test(payloadUrl)) {
    throw new Error("Import URL must start with http:// or https://");
  }

  const response = await fetch(payloadUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to fetch import payload URL (${response.status})`);
  }
  const text = await response.text();
  if (text.length > 2_000_000) {
    throw new Error("Import payload URL is too large (max 2MB).");
  }
  return text;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const action = toSafeString(body.action) as ActionName;
  const siteId = toSafeString(body.siteId);
  const format = toSafeString(body.format).toLowerCase();

  const canManageNetworkPlugins = await userCan("network.plugins.manage", session.user.id);
  const canManageSiteSettings = siteId
    ? await userCan("site.settings.write", session.user.id, { siteId })
    : false;
  const allowed = siteId ? canManageNetworkPlugins || canManageSiteSettings : canManageNetworkPlugins;
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const kernel = await createKernelForRequest(siteId || undefined);
  const sendQuery = async (name: string, params: Record<string, unknown>) => {
    const response = await kernel.applyFilters<Response | null>("domain:query", null, { name, params });
    if (!(response instanceof Response)) {
      return NextResponse.json({ ok: false, error: "Migration provider did not return a response." }, { status: 500 });
    }
    const payload = await response.json().catch(() => ({ ok: false, error: "Invalid provider response." }));
    return NextResponse.json(payload, { status: response.status });
  };

  if (action === "providers") {
    return sendQuery("export_import.providers", { siteId });
  }

  if (action === "export") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    return sendQuery("export_import.export", {
      siteId,
      format,
      options: body.options && typeof body.options === "object" ? body.options : {},
    });
  }

  if (action === "import.inspect" || action === "import.apply") {
    if (!format) return NextResponse.json({ ok: false, error: "Format is required." }, { status: 400 });
    let payload: unknown = null;
    try {
      payload = await resolvePayload(body);
    } catch (error: any) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid import payload." }, { status: 400 });
    }
    if (payload === null) {
      return NextResponse.json({ ok: false, error: "Import payload is required." }, { status: 400 });
    }
    return sendQuery(
      action === "import.inspect" ? "export_import.import.inspect" : "export_import.import.apply",
      {
        siteId,
        format,
        payload,
      },
    );
  }

  return NextResponse.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
