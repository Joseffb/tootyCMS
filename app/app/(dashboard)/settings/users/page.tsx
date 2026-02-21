import Form from "@/components/form";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  createUserAdmin,
  deleteUserAdmin,
  editUser,
  listOauthProviderSettings,
  listUsersAdmin,
  updateOauthProviderSettings,
  updateUserAdmin,
} from "@/lib/actions";

export default async function UsersSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const users = await listUsersAdmin().catch(() => []);
  const oauthProviders = await listOauthProviderSettings().catch(() => []);

  async function createUserAdminAction(formData: FormData) {
    "use server";
    await createUserAdmin(formData);
  }

  async function updateUserAdminAction(formData: FormData) {
    "use server";
    await updateUserAdmin(formData);
  }

  async function deleteUserAdminAction(formData: FormData) {
    "use server";
    await deleteUserAdmin(formData);
  }

  return (
    <div className="flex flex-col space-y-8">
      <Form
        title="Name"
        description="Your display name."
        helpText="Use 32 characters maximum."
        inputAttrs={{
          name: "name",
          type: "text",
          defaultValue: session.user.name!,
          placeholder: "Your Name",
          maxLength: 32,
        }}
        handleSubmit={editUser}
      />
      <Form
        title="Email"
        description="Your account email."
        helpText="Use a valid email address."
        inputAttrs={{
          name: "email",
          type: "email",
          defaultValue: session.user.email!,
          placeholder: "email@domain.com",
        }}
        handleSubmit={editUser}
      />

      <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">OAuth Providers</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Enable or disable sign-in providers globally.
        </p>
        <form action={updateOauthProviderSettings} className="mt-4 space-y-3">
          {oauthProviders.map((provider: any) => (
            <label key={provider.id} className="flex items-center gap-3 text-sm dark:text-white">
              <input
                type="checkbox"
                name={provider.key}
                defaultChecked={provider.enabled}
                className="h-4 w-4"
              />
              <span className="capitalize">{provider.id}</span>
            </label>
          ))}
          <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
            Save OAuth Settings
          </button>
        </form>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white p-5 sm:p-8 dark:border-stone-700 dark:bg-black">
        <h2 className="font-cal text-xl dark:text-white">Users (Admin)</h2>
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
          Manage users and roles. First user should remain Administrator.
        </p>

        <form action={createUserAdminAction} className="mt-5 grid gap-3 md:grid-cols-5">
          <input
            name="name"
            placeholder="Name"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <input
            name="email"
            type="email"
            placeholder="email@domain.com"
            required
            className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <input
            name="gh_username"
            placeholder="github username"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          />
          <select
            name="role"
            defaultValue="author"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
          >
            <option value="administrator">Administrator</option>
            <option value="editor">Editor</option>
            <option value="author">Author</option>
            <option value="subscriber">Subscriber</option>
          </select>
          <button className="rounded-md border border-black bg-black px-3 py-2 text-sm text-white hover:bg-white hover:text-black">
            Add User
          </button>
        </form>

        <div className="mt-6 space-y-3">
          {users.map((user: any) => (
            <form
              key={user.id}
              action={updateUserAdminAction}
              className="grid gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-6 dark:border-stone-700"
            >
              <input type="hidden" name="id" value={user.id} />
              <input
                name="name"
                defaultValue={user.name ?? ""}
                placeholder="Name"
                className="rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
              />
              <input
                name="email"
                defaultValue={user.email}
                required
                className="rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
              />
              <input
                name="gh_username"
                defaultValue={user.gh_username ?? ""}
                placeholder="github"
                className="rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
              />
              <select
                name="role"
                defaultValue={user.role ?? "author"}
                className="rounded-md border border-stone-300 px-2 py-1 text-sm dark:border-stone-600 dark:bg-black dark:text-white"
              >
                <option value="administrator">Administrator</option>
                <option value="editor">Editor</option>
                <option value="author">Author</option>
                <option value="subscriber">Subscriber</option>
              </select>
              <button className="rounded-md border border-stone-700 px-3 py-1 text-sm dark:text-white">Save</button>
              <button
                formAction={deleteUserAdminAction}
                className="rounded-md border border-red-600 px-3 py-1 text-sm text-red-600"
              >
                Delete
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
