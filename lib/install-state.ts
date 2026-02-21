import db from "@/lib/db";

export type InstallState = {
  setupRequired: boolean;
  dbReachable: boolean;
  hasUsers: boolean;
  hasSites: boolean;
};

export async function getInstallState(): Promise<InstallState> {
  try {
    const [user, site] = await Promise.all([
      db.query.users.findFirst({ columns: { id: true } }),
      db.query.sites.findFirst({ columns: { id: true } }),
    ]);

    const hasUsers = Boolean(user);
    const hasSites = Boolean(site);

    return {
      setupRequired: !hasUsers || !hasSites,
      dbReachable: true,
      hasUsers,
      hasSites,
    };
  } catch {
    return {
      setupRequired: true,
      dbReachable: false,
      hasUsers: false,
      hasSites: false,
    };
  }
}
