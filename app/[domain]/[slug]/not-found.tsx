import { getSiteData } from "@/lib/fetchers";
import { headers } from "next/headers";
import Image from "next/image";

export default async function NotFound() {
  const headersList = await headers();
  const domain = headersList
    .get("host")
    ?.replace(".localhost:3000", `.${process.env.NEXT_PUBLIC_ROOT_DOMAIN}`);
  const data = await getSiteData(domain as string);

  return (
    <main className="tooty-archive-shell flex min-h-screen items-center justify-center px-5 py-12">
      <section className="tooty-archive-card w-full max-w-2xl rounded-2xl border p-8 text-center">
        <h1 className="tooty-post-title font-cal text-4xl">{data ? `${data.name}: ` : ""}404</h1>
        <div className="mx-auto mt-4 w-fit overflow-hidden rounded-xl">
          <Image
            alt="missing site"
            src="https://illustrations.popsy.co/gray/timed-out-error.svg"
            width={360}
            height={360}
          />
        </div>
        <p className="tooty-post-description mt-4 text-lg">
          {data
            ? data.message404
            : "Blimey! You've found a page that doesn't exist."}
        </p>
      </section>
    </main>
  );
}
