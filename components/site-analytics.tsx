'use client';

import {
  Card,
  Title,
  AreaChart,
  BarList,
  Flex,
  Grid,
  Text,
  Bold,
} from '@tremor/react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

/* ---------- Types that match analytics query output ---------- */
type SparkRow = { date: string; total_pageviews: number };
type PageRow  = { page: string;   visitors: number };
type RefRow   = { source: string; visitors: number };
type CtryRow  = { country: string; visitors: number };
type DvcRow  = { device: string; visitors: number };
type ListRow  = { name: string; value: number; code?: string };

/* ---------- helpers ---------- */
function stripPort(host: string) {
  return host.replace(/:\d+$/, '');
}

async function fetchPipe<T>(pipe: string, domain: string, siteId?: string): Promise<T | null> {
  const qs = new URLSearchParams({
    name:   pipe,
    domain: stripPort(domain),
    ...(siteId ? { siteId } : {}),
  }).toString();

  const res = await fetch(`/api/analytics/query?${qs}`);
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  if (!res.ok || !contentType.includes("application/json")) {
    if (process.env.NEXT_PUBLIC_DEBUG_MODE === "1" || process.env.NEXT_PUBLIC_DEBUG_MODE === "true") {
      console.warn('[analytics query]', pipe, await res.text());
    }
    return null;
  }
  try {
    return (await res.json()).data as T;
  } catch {
    return null;
  }
}

function toBar(rows: any[], key: 'page' | 'source' | 'country' | 'device'): ListRow[] {
  return rows.map(r => ({
    name:  r[key]   ?? '(unknown)',
    value: r.visitors ?? r.hits ?? 0,
    code:  key === 'country' ? r.country : undefined,
  }));
}

/* ---------- component ---------- */
interface Props { domain: string; siteId?: string }        // e.g. "lexia.example.com"

export default function SiteAnalyticsCharts({ domain, siteId }: Props) {
  const d = stripPort(domain);            // normalised once

  const [spark, setSpark] = useState<SparkRow[]>([]);
  const [pages, setPages] = useState<ListRow[]>([]);
  const [refs,  setRefs]  = useState<ListRow[]>([]);
  const [ctrs,  setCtrs]  = useState<ListRow[]>([]);
  const [dvc,  setDvc]  = useState<ListRow[]>([]);

  useEffect(() => {
    (async () => {
      const s = await fetchPipe<SparkRow[]>('visitors_per_day', d, siteId);
      if (s) setSpark(s);

      const p = await fetchPipe<PageRow[]> ('top_pages',      d, siteId);
      if (p) setPages(toBar(p, 'page'));

      const r = await fetchPipe<RefRow[]>  ('top_sources',  d, siteId);
      if (r) setRefs(toBar(r, 'source'));

      const c = await fetchPipe<CtryRow[]> ('top_locations',      d, siteId);
      if (c) setCtrs(toBar(c, 'country'));

      const de = await fetchPipe<DvcRow[]> ('top_devices',      d, siteId);
      if (de) setDvc(toBar(de, 'device'));
    })();
  }, [d, siteId]);

  const sortedSpark = [...spark].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );

  const sections = [
    { title: 'Top Pages',     subtitle: 'Page',    data: pages },
    { title: 'Top Sources', subtitle: 'Source',  data: refs  },
    { title: 'Countries',     subtitle: 'Country', data: ctrs  },
    { title: 'Top Devices',     subtitle: 'Devices', data: dvc  },
  ] as const;

  return (
    <div className="grid gap-6">
      {/* Sparkline */}
      <Card>
        <Title>Visitors</Title>
        <AreaChart
          className="mt-4 h-72"
          data={sortedSpark.map(({ date, total_pageviews }) => ({
            date,
            Pageviews: total_pageviews,
          }))}
          index="date"
          categories={['Pageviews']}
          colors={['indigo']}
          valueFormatter={n => Intl.NumberFormat('en-US').format(n)}
        />
      </Card>

      {/* Bar-lists */}
      <Grid numItemsSm={2} numItemsLg={3} className="gap-6">
        {sections.map(({ title, subtitle, data }) => (
          <Card key={title} className="max-w-lg">
            <Title>{title}</Title>

            <Flex className="mt-4">
              <Text><Bold>{subtitle}</Bold></Text>
              <Text><Bold>Visitors</Bold></Text>
            </Flex>

            <BarList
              data={data.map(({ name, value, code }) => ({
                name,
                value,
                icon:
                  title === 'Top Sources'
                    ? () => (
                      <Image
                        src={`https://www.google.com/s2/favicons?sz=64&domain_url=${name}`}
                        alt={name}
                        width={20}
                        height={20}
                        className="mr-2.5"
                      />
                    )
                    : title === 'Countries'
                      ? () => (
                        <Image
                          src={`https://flag.vercel.app/m/${code}.svg`}
                          alt={code as string}
                          width={24}
                          height={16}
                          className="mr-2.5"
                        />
                      )
                      : undefined,
              }))}
              className="mt-2"
            />
          </Card>
        ))}
      </Grid>
    </div>
  );
}
