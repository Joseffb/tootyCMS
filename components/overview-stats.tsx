'use client';

import {
  Card,
  Metric,
  Text,
  AreaChart,
  BadgeDelta,
  Flex
} from '@tremor/react';
import { useEffect, useState, useMemo } from 'react';

type DailyRow   = { date: string; unique_visitors: number };
type MonthPoint = { Month: string; 'Total Visitors': number };

export default function OverviewStats() {
  const [daily, setDaily] = useState<DailyRow[]>([]);

  // 0️⃣ compute a stable key = current epoch seconds
  const [renderKey] = useState(() => Math.floor(Date.now() / 1000));

  // 1️⃣ Fetch YTD daily data on mount
  useEffect(() => {
    (async () => {
      const year     = new Date().getFullYear();
      const fromDate = `${year}-01-01`;
      const toDate   = new Date().toISOString().slice(0, 10);
      const qs       = new URLSearchParams({
        name:      'visitors_per_day',
        date_from: fromDate,
        date_to:   toDate,
        domain:    'all',          // all traffic (no domain filter)
      }).toString();

      const res = await fetch(`/api/tb-pipe?${qs}`, { cache: 'no-store' });
      if (!res.ok) {
        // In local debug, tb-pipe can intentionally return empty fallback data.
        setDaily([]);
        return;
      }
      const json = await res.json();
      setDaily(
        json.data.map((r: any) => ({
          date:             r.date,
          unique_visitors:  r.unique_visitors,
        }))
      );
    })();
  }, []);

  const sortedDaily = useMemo(
    () => [...daily].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    [daily],
  );

  // 2️⃣ Group by month with useMemo
  const monthly: MonthPoint[] = useMemo(() => {
    const sums: Record<string, number> = {};
    sortedDaily.forEach(({ date, unique_visitors }) => {
      const [y, m] = date.split('-');             // "YYYY","MM","DD"
      const key    = `${m}-${y.slice(2)}`;        // "MM-YY"
      sums[key]    = (sums[key] || 0) + unique_visitors;
    });

    // Turn into sorted array and format Month label
    return Object.entries(sums)
      .map(([mmYY, total]) => {
        const [mm, yy]     = mmYY.split('-');
        const monthNames   = [
          'Jan','Feb','Mar','Apr','May','Jun',
          'Jul','Aug','Sep','Oct','Nov','Dec'
        ];
        const label        = `${monthNames[Number(mm) - 1]} ${yy}`;
        return { Month: label, 'Total Visitors': total };
      })
      .sort(
        (a, b) =>
          Date.parse(`01 ${a.Month}`) - Date.parse(`01 ${b.Month}`)
      );
  }, [sortedDaily]);

  // 3️⃣ Compute last point & delta
  const lastValue = monthly.length
    ? monthly[monthly.length - 1]['Total Visitors']
    : 0;
  const prevValue = monthly.length > 1
    ? monthly[monthly.length - 2]['Total Visitors']
    : lastValue;
  const deltaPct = prevValue
    ? Math.round(((lastValue - prevValue) / prevValue) * 100 * 10) / 10
    : 0;

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <Card className="dark:!bg-stone-900">
        <Text>Total Visitors (YTD)</Text>
        <Flex
          className="space-x-3"
          justifyContent="start"
          alignItems="baseline"
        >
          <Metric className="font-cal">
            {lastValue.toLocaleString()}
          </Metric>
          <BadgeDelta
            deltaType={
              deltaPct >= 0 ? 'moderateIncrease' : 'moderateDecrease'
            }
            className="dark:bg-green-900 dark:bg-opacity-50 dark:text-green-400"
          >
            {Math.abs(deltaPct)} %
          </BadgeDelta>
        </Flex>

        {/* 4️⃣ Use our epoch-second key here */}
        <AreaChart
          key={renderKey}
          className="mt-6 h-28"
          data={sortedDaily.map(({ date, unique_visitors }) => ({
            date,                       // e.g. "2025-05-10"
            'Total Visitors': unique_visitors,
          }))}
          index="date"
          categories={['Total Visitors']}
          valueFormatter={(n) => n.toLocaleString()}
          showXAxis
          showYAxis={false}
          showGridLines={false}
          startEndOnly={sortedDaily.length > 1}
          showLegend={false}
        />
      </Card>
    </div>
  );
}
