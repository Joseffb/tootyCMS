import { notFound } from "next/navigation";

type Params = Promise<{ domain: string; slug: string }>;

export default async function CategoryArchivePage({ params }: { params: Params }) {
  await params;
  notFound();
}
