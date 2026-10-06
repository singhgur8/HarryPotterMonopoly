import type { PropertyColor, GameCard } from "@shared/schema";
import { SET_STYLE } from "@shared/schema";
import { CARD_DEF_MAP } from "@shared/cardDefs";

// Set labels and colours, shared with the card frame so dots and chips match the cards
export const COLOR_MAP: Record<PropertyColor, { label: string; fill: string; on: string }> = SET_STYLE;

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
    // Group copies of the same card (same denomination)
    const key = def ? `${def.type}:${def.name}` : card.defId;
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
