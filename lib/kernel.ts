import { trace } from "@/lib/debug";

export type KernelActionName =
  | "kernel:init"
  | "plugins:register"
  | "themes:register"
  | "menus:register"
  | "domain:event"
  | "communication:queued"
  | "request:begin"
  | "content:load"
  | "render:before"
  | "render:after"
  | "request:end";

export type KernelFilterName =
  | "content:transform"
  | "nav:items"
  | "theme:tokens"
  | "page:meta"
  | "render:layout"
  | "admin:environment-badge"
  | "admin:context-use-types"
  | "admin:context-use-type"
  | "admin:brand-use-type"
  | "admin:floating-widgets"
  | "admin:profile:sections"
  | "admin:schedule-actions"
  | "admin:editor:footer-panels"
  | "domain:scripts"
  | "domain:query"
  | "auth:providers"
  | "auth:adapter"
  | "auth:callbacks:signIn"
  | "auth:callbacks:jwt"
  | "auth:callbacks:session"
  | "communication:deliver"
  | "content:states"
  | "content:transitions"
  | "content:transition:decision";

export type MenuLocation = "header" | "footer" | "dashboard";

export type MenuItem = {
  label: string;
  href: string;
  external?: boolean;
  order?: number;
};

export type PluginContentTypeRegistration = {
  key: string;
  label?: string;
  description?: string;
};

export type PluginServerHandlerRegistration = {
  id: string;
  method?: string;
  path?: string;
};

export type PluginAuthAdapterRegistration = {
  id: string;
  create: () => unknown | Promise<unknown>;
};

export type PluginScheduleHandlerRegistration = {
  id: string;
  description?: string;
  validate?: (
    input: { siteId?: string | null; payload?: Record<string, unknown> },
  ) =>
    | { ok: boolean; error?: string }
    | Promise<{ ok: boolean; error?: string }>;
  run: (
    input: { siteId?: string | null; payload?: Record<string, unknown> },
  ) =>
    | unknown
    | {
      status: "success" | "blocked" | "skipped" | "error";
      error?: string;
    }
    | Promise<
      | unknown
      | {
        status: "success" | "blocked" | "skipped" | "error";
        error?: string;
      }
    >;
};

export type CommunicationChannel = "email" | "sms" | "mms" | "com-x";

export type CommunicationMessagePayload = {
  id: string;
  siteId?: string | null;
  channel: CommunicationChannel;
  to: string;
  subject?: string | null;
  body: string;
  category?: "transactional" | "marketing";
  metadata?: Record<string, unknown>;
};

export type PluginCommunicationProviderRegistration = {
  id: string;
  channels: CommunicationChannel[];
  deliver: (
    message: CommunicationMessagePayload,
  ) => Promise<{
    ok: boolean;
    externalId?: string;
    response?: Record<string, unknown>;
    error?: string;
  }> | {
    ok: boolean;
    externalId?: string;
    response?: Record<string, unknown>;
    error?: string;
  };
  handleCallback?: (
    input: {
      body: string;
      headers: Record<string, string>;
      query: Record<string, string | string[]>;
    },
  ) => Promise<{
    ok: boolean;
    eventType?: string;
    messageId?: string;
    externalId?: string;
    status?: "sent" | "failed" | "dead" | "logged";
    error?: string;
    metadata?: Record<string, unknown>;
  }> | {
    ok: boolean;
    eventType?: string;
    messageId?: string;
    externalId?: string;
    status?: "sent" | "failed" | "dead" | "logged";
    error?: string;
    metadata?: Record<string, unknown>;
  };
};

export type PluginWebcallbackHandlerRegistration = {
  id: string;
  handle: (
    input: {
      body: string;
      headers: Record<string, string>;
      query: Record<string, string | string[]>;
    },
  ) => Promise<{
    ok: boolean;
    status?: "processed" | "failed" | "ignored";
    response?: Record<string, unknown>;
    error?: string;
  }> | {
    ok: boolean;
    status?: "processed" | "failed" | "ignored";
    response?: Record<string, unknown>;
    error?: string;
  };
};

export type ContentStateRegistration = {
  key: string;
  label: string;
  transitions: string[];
};

export type ContentTransitionRegistration = {
  key: string;
  label: string;
  to: string;
};

type ActionCallback = (payload?: unknown) => void | Promise<void>;
type FilterCallback<T = unknown> = (value: T, context?: unknown) => T | Promise<T>;

