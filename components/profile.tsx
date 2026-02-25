import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import LogoutButton from "./logout-button";
import packageJson from "@/package.json";

export default async function Profile() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  const appVersion = String(packageJson.version || "").trim() || "dev";

  return (
    <div className="w-full">
      <div className="flex w-full items-center justify-between">
        <Link
          href="/profile"
          className="flex w-full flex-1 items-center space-x-3 rounded-lg px-2 py-1.5 transition-all duration-150 ease-in-out hover:bg-stone-200 active:bg-stone-300 dark:text-white dark:hover:bg-stone-700 dark:active:bg-stone-800"
        >
          <Image
            src={
              session.user.image ??
              `https://avatar.vercel.sh/${session.user.email}`
            }
            width={40}
            height={40}
            alt={session.user.name ?? "User avatar"}
            className="h-6 w-6 rounded-full"
          />
          <span className="truncate text-sm font-medium">
            {session.user.name}
          </span>
        </Link>
        <LogoutButton />
      </div>
      <p className="px-2 pt-1 text-right text-[11px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400">
        Version {appVersion}
      </p>
    </div>
  );
}
