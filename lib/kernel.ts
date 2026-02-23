import { trace } from "@/lib/debug";

export type KernelActionName =
  | "kernel:init"
  | "plugins:register"
  | "themes:register"
  | "menus:register"
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
  | "admin:floating-widgets"
  | "auth:providers"
  | "auth:adapter"
  | "auth:callbacks:signIn"
  | "auth:callbacks:jwt"
  | "auth:callbacks:session";

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
  run: (input: { siteId?: string | null; payload?: Record<string, unknown> }) => unknown | Promise<unknown>;
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
}

export function createKernel() {
  return new Kernel();
}
