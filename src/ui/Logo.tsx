import { cx } from "./components";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <span className="grid h-9 w-9 place-items-center rounded-2xl bg-hero text-lg font-black shadow-card">₹</span>
      <span className="display text-2xl font-extrabold">kaasu</span>
    </div>
  );
}
