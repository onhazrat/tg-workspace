import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { quotaReadQuotaUsage } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queryKeys } from "@/hooks/queryKeys"

/**
 * Per-account Request usage for one UTC day (ticket 08).
 *
 * Observation only — nothing here is a limit, and the ledger it reads is what
 * tickets 23 and 24 will set limits *from*. A Request is one page fetch from
 * the Telegram web view, not one channel sync, so the numbers are large and
 * comparable across accounts with very different channel counts.
 *
 * The day comes from the URL-free local state rather than a route param
 * because it is a transient lookback, not a place: an Admin checking yesterday
 * does not want that in their history or their bookmarks.
 */

/** Today in UTC, matching the ledger's day boundary rather than the browser's. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function QuotaUsage() {
  const [day, setDay] = useState(todayUtc)

  // Clearing the date input sets `day` to "", which would go out as `?day=`
  // and come back 422 against `date | None` — the card would then read "could
  // not be loaded" for what is really an empty field. An empty box means today,
  // which is what omitting the parameter means to the endpoint.
  const requestedDay = day || undefined

  const { data, isPending, isError } = useQuery({
    queryKey: queryKeys.quotaUsage(day),
    queryFn: () => quotaReadQuotaUsage({ query: { day: requestedDay } }),
  })

  const entries = data?.entries ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request usage</CardTitle>
        <CardDescription>
          Page fetches from Telegram, per account and Budget, for one UTC day.
          Nothing is throttled — this is measurement.
        </CardDescription>
        <div className="pt-2">
          <Input
            type="date"
            aria-label="Usage day"
            className="w-40"
            value={day}
            max={todayUtc()}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <p className="text-muted-foreground text-sm">
            Usage could not be loaded.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Requests were made on {data?.day ?? day}.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Auto sync</TableHead>
                <TableHead className="text-right">Manual bulk</TableHead>
                <TableHead className="text-right">Manual single</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Sorted by total: the reason to open this page is "who is
                  using the most", and the server returns ledger order. */}
              {[...entries]
                .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
                .map((entry) => (
                  <TableRow key={entry.userId}>
                    <TableCell className="font-medium">{entry.email}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.autoSync ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.manualBulk ?? 0}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.manualSingle ?? 0}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {entry.total ?? 0}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
