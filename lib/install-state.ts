import db from "@/lib/db";
import { resolveSetupLifecycleState, type SetupLifecycleState } from "@/lib/setup-lifecycle";
import { getSettingByKey } from "@/lib/settings-store";

export type InstallState = {
  setupRequired: boolean;
  dbReachable: boolean;
  hasUsers: boolean;
  hasSites: boolean;
  setupCompleted: boolean;
  lifecycleState: SetupLifecycleState;
};

export async function getInstallState(): Promise<InstallState> {
  try {
    const [user, site, setupCompletedValue, lifecycleStateValue] = await Promise.all([
      db.query.users.findFirst({ columns: { id: true } }),
      db.query.sites.findFirst({ columns: { id: true } }),
      getSettingByKey("setup_completed"),
      getSettingByKey("setup_lifecycle_state"),
    ]);

    const hasUsers = Boolean(user);
    const hasSites = Boolean(site);
    const explicitSetupCompleted = setupCompletedValue === "true";
    const setupCompleted = explicitSetupCompleted || (hasUsers && hasSites);
    const lifecycleState = resolveSetupLifecycleState({
      storedState: lifecycleStateValue ?? "",
      setupCompleted,
      hasUsers,
      hasSites,
    });

    return {
      setupRequired: lifecycleState !== "ready",
      dbReachable: true,
      hasUsers,
      hasSites,
      setupCompleted,
      lifecycleState,
    };
  } catch {
    return {
      setupRequired: true,
      dbReachable: false,
      hasUsers: false,
      hasSites: false,
      setupCompleted: false,
      lifecycleState: "not_configured",
    };
  }
}