type RegisteredAction = { priority: number; callback: ActionCallback };
type RegisteredFilter = { priority: number; callback: FilterCallback };

export class Kernel {
  private actions = new Map<string, RegisteredAction[]>();
  private filters = new Map<string, RegisteredFilter[]>();
  private menuLocations = new Set<MenuLocation>();
  private menuItems = new Map<MenuLocation, MenuItem[]>();
  private pluginContentTypes = new Map<string, PluginContentTypeRegistration[]>();
  private pluginServerHandlers = new Map<string, PluginServerHandlerRegistration[]>();
  private pluginAuthAdapters = new Map<string, PluginAuthAdapterRegistration[]>();
  private pluginScheduleHandlers = new Map<string, PluginScheduleHandlerRegistration[]>();
  private pluginCommunicationProviders = new Map<string, PluginCommunicationProviderRegistration[]>();
  private pluginWebcallbackHandlers = new Map<string, PluginWebcallbackHandlerRegistration[]>();
  private contentStates = new Map<string, ContentStateRegistration>();
  private contentTransitions = new Map<string, ContentTransitionRegistration>();

  addAction(name: KernelActionName, callback: ActionCallback, priority = 10) {
    const existing = this.actions.get(name) ?? [];
    existing.push({ priority, callback });
    existing.sort((a, b) => a.priority - b.priority);
    this.actions.set(name, existing);
    trace("kernel", "action registered", { name, priority, count: existing.length });
  }

  async doAction(name: KernelActionName, payload?: unknown) {
    const callbacks = this.actions.get(name) ?? [];
    trace("kernel", "action begin", { name, callbacks: callbacks.length, payload });
    for (const entry of callbacks) {
      await entry.callback(payload);
    }
    trace("kernel", "action end", { name, callbacks: callbacks.length });
  }

  addFilter<T = unknown>(name: KernelFilterName, callback: FilterCallback<T>, priority = 10) {
    const existing = this.filters.get(name) ?? [];
    existing.push({ priority, callback: callback as FilterCallback });
    existing.sort((a, b) => a.priority - b.priority);
    this.filters.set(name, existing);
    trace("kernel", "filter registered", { name, priority, count: existing.length });
  }

  async applyFilters<T>(name: KernelFilterName, value: T, context?: unknown) {
    const callbacks = this.filters.get(name) ?? [];
    trace("kernel", "filter begin", { name, callbacks: callbacks.length, context });
    let current: unknown = value;
    for (const entry of callbacks) {
      current = await entry.callback(current as T, context);
    }
    trace("kernel", "filter end", { name, callbacks: callbacks.length });
    return current as T;
  }

  hasFilter(name: KernelFilterName) {
    return (this.filters.get(name)?.length ?? 0) > 0;
  }

  registerMenuLocation(location: MenuLocation) {
    this.menuLocations.add(location);
    if (!this.menuItems.has(location)) {
      this.menuItems.set(location, []);
    }
    trace("kernel", "menu location registered", { location });
  }

  addMenuItems(location: MenuLocation, items: MenuItem[]) {
    if (!this.menuLocations.has(location)) {
      this.registerMenuLocation(location);
    }
    const existing = this.menuItems.get(location) ?? [];
    this.menuItems.set(location, [...existing, ...items]);
    trace("kernel", "menu items added", { location, added: items.length, total: this.menuItems.get(location)?.length ?? 0 });
  }

