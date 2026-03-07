import SiteDomainDashboard from "./domain/page";

type Props = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SiteDashboard(props: Props) {
  return SiteDomainDashboard(props);
}
