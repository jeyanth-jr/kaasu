import type { LucideIcon } from "lucide-react";
import { categoryOf, type CategoryIconKey } from "../domain/cashflow";
import { KIND_STYLE } from "./planStyle";
import {
  IconBanknote,
  IconBook,
  IconBriefcase,
  IconBag,
  IconBus,
  IconCart,
  IconFilm,
  IconGift,
  IconHandshake,
  IconHouse,
  IconLandmark,
  IconParty,
  IconPill,
  IconPin,
  IconPlane,
  IconReceiptPlain,
  IconShield,
  IconTv,
  IconUndo,
  IconUsers,
  IconUtensils,
  IconZap,
} from "./icons";

const ICONS: Record<CategoryIconKey, LucideIcon> = {
  briefcase: IconBriefcase,
  party: IconParty,
  undo: IconUndo,
  banknote: IconBanknote,
  home: IconHouse,
  cart: IconCart,
  utensils: IconUtensils,
  bus: IconBus,
  zap: IconZap,
  tv: IconTv,
  bag: IconBag,
  pill: IconPill,
  film: IconFilm,
  plane: IconPlane,
  users: IconUsers,
  landmark: IconLandmark,
  book: IconBook,
  gift: IconGift,
  receipt: IconReceiptPlain,
};

/** A spending/income category's icon, drawn in the category colour. */
export function CategoryIcon({ id, size = 18, strokeWidth = 2.1 }: { id: string; size?: number; strokeWidth?: number }) {
  const c = categoryOf(id);
  const Icon = ICONS[c.icon];
  return <Icon size={size} strokeWidth={strokeWidth} style={{ color: c.color }} aria-hidden />;
}

export type CommitmentKind = "sip" | "rd" | "commitment" | "emi" | "emergency" | "other";

/** Icon for a payday-checklist line. */
export function CommitmentIcon({ kind, size = 18 }: { kind: CommitmentKind; size?: number }) {
  const map: Record<CommitmentKind, { Icon: LucideIcon; color: string }> = {
    sip: { Icon: KIND_STYLE.sip.icon, color: KIND_STYLE.sip.color },
    rd: { Icon: KIND_STYLE.rd.icon, color: KIND_STYLE.rd.color },
    commitment: { Icon: IconHandshake, color: KIND_STYLE.commitment.color },
    emi: { Icon: KIND_STYLE.emi.icon, color: KIND_STYLE.emi.color },
    emergency: { Icon: IconShield, color: "var(--gain)" },
    other: { Icon: IconPin, color: "var(--muted)" },
  };
  const { Icon, color } = map[kind];
  return <Icon size={size} style={{ color }} aria-hidden />;
}
