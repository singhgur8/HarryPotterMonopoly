import type { GameCard, GameState, PlayerState, PropertyColor, PendingAction, RoleType } from "@shared/schema";
import { SET_SIZES, RENT_TABLE, SET_STYLE, PROPERTY_COLORS } from "@shared/schema";
import { CARD_DEF_MAP, getEffectiveColor, roleDef } from "@shared/cardDefs";

export const COLORS = PROPERTY_COLORS as readonly PropertyColor[];
export const label = (c: PropertyColor) => SET_STYLE[c].label;
export const fillOf = (c: PropertyColor) => SET_STYLE[c].fill;
export const RAINBOW = `linear-gradient(135deg, ${COLORS.map((c, i) => `${SET_STYLE[c].fill} ${i * 10}% ${(i + 1) * 10}%`).join(", ")})`;

export const valueOf = (card: GameCard | string) => CARD_DEF_MAP[typeof card === "string" ? card : card.defId]?.value ?? 0;
export const sumValue = (cards: GameCard[]) => cards.reduce((s, c) => s + valueOf(c), 0);
export const nameOf = (defId: string) => CARD_DEF_MAP[defId]?.name ?? "Card";

/** A role's name and power, read from its role card. */
export function roleInfo(role?: string): { name: string; power: string } | undefined {
  const def = role ? roleDef(role as RoleType) : undefined;
  return def && { name: def.name, power: def.text ?? def.rolePower ?? "" };
}
export const roleName = (r?: string) => (r ? roleInfo(r)?.name ?? r : "");

/** Properties grouped by the colour they currently count as, in board order. */
export function groupSets(properties: GameCard[]): { color: PropertyColor; cards: GameCard[] }[] {
  const out: { color: PropertyColor; cards: GameCard[] }[] = [];
  for (const color of COLORS) {
    const cards = properties.filter(c => getEffectiveColor(c) === color);
    if (cards.length) out.push({ color, cards });
  }
  return out;
}

export const countOf = (p: PlayerState, c: PropertyColor) => p.properties.filter(x => getEffectiveColor(x) === c).length;
export const isComplete = (p: PlayerState, c: PropertyColor) => countOf(p, c) >= SET_SIZES[c];
export const completeSets = (p: PlayerState) => COLORS.filter(c => isComplete(p, c)).length;

export function rentFor(p: PlayerState, c: PropertyColor): number {
  const n = countOf(p, c);
  if (!n) return 0;
  const t = RENT_TABLE[c];
  return t[Math.min(n, t.length) - 1];
}

/** What rent becomes if one more card joins the set, e.g. "Red rent 3M → 6M". */
export function rentStep(p: PlayerState, c: PropertyColor): string {
  const n = countOf(p, c);
  if (n >= SET_SIZES[c]) return `${label(c)} is already complete`;
  return `${label(c)} rent ${n ? RENT_TABLE[c][n - 1] : 0}M → ${RENT_TABLE[c][n]}M`;
}

export const roleActive = (p: PlayerState | undefined, role: string) => !!p && p.role === role && !p.isSilenced;
export const shieldOf = (p: PlayerState) => (roleActive(p, "harry") ? p.protectedColor : undefined);

/** Mirrors the server's rule for Accio, Confundus and Reducto. */
export function canTake(attacker: PlayerState, target: PlayerState, card: GameCard): boolean {
  const c = getEffectiveColor(card);
  if (!c) return false;
  if (shieldOf(target) === c) return false;
  if (isComplete(target, c) && !roleActive(attacker, "draco")) return false;
  return true;
}

/** The colour a wild could flip to (or "rainbow" for Polyjuice). */
export function otherColor(card: GameCard): PropertyColor | "rainbow" | undefined {
  const def = CARD_DEF_MAP[card.defId];
  if (def?.type !== "wild") return undefined;
  if (def.wildColors === "rainbow") return "rainbow";
  const [a, b] = def.wildColors as PropertyColor[];
  return card.assignedColor === a ? b : a;
}

/** Background for a small tile: plain colour, two-colour stripes for a wild, rainbow for Polyjuice. */
export function tileFill(card: GameCard, color: PropertyColor, stripe = 4): string {
  const other = otherColor(card);
  if (other === "rainbow") return RAINBOW;
  if (other) return `repeating-linear-gradient(135deg, ${fillOf(color)} 0 ${stripe}px, ${fillOf(other)} ${stripe}px ${stripe * 2}px)`;
  return fillOf(color);
}

/** Cards a player is required to pay with (Harry's shielded colour is optional). */
export function payableCards(p: PlayerState): GameCard[] {
  const shield = shieldOf(p);
  return [...p.bank, ...p.properties.filter(c => !shield || getEffectiveColor(c) !== shield)];
}

export const playerName = (s: GameState, id?: string | null) => s.players.find(p => p.visitorId === id)?.animal.name ?? "Someone";

/** A plain sentence for what the game is waiting on, used in the turn panel. */
export function waitingText(s: GameState, meId: string): string {
  const p = s.pendingAction;
  const who = s.waitingOn === meId ? "you" : playerName(s, s.waitingOn);
  if (!p) return s.waitingOn === meId ? "Your move" : `Waiting on ${who} to play`;
  const card = p.cardDefId ? nameOf(p.cardDefId) : "";
  switch (p.type) {
    case "pay_rent": return `Waiting on ${who} to pay ${p.amount}M rent`;
    case "pay_birthday": return `Waiting on ${who} to pay 2M for It's My Birthday`;
    case "pay_debt": return `Waiting on ${who} to pay the Debt Collector 5M`;
    case "protego_response": return `Waiting on ${who} to decide on Just Say No`;
    case "harry_protect": return `Waiting on ${who} to pick a colour to shield`;
    case "cedric_draw_choice": return `Waiting on ${who} to choose where to draw from`;
    case "discard_excess": return `Waiting on ${who} to discard down to 7`;
    case "time_turner_play": return `Waiting on ${who} to pick a card with Rewind`;
    default: return `Waiting on ${who} to choose a target for ${card}`;
  }
}

/** Shared selection for paying: chips in the panel and cards on my table. */
export type PaySelection = { active: boolean; picked: string[]; toggle: (id: string) => void; set: (ids: string[]) => void };

export const isPayment = (p: PendingAction | null) => !!p && ["pay_rent", "pay_debt", "pay_birthday"].includes(p.type);

export function hasProtego(p: PlayerState) {
  return p.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");
}

export function drawCount(p: PlayerState) {
  if (p.hand.length === 0) return 5;
  return roleActive(p, "luna") ? 3 : 2;
}

export { SET_SIZES, RENT_TABLE, CARD_DEF_MAP, getEffectiveColor };

/** One line on what a card does, for cards seen outside your hand (discard pile, Cedric, Time-Turner). */
export function cardBlurb(defId: string): string {
  const def = CARD_DEF_MAP[defId];
  if (!def) return "";
  const both = (cs: PropertyColor[]) => cs.map(label).join(" or ");
  switch (def.type) {
    case "money": return `Money. Bank it for ${def.value}M.`;
    case "property": return `${label(def.color!)} property. ${SET_SIZES[def.color!]} make a full set.`;
    case "wild": return def.wildColors === "rainbow" ? "Wild property. Joins any colour." : `Wild property. Counts as ${both(def.wildColors as PropertyColor[])}.`;
    case "rent": return def.rentColors === "rainbow" ? "Rent. Charge everyone for any one of your sets." : `Rent. Charge everyone for ${both(def.rentColors as PropertyColor[])}.`;
    default: return def.text ?? "";
  }
}
