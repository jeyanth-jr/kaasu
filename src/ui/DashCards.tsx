import { Link } from "react-router-dom";
import { STATUS_LABEL } from "../domain/goals";
import { useAccounts } from "./accounts";
import { Badge, Button, Card, IconTile, Money } from "./components";
import { ProgressRing, STATUS_TONE, goalIcon } from "./goalStyle";
import { IconChevron, IconLandmark, IconPlus, IconTarget } from "./icons";
import { useGoals } from "./useGoals";

export function BankBalancesCard() {
  const { accounts, balances, total } = useAccounts();
  const sorted = [...accounts].sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0));
  return (
    <Card
      title="Bank balances"
      icon={<IconLandmark size={15} />}
      action={
        <Link to="/accounts" className="flex items-center text-xs font-semibold text-accent">
          Accounts <IconChevron size={14} />
        </Link>
      }
    >
      {accounts.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">Add the accounts you use. Pick one on every spend and investment and each balance stays true.</p>
          <Link to="/accounts">
            <Button size="sm" variant="primary">
              <IconPlus size={14} /> Add an account
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-muted">Total</span>
            <Money p={total} className="display text-2xl font-extrabold" />
          </div>
          <ul className="flex flex-col gap-2.5">
            {sorted.slice(0, 4).map((a) => (
              <li key={a.id} className="flex items-center gap-3">
                <IconTile color="var(--c-cash)" className="h-9 w-9">
                  <IconLandmark size={16} />
                </IconTile>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{a.name}</span>
                <Money p={balances.get(a.id) ?? 0} className="text-sm font-bold" />
              </li>
            ))}
          </ul>
          {sorted.length > 4 && <p className="mt-2 text-xs text-faint">+ {sorted.length - 4} more</p>}
        </>
      )}
    </Card>
  );
}

export function GoalsCard() {
  const { active } = useGoals();
  return (
    <Card
      title="Goals"
      icon={<IconTarget size={15} />}
      action={
        <Link to="/goals" className="flex items-center text-xs font-semibold text-accent">
          All goals <IconChevron size={14} />
        </Link>
      }
    >
      {active.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">Saving for a trip, a phone or a home? Set a target and a date and see what to put aside each month.</p>
          <Link to="/goals?new=1">
            <Button size="sm" variant="primary">
              <IconPlus size={14} /> Set a goal
            </Button>
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {active.slice(0, 3).map(({ goal, progress: p }) => {
            const Icon = goalIcon(goal.icon);
            const color = goal.term === "short" ? "var(--c-debt)" : "var(--c-equity)";
            return (
              <li key={goal.id}>
                <Link to="/goals" className="flex items-center gap-3">
                  <ProgressRing fraction={p.fraction} size={46} stroke={5} color={color}>
                    <Icon size={15} style={{ color }} />
                  </ProgressRing>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{goal.name}</span>
                    <span className="block text-xs text-muted">
                      <Money p={p.saved} compact /> of <Money p={goal.target} compact />
                      {p.requiredMonthly !== null && p.monthsLeft ? (
                        <>
                          {" "}
                          · <Money p={p.requiredMonthly} compact />/mo
                        </>
                      ) : null}
                    </span>
                  </span>
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
