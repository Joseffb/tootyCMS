import Link from "next/link";

const highlights = [
  {
    title: "Fast Setup",
    body: "Launch a tenant-ready CMS in minutes, not weeks.",
    color: "from-yellow-200 to-orange-200",
  },
  {
    title: "Friendly Writing",
    body: "A comfy editor experience for blogs, docs, and launch updates.",
    color: "from-pink-200 to-rose-200",
  },
  {
    title: "One Dashboard",
    body: "Manage sites, posts, and settings from one clean workspace.",
    color: "from-sky-200 to-cyan-200",
  },
];

const starterIdeas = [
  "Personal blog",
  "Small business site",
  "Community updates hub",
  "Product docs portal",
  "Course content site",
  "Agency client microsites",
];

const featureGrid = [
  {
    title: "Multi-site, one login",
    body: "Run multiple sites from one dashboard with role-aware access.",
  },
  {
    title: "OAuth-first auth",
    body: "GitHub, Google, Facebook, and Apple support with admin controls.",
  },
  {
    title: "Publisher workflow",
    body: "Draft, publish, and update quickly with a clean writing interface.",
  },
  {
    title: "Analytics-ready",
    body: "Tinybird hooks built in, plus graceful local fallback in debug mode.",
  },
  {
    title: "Storage options",
    body: "Use Vercel Blob, S3 fallback, or no-image mode for lightweight installs.",
  },
  {
    title: "Fast launch path",
    body: "Create your first site automatically and start shipping content immediately.",
  },
];

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#fff8dc_0%,#ffe4ec_35%,#e0f2ff_70%,#f8fff1_100%)] text-stone-900">
      <div className="pointer-events-none absolute -left-16 top-16 h-56 w-56 rounded-full bg-yellow-300/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-24 h-72 w-72 rounded-full bg-pink-300/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-cyan-300/30 blur-3xl" />

      <div className="relative mx-auto flex w-full max-w-6xl flex-col px-6 pb-14 pt-8 sm:px-10">
        <header className="mb-14 flex flex-wrap items-center justify-between gap-4">
          <Link href="/home" className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-semibold shadow-sm ring-1 ring-white/80 backdrop-blur">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-yellow-300 text-xs">
              T
            </span>
            Tooty CMS
          </Link>
          <nav className="flex items-center gap-2 text-sm sm:gap-3">
            <Link href="/c/documentation" className="rounded-full bg-white/80 px-4 py-2 font-medium hover:bg-white">
              Documentation
            </Link>
            <Link href="/app/login" className="rounded-full bg-stone-900 px-4 py-2 font-semibold text-white hover:bg-stone-700">
              Login
            </Link>
          </nav>
        </header>

        <section className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <p className="mb-3 inline-block rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Happy Publishing
            </p>
            <p className="mb-4 w-fit rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200">
              Mascot: Tooty the Toucan
            </p>
            <h1 className="text-balance text-4xl font-black leading-tight sm:text-5xl md:text-6xl">
              A joyful CMS for people who just want to publish.
            </h1>
            <p className="mt-5 max-w-xl text-base text-stone-700 sm:text-lg">
              Tooty keeps things light: clean workflows, colorful energy, and fewer
              setup headaches. Build once, run many sites, and keep your team smiling.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/app/login" className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600">
                Start Dashboard
              </Link>
              <Link href="/app/sites" className="rounded-xl bg-white/90 px-5 py-3 text-sm font-semibold text-stone-900 ring-1 ring-stone-200 transition hover:bg-white">
                Explore Sites
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl backdrop-blur sm:p-7">
            <p className="mb-3 text-sm font-semibold text-stone-500">Perfect For</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {starterIdeas.map((item) => (
                <li key={item} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-stone-700 ring-1 ring-stone-100">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-3">
          {highlights.map((card) => (
            <article key={card.title} className={`rounded-2xl bg-gradient-to-br ${card.color} p-5 shadow-sm ring-1 ring-white/60`}>
              <h2 className="text-lg font-bold">{card.title}</h2>
              <p className="mt-2 text-sm text-stone-700">{card.body}</p>
            </article>
          ))}
        </section>

        <section className="mt-14 rounded-3xl border border-white/70 bg-white/70 p-6 shadow-lg backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                Why Tooty
              </p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">
                Built for small teams that move fast
              </h2>
            </div>
            <Link
              href="/app/login"
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700"
            >
              Get Started
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {featureGrid.map((item) => (
              <article
                key={item.title}
                className="rounded-xl bg-white p-4 ring-1 ring-stone-100"
              >
                <h3 className="text-sm font-bold text-stone-900">{item.title}</h3>
                <p className="mt-1 text-sm text-stone-600">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
