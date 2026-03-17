import type { PropertyColor, GameCard } from "@shared/schema";
import { CARD_DEF_MAP } from "@shared/cardDefs";

// Color display names and CSS classes
export const COLOR_MAP: Record<PropertyColor, { label: string; bg: string; text: string; border: string }> = {
  brown:      { label: "Brown",       bg: "bg-amber-800",    text: "text-amber-800",    border: "border-amber-800" },
  light_blue: { label: "Light Blue",  bg: "bg-sky-400",      text: "text-sky-400",      border: "border-sky-400" },
  pink:       { label: "Pink",        bg: "bg-pink-400",     text: "text-pink-400",     border: "border-pink-400" },
  orange:     { label: "Orange",      bg: "bg-orange-400",   text: "text-orange-400",   border: "border-orange-400" },
  red:        { label: "Red",         bg: "bg-red-500",      text: "text-red-500",      border: "border-red-500" },
  yellow:     { label: "Yellow",      bg: "bg-yellow-400",   text: "text-yellow-400",   border: "border-yellow-400" },
  green:      { label: "Green",       bg: "bg-emerald-500",  text: "text-emerald-500",  border: "border-emerald-500" },
  dark_blue:  { label: "Dark Blue",   bg: "bg-blue-700",     text: "text-blue-700",     border: "border-blue-700" },
  transport:  { label: "Transport",   bg: "bg-gray-800",     text: "text-gray-300",     border: "border-gray-600" },
  utility:    { label: "Utility",     bg: "bg-violet-500",   text: "text-violet-400",   border: "border-violet-500" },
};

export function getCardImage(defId: string): string {
  if (defId === "__hidden__") return "";
  const def = CARD_DEF_MAP[defId];
  return def ? `/cards/${def.image}` : "";
}

export function getCardName(defId: string): string {
  if (defId === "__hidden__") return "Hidden";
  const def = CARD_DEF_MAP[defId];
  return def?.name ?? "Unknown";
}

export function getCardDef(defId: string) {
  return CARD_DEF_MAP[defId];
}

// Group properties by color for display
export function groupPropertiesByColor(properties: GameCard[]): Map<PropertyColor, GameCard[]> {
  const groups = new Map<PropertyColor, GameCard[]>();
  for (const card of properties) {
    const def = CARD_DEF_MAP[card.defId];
    const color = card.assignedColor || def?.color;
    if (color) {
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color)!.push(card);
    }
  }
  return groups;
}

// Group bank cards by value (for stacking)
export function groupBankCards(bank: GameCard[]): { defId: string; count: number; value: number }[] {
  const groups = new Map<string, { defId: string; count: number; value: number }>();
  for (const card of bank) {
    const def = CARD_DEF_MAP[card.defId];
    // Group by image (same denomination)
    const key = def?.image || card.defId;
    if (groups.has(key)) {
      groups.get(key)!.count++;
    } else {
      groups.set(key, { defId: card.defId, count: 1, value: def?.value ?? 0 });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.value - b.value);
}

// Get total bank value
export function totalBankValue(bank: GameCard[]): number {
  return bank.reduce((sum, c) => sum + (CARD_DEF_MAP[c.defId]?.value ?? 0), 0);
}
