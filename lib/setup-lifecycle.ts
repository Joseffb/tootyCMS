import { getTextSetting, setTextSetting } from "@/lib/cms-config";

export const SETUP_LIFECYCLE_STATE_KEY = "setup_lifecycle_state";
export const SETUP_LIFECYCLE_UPDATED_AT_KEY = "setup_lifecycle_updated_at";

export const SETUP_LIFECYCLE_STATES = [
  "not_configured",
  "configured",
  "migrated",
  "ready",
] as const;

export type SetupLifecycleState = (typeof SETUP_LIFECYCLE_STATES)[number];

function isSetupLifecycleState(value: unknown): value is SetupLifecycleState {
  return SETUP_LIFECYCLE_STATES.includes(String(value) as SetupLifecycleState);
}

const SETUP_LIFECYCLE_INDEX = new Map<SetupLifecycleState, number>(
  SETUP_LIFECYCLE_STATES.map((state, index) => [state, index]),
);

export function getSetupLifecycleIndex(state: SetupLifecycleState) {
  return SETUP_LIFECYCLE_INDEX.get(state) ?? 0;
}

export function canSetupLifecycleTransition(from: SetupLifecycleState, to: SetupLifecycleState) {
  const fromIndex = getSetupLifecycleIndex(from);
  const toIndex = getSetupLifecycleIndex(to);
  return toIndex === fromIndex + 1;
}

export function assertSetupLifecycleTransition(from: SetupLifecycleState, to: SetupLifecycleState) {
  if (!canSetupLifecycleTransition(from, to)) {
    throw new Error(`Invalid setup lifecycle transition: ${from} -> ${to}`);
  }
}

export function resolveSetupLifecycleState(input: {
  storedState?: string | null;
  setupCompleted?: boolean;
  hasUsers?: boolean;
  hasSites?: boolean;
}): SetupLifecycleState {
  const stored = String(input.storedState || "").trim();
  if (isSetupLifecycleState(stored)) {
    return stored;
  }
  if (input.setupCompleted) {
    return "ready";
  }
  if (input.hasUsers && input.hasSites) {
    // Backward compatibility for pre-lifecycle installs.
    return "ready";
  }
  if (input.hasUsers || input.hasSites) {
    return "migrated";
  }
  return "not_configured";
}

export async function getSetupLifecycleState(input?: {
  setupCompleted?: boolean;
  hasUsers?: boolean;
  hasSites?: boolean;
}) {
  const storedState = await getTextSetting(SETUP_LIFECYCLE_STATE_KEY, "");
  return resolveSetupLifecycleState({
    storedState,
    setupCompleted: input?.setupCompleted,
    hasUsers: input?.hasUsers,
    hasSites: input?.hasSites,
  });
}

export async function setSetupLifecycleState(state: SetupLifecycleState) {
  await setTextSetting(SETUP_LIFECYCLE_STATE_KEY, state);
  await setTextSetting(SETUP_LIFECYCLE_UPDATED_AT_KEY, new Date().toISOString());
}

export async function advanceSetupLifecycleTo(target: SetupLifecycleState) {
  const storedState = await getTextSetting(SETUP_LIFECYCLE_STATE_KEY, "");
  const current = resolveSetupLifecycleState({ storedState });
  const currentIndex = getSetupLifecycleIndex(current);
  const targetIndex = getSetupLifecycleIndex(target);
  if (targetIndex <= currentIndex) {
    return { from: current, to: current, changed: false as const };
  }

  let cursor = current;
  for (let index = currentIndex + 1; index <= targetIndex; index += 1) {
    const next = SETUP_LIFECYCLE_STATES[index];
    assertSetupLifecycleTransition(cursor, next);
    await setSetupLifecycleState(next);
    cursor = next;
  }

  return { from: current, to: cursor, changed: true as const };
}
