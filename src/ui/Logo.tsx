import { CoinMark } from "./Coin";
import { cx } from "./components";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("group flex items-center gap-2.5", className)}>
      <span className="transition-transform duration-500 group-hover:rotate-[360deg]">
        <CoinMark size={36} />
      </span>
      <span className="display text-2xl font-extrabold">kaasu</span>
    </div>
  );
}
