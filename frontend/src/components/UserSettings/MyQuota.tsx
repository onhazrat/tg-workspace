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
import { budgetLabel, useMyQuota } from "@/hooks/useMyQuota"

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
function limitText(value: number | null | undefined): string {
  // `null` is unlimited on the wire — a negative setting resolved. Zero is a
  // real limit, so it must not be rendered as "no limit"; that distinction is
  // exactly what decision 18 turns on.
  return value === null || value === undefined ? "no limit" : String(value)
}

const STATUS_TEXT: Record<string, string> = {
  normal: "Normal priority",
  degraded: "Low priority",
  blocked: "Paused until UTC midnight",
}

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
              {(data?.budgets ?? []).map((budget) => (
                <TableRow key={budget.budget}>
                  <TableCell className="font-medium">
                    {budgetLabel(budget.budget)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {budget.spent ?? 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {limitText(budget.allowance)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {limitText(budget.ceiling)}
                  </TableCell>
                  <TableCell>
                    {STATUS_TEXT[budget.status ?? "normal"] ?? budget.status}
                    {budget.lifted ? " (limit lifted today)" : ""}
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
