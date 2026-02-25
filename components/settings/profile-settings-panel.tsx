import { getProfile, updateOwnPassword, updateProfile } from "@/lib/actions";

export default async function ProfileSettingsPanel(props: { siteId?: string; forcePasswordChange?: boolean }) {
  const data = await getProfile(props.siteId);

  async function updateProfileAction(formData: FormData) {
    "use server";
    await updateProfile(formData);
  }

  async function updateOwnPasswordAction(formData: FormData) {
    "use server";
    await updateOwnPassword(formData);
  }

  return (
    <div className="space-y-6">
      {props.forcePasswordChange ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Password reset is required before continuing. Set a new password below.
        </div>
      ) : null}

      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Profile</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Global user identity. This applies across all sites.
        </p>
        <form action={updateProfileAction} className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Name</label>
            <input
              name="name"
              defaultValue={data.user.name}
              placeholder="Your Name"
              maxLength={64}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Email</label>
            <input
              name="email"
              type="email"
              required
              defaultValue={data.user.email}
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </div>
          <div className="md:col-span-2">
            <button className="rounded-md border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black">
              Save Profile
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Authentication Providers</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Native password plus enabled OAuth providers linked to this account.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-stone-200 p-3 dark:border-stone-700">
            <p className="text-sm font-medium dark:text-white">Native</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              {data.authProviders.native.linked ? "Linked" : "Not set"}
            </p>
          </div>
          {data.authProviders.available.map((provider) => (
            <div key={provider.id} className="rounded-md border border-stone-200 p-3 dark:border-stone-700">
              <p className="text-sm font-medium capitalize dark:text-white">{provider.id}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {provider.enabled ? (provider.linked ? "Enabled + linked" : "Enabled (not linked)") : "Disabled globally"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Password</h2>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Update your native password. Minimum length is 8 characters.
        </p>
        <form action={updateOwnPasswordAction} className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">New password</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">Confirm password</label>
            <input
              name="confirmPassword"
              type="password"
              required
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
            />
          </div>
          <div className="md:col-span-2">
            <button className="rounded-md border border-black bg-black px-4 py-2 text-sm text-white hover:bg-white hover:text-black">
              Update Password
            </button>
          </div>
        </form>
      </div>

      {data.extensionSections.map((section) => (
        <div key={section.id} className="rounded-lg border border-stone-200 bg-white p-5 dark:border-stone-700 dark:bg-black">
          <h2 className="font-cal text-xl dark:text-white">{section.title}</h2>
          {section.description ? (
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">{section.description}</p>
          ) : null}
          <div className="mt-4 space-y-2">
            {(section.rows || []).map((row, index) => (
              <div key={`${section.id}-${index}`} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
                <span className="text-stone-500 dark:text-stone-400">{row.label}</span>
                <span className="font-medium dark:text-white">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
