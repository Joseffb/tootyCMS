import db from "@/lib/db";
import { eq } from "drizzle-orm";
import { cmsSettings } from "@/lib/schema";
import { resolveSetupLifecycleState, type SetupLifecycleState } from "@/lib/setup-lifecycle";

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
    const [user, site, setupCompletedRow, lifecycleStateRow] = await Promise.all([
      db.query.users.findFirst({ columns: { id: true } }),
      db.query.sites.findFirst({ columns: { id: true } }),
      db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "setup_completed"),
        columns: { value: true },
      }),
      db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "setup_lifecycle_state"),
        columns: { value: true },
      }),
    ]);

    const hasUsers = Boolean(user);
    const hasSites = Boolean(site);
    const explicitSetupCompleted = setupCompletedRow?.value === "true";
    const setupCompleted = explicitSetupCompleted || (hasUsers && hasSites);
    const lifecycleState = resolveSetupLifecycleState({
      storedState: lifecycleStateRow?.value ?? "",
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
