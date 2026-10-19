import type { LucideIcon } from "lucide-react";
import type { LoanKind } from "../domain/types";
import type { ScheduleKind } from "../domain/obligations";
import { IconBag, IconBike, IconCar, IconCard, IconGem, IconGraduation, IconHandshake, IconHouse, IconLandmark, IconPiggy, IconTrendUp, IconUser } from "./icons";

type IconC = LucideIcon;

/** Icon, colour and label for each kind of monthly plan. Colours come from the theme tokens. */
export const KIND_STYLE: Record<ScheduleKind, { icon: IconC; color: string; label: string; chart: string }> = {
  sip: { icon: IconTrendUp, color: "var(--c-equity)", chart: "var(--c-equity)", label: "SIP" },
  rd: { icon: IconPiggy, color: "var(--c-debt)", chart: "var(--c-debt)", label: "RD" },
  chit: { icon: IconGem, color: "var(--c-gold)", chart: "var(--c-gold)", label: "Gold chit" },
  commitment: { icon: IconHandshake, color: "var(--c-other)", chart: "var(--c-other)", label: "Commitment" },
  emi: { icon: IconLandmark, color: "var(--loss)", chart: "var(--loss)", label: "EMI" },
};

export const LOAN_ICON: Record<LoanKind, IconC> = {
  home: IconHouse,
  car: IconCar,
  bike: IconBike,
  personal: IconUser,
  education: IconGraduation,
  gold: IconGem,
  card: IconCard,
  consumer: IconBag,
  other: IconLandmark,
};
