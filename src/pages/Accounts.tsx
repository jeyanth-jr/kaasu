import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { summarizeAccount } from "../domain/accounts";
import { daysBetween, formatDate, monthKey } from "../domain/dates";
import type { Instrument } from "../domain/types";
import { AccountDetailSheet, AccountKindBadge, AddAccountSheet, TransferSheet } from "../ui/AccountSheets";
import { useAccounts } from "../ui/accounts";
import { AnimatedMoney, Button, EmptyState, IconTile, Money, PageHeader } from "../ui/components";
import { CoinMark } from "../ui/Coin";
import { useData } from "../ui/data";
import { IconArrowIn, IconArrowOut, IconLandmark, IconPlus, IconTransfer } from "../ui/icons";

export function AccountsPage() {
  const { txns, cash, instrumentById, asOf } = useData();
  const { accounts, balances, total } = useAccounts();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [transfer, setTransfer] = useState<{ open: boolean; from?: string }>({ open: false });
  const [openId, setOpenId] = useState<string | null>(null);
  // The query only deep-links in (from search or the add menu); apply it, then clear it so a refresh doesn't reopen the sheet.
  useEffect(() => {
    if (params.size === 0) return;
    if (params.get("new") === "1") setAdding(true);
    if (params.get("transfer") === "1") setTransfer({ open: true });
    if (params.get("open")) setOpenId(params.get("open"));
    setParams({}, { replace: true });
  }, [params]);
  const month = monthKey(asOf);

  const summaries = useMemo(
    () => accounts.map((a) => summarizeAccount(a, { txns, cash, instrumentById }, month)).sort((x, y) => y.balance - x.balance),
    [accounts, txns, cash, instrumentById, month],
  );
  const open = openId ? (instrumentById.get(openId) ?? null) : null;
  const positive = summaries.reduce((s, x) => s + Math.max(0, x.balance), 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        sub="Every bank account and wallet, and every rupee that moved through it."
        action={
          <div className="flex gap-2">
            {accounts.length > 1 && (
              <Button onClick={() => setTransfer({ open: true })}>
                <IconTransfer size={16} /> Transfer
              </Button>
            )}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <IconPlus size={16} /> Add account
            </Button>
          </div>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<CoinMark size={52} />}
          title="Add your bank accounts"
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <IconPlus size={16} /> Add an account
            </Button>
          }
        >
          Track as many as you have. Pick the account on every spend, income and investment, and Kaasu keeps each balance true and shows where each rupee went.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="bg-hero rounded-[2rem] p-5 sm:p-7">
            <div className="text-sm font-semibold text-white/70">Total in bank</div>
            <AnimatedMoney p={total} className="display mt-1 block text-5xl font-extrabold sm:text-6xl" />
            <div className="mt-2 text-sm text-white/75">
              Across {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </div>
            {positive > 0 && summaries.length > 1 && (
              <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
                {summaries
                  .filter((s) => s.balance > 0)
                  .map((s, i) => (
                    <motion.div key={s.account.id} initial={{ width: 0 }} animate={{ width: `${(s.balance / positive) * 100}%` }} transition={{ duration: 0.7, delay: i * 0.05 }} className="h-full border-r border-black/20 last:border-0" style={{ background: SHADES[i % SHADES.length] }} />
                  ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {summaries.map((s, i) => (
              <motion.div
                key={s.account.id}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpenId(s.account.id))}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.985 }}
                onClick={() => setOpenId(s.account.id)}
                className="glass flex cursor-pointer flex-col gap-4 rounded-3xl p-4 text-left sm:p-5"
              >
                <div className="flex items-center gap-3">
                  <IconTile color={SHADES[i % SHADES.length]} className="h-11 w-11">
                    <IconLandmark size={20} />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{s.account.name}</div>
                    <AccountKindBadge account={s.account} />
                  </div>
                  <TransferChip account={s.account} onClick={() => setTransfer({ open: true, from: s.account.id })} show={accounts.length > 1} />
                </div>
                <Money p={balances.get(s.account.id) ?? s.balance} className="display text-3xl font-extrabold" />
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex items-center gap-1 text-gain">
                    <IconArrowIn size={13} /> <Money p={s.inMonth} compact /> in
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted">
                    <IconArrowOut size={13} /> <Money p={s.outMonth} compact /> out
                  </span>
                  <span className="text-faint">{s.lastDate ? (daysBetween(s.lastDate, asOf) <= 0 ? "Active today" : `Last ${formatDate(s.lastDate)}`) : "No activity"}</span>
                </div>
              </motion.div>
            ))}
          </div>
          <p className="text-center text-xs text-faint">This month in and out leave out transfers between your own accounts and balance corrections.</p>
        </div>
      )}

      <AddAccountSheet open={adding} onClose={() => setAdding(false)} />
      <TransferSheet open={transfer.open} fromId={transfer.from} onClose={() => setTransfer({ open: false })} />
      <AccountDetailSheet
        account={open}
        onClose={() => setOpenId(null)}
        onTransfer={(id) => {
          setOpenId(null);
          setTransfer({ open: true, from: id });
        }}
      />
    </>
  );
}

const SHADES = ["var(--c-equity)", "var(--c-debt)", "var(--c-gold)", "var(--c-cash)", "var(--c-other)"];

function TransferChip({ account, onClick, show }: { account: Instrument; onClick: () => void; show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Transfer from ${account.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          onClick();
        }
      }}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sunken text-muted transition hover:text-ink"
    >
      <IconTransfer size={16} />
    </span>
  );
}
