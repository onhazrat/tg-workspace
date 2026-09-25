import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { budgetRow, useMyQuota } from "@/hooks/useMyQuota"

/**
 * This account's own Request usage against its Budgets (ticket 24).
 *
 * The numbers behind the shell's banner, in the one place somebody goes to ask
 * "why is this slow" rather than being told. All three Budgets are rendered
 * even when two are untouched — the server sends three rows for that reason,
 * because a Budget that vanishes when idle reads as a bug rather than a zero.
 *
 * A Request is one page fetch from the Telegram web view, not one channel sync;
 * a sync is anywhere between one request and fifty, which is why the numbers
 * are larger than the channel counts next to them.
 */
export default function MyQuota() {
  const { data, isPending, isError } = useMyQuota()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request usage</CardTitle>
        <CardDescription>
          Page fetches from Telegram today, per budget. Past the allowance your
          work runs at low priority; past the limit it pauses until the daily
          reset at UTC midnight. An admin can raise either.
        </CardDescription>
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
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Budget</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead className="text-right">Allowance</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.budgets ?? []).map((budget) => {
                const row = budgetRow(budget)
                return (
                  <TableRow key={budget.budget}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.spent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.allowance}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ceiling}
                    </TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
