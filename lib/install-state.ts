import db from "@/lib/db";
import { eq } from "drizzle-orm";
import { cmsSettings } from "@/lib/schema";

export type InstallState = {
  setupRequired: boolean;
  dbReachable: boolean;
  hasUsers: boolean;
  hasSites: boolean;
  setupCompleted: boolean;
};

export async function getInstallState(): Promise<InstallState> {
  try {
    const [user, site, setupCompletedRow] = await Promise.all([
      db.query.users.findFirst({ columns: { id: true } }),
      db.query.sites.findFirst({ columns: { id: true } }),
      db.query.cmsSettings.findFirst({
        where: eq(cmsSettings.key, "setup_completed"),
        columns: { value: true },
      }),
    ]);

    const hasUsers = Boolean(user);
    const hasSites = Boolean(site);
    const explicitSetupCompleted = setupCompletedRow?.value === "true";
    // Backward-compatibility: older installs may not have setup_completed flag.
    const setupCompleted = explicitSetupCompleted || (hasUsers && hasSites);

    return {
      setupRequired: !setupCompleted,
      dbReachable: true,
      hasUsers,
      hasSites,
      setupCompleted,
    };
  } catch {
    return {
      setupRequired: true,
      dbReachable: false,
      hasUsers: false,
      hasSites: false,
      setupCompleted: false,
    };
  }
}
