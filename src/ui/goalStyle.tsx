import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { GoalStatus } from "../domain/goals";
import { IconBike, IconCar, IconGem, IconGift, IconGraduation, IconHeart, IconHouse, IconLaptop, IconMountain, IconPalm, IconPhone, IconPlane, IconShield, IconTarget, IconBaby } from "./icons";

export const GOAL_ICONS: Record<string, LucideIcon> = {
  shield: IconShield,
  plane: IconPlane,
  laptop: IconLaptop,
  phone: IconPhone,
  ring: IconGem,
  car: IconCar,
  bike: IconBike,
  home: IconHouse,
  graduation: IconGraduation,
  palmtree: IconPalm,
  gift: IconGift,
  heart: IconHeart,
  baby: IconBaby,
  mountain: IconMountain,
  target: IconTarget,
};

export const goalIcon = (key: string): LucideIcon => GOAL_ICONS[key] ?? IconTarget;

export const STATUS_TONE: Record<GoalStatus, "gain" | "accent" | "warn" | "loss" | "neutral"> = {
  done: "gain",
  ahead: "gain",
  "on-track": "accent",
  behind: "warn",
  overdue: "loss",
  "no-date": "neutral",
};

/** Circular progress with content in the middle. */
export function ProgressRing({ fraction, size = 72, stroke = 7, color = "var(--accent)", children }: { fraction: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - f) }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
