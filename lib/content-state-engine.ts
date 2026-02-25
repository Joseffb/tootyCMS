import { createKernelForRequest } from "@/lib/plugin-runtime";
import type { ContentStateRegistration, ContentTransitionRegistration } from "@/lib/kernel";

export type ContentStateKey = string;

export type ContentTransition = {
  key: string;
  label: string;
  to: ContentStateKey;
};

export type TransitionDecisionContext = {
  siteId?: string | null;
  from: ContentStateKey;
  to: ContentStateKey;
  contentType: "domain";
  contentId: string;
  userId?: string;
};

const DEFAULT_STATES: ContentStateRegistration[] = [
  { key: "draft", label: "Draft", transitions: ["publish"] },
  { key: "published", label: "Published", transitions: ["unpublish"] },
];

const DEFAULT_TRANSITIONS: ContentTransitionRegistration[] = [
  { key: "publish", label: "Publish", to: "published" },
  { key: "unpublish", label: "Unpublish", to: "draft" },
];

function normalizeState(input: ContentStateRegistration) {
  const key = String(input.key || "").trim().toLowerCase();
  const label = String(input.label || "").trim();
  const transitions = Array.isArray(input.transitions)
    ? input.transitions.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!key || !label) return null;
  return { key, label, transitions };
}

function normalizeTransition(input: ContentTransitionRegistration) {
  const key = String(input.key || "").trim().toLowerCase();
  const label = String(input.label || "").trim();
  const to = String(input.to || "").trim().toLowerCase();
  if (!key || !label || !to) return null;
  return { key, label, to };
}

export function stateFromPublishedFlag(published: boolean) {
  return published ? "published" : "draft";
}

export async function getContentStateModel(siteId?: string | null) {
  const kernel = await createKernelForRequest(siteId || undefined);

  for (const state of DEFAULT_STATES) kernel.registerContentState(state);
  for (const transition of DEFAULT_TRANSITIONS) kernel.registerContentTransition(transition);

  const filteredStates = await kernel.applyFilters<ContentStateRegistration[]>(
    "content:states",
    kernel.getContentStates(),
    { siteId: siteId || null },
  );
  const filteredTransitions = await kernel.applyFilters<ContentTransitionRegistration[]>(
    "content:transitions",
    kernel.getContentTransitions(),
    { siteId: siteId || null },
  );

  const states = (Array.isArray(filteredStates) ? filteredStates : [])
    .map(normalizeState)
    .filter(Boolean) as Array<{ key: string; label: string; transitions: string[] }>;
  const transitions = (Array.isArray(filteredTransitions) ? filteredTransitions : [])
    .map(normalizeTransition)
    .filter(Boolean) as Array<{ key: string; label: string; to: string }>;

  const transitionMap = new Map(transitions.map((t) => [t.key, t]));
  const stateMap = new Map(states.map((s) => [s.key, s]));
  return { kernel, stateMap, transitionMap };
}

export async function canTransitionContentState(context: TransitionDecisionContext) {
  const model = await getContentStateModel(context.siteId || null);
  const from = String(context.from || "").trim().toLowerCase();
  const to = String(context.to || "").trim().toLowerCase();
  if (!from || !to) return false;
  if (from === to) return true;
  const fromState = model.stateMap.get(from);
  if (!fromState) return false;
  let allowedByModel = false;
  for (const transitionKey of fromState.transitions) {
    const transition = model.transitionMap.get(transitionKey);
    if (transition?.to === to) {
      allowedByModel = true;
      break;
    }
  }
  if (!allowedByModel) return false;

  const decision = await model.kernel.applyFilters<boolean>(
    "content:transition:decision",
    true,
    {
      siteId: context.siteId || null,
      from,
      to,
      contentType: context.contentType,
      contentId: context.contentId,
      userId: context.userId || null,
    },
  );
  return Boolean(decision);
}