  getMenuItems(location: MenuLocation) {
    const items = this.menuItems.get(location) ?? [];
    return [...items].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  registerPluginContentType(pluginId: string, registration: PluginContentTypeRegistration) {
    const list = this.pluginContentTypes.get(pluginId) ?? [];
    list.push(registration);
    this.pluginContentTypes.set(pluginId, list);
    trace("kernel", "plugin content type registered", { pluginId, key: registration.key });
  }

  registerPluginServerHandler(pluginId: string, registration: PluginServerHandlerRegistration) {
    const list = this.pluginServerHandlers.get(pluginId) ?? [];
    list.push(registration);
    this.pluginServerHandlers.set(pluginId, list);
    trace("kernel", "plugin server handler registered", {
      pluginId,
      id: registration.id,
      method: registration.method,
      path: registration.path,
    });
  }

  getPluginContentTypes(pluginId: string) {
    return [...(this.pluginContentTypes.get(pluginId) ?? [])];
  }

  getPluginServerHandlers(pluginId: string) {
    return [...(this.pluginServerHandlers.get(pluginId) ?? [])];
  }

  registerPluginAuthAdapter(pluginId: string, registration: PluginAuthAdapterRegistration) {
    const list = this.pluginAuthAdapters.get(pluginId) ?? [];
    list.push(registration);
    this.pluginAuthAdapters.set(pluginId, list);
    trace("kernel", "plugin auth adapter registered", { pluginId, id: registration.id });
  }

  getPluginAuthAdapters(pluginId: string) {
    return [...(this.pluginAuthAdapters.get(pluginId) ?? [])];
  }

  getAllPluginAuthAdapters() {
    const rows: Array<PluginAuthAdapterRegistration & { pluginId: string }> = [];
    for (const [pluginId, regs] of this.pluginAuthAdapters.entries()) {
      for (const reg of regs) rows.push({ pluginId, ...reg });
    }
    return rows;
  }

  registerPluginScheduleHandler(pluginId: string, registration: PluginScheduleHandlerRegistration) {
    const list = this.pluginScheduleHandlers.get(pluginId) ?? [];
    list.push(registration);
    this.pluginScheduleHandlers.set(pluginId, list);
    trace("kernel", "plugin schedule handler registered", { pluginId, id: registration.id });
  }

  getPluginScheduleHandlers(pluginId: string) {
    return [...(this.pluginScheduleHandlers.get(pluginId) ?? [])];
  }

  registerPluginCommunicationProvider(pluginId: string, registration: PluginCommunicationProviderRegistration) {
    const list = this.pluginCommunicationProviders.get(pluginId) ?? [];
    list.push(registration);
    this.pluginCommunicationProviders.set(pluginId, list);
    trace("kernel", "plugin communication provider registered", {
      pluginId,
      id: registration.id,
      channels: registration.channels,
    });
  }

  getPluginCommunicationProviders(pluginId: string) {
    return [...(this.pluginCommunicationProviders.get(pluginId) ?? [])];
  }

  getAllPluginCommunicationProviders() {
    const rows: Array<PluginCommunicationProviderRegistration & { pluginId: string }> = [];
    for (const [pluginId, regs] of this.pluginCommunicationProviders.entries()) {
      for (const reg of regs) rows.push({ pluginId, ...reg });
    }
    return rows;
  }

  registerPluginWebcallbackHandler(pluginId: string, registration: PluginWebcallbackHandlerRegistration) {
    const list = this.pluginWebcallbackHandlers.get(pluginId) ?? [];
    list.push(registration);
    this.pluginWebcallbackHandlers.set(pluginId, list);
    trace("kernel", "plugin webcallback handler registered", {
      pluginId,
      id: registration.id,
    });
  }

  getPluginWebcallbackHandlers(pluginId: string) {
    return [...(this.pluginWebcallbackHandlers.get(pluginId) ?? [])];
  }

  getAllPluginWebcallbackHandlers() {
    const rows: Array<PluginWebcallbackHandlerRegistration & { pluginId: string }> = [];
    for (const [pluginId, regs] of this.pluginWebcallbackHandlers.entries()) {
      for (const reg of regs) rows.push({ pluginId, ...reg });
    }
    return rows;
  }

  registerContentState(registration: ContentStateRegistration) {
    const key = String(registration?.key || "").trim().toLowerCase();
    const label = String(registration?.label || "").trim();
    const transitions = Array.isArray(registration?.transitions)
      ? Array.from(new Set(registration.transitions.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)))
      : [];
    if (!key || !label) return;
    this.contentStates.set(key, { key, label, transitions });
    trace("kernel", "content state registered", { key, label, transitionsCount: transitions.length });
  }

  getContentStates() {
    return Array.from(this.contentStates.values());
  }

  registerContentTransition(registration: ContentTransitionRegistration) {
    const key = String(registration?.key || "").trim().toLowerCase();
    const label = String(registration?.label || "").trim();
    const to = String(registration?.to || "").trim().toLowerCase();
    if (!key || !label || !to) return;
    this.contentTransitions.set(key, { key, label, to });
    trace("kernel", "content transition registered", { key, to });
  }

  getContentTransitions() {
    return Array.from(this.contentTransitions.values());
  }
}

export function createKernel() {
  return new Kernel();
}
