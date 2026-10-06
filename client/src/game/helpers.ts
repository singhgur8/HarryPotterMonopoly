import type { GameCard, GameState, PlayerState, PropertyColor, PendingAction } from "@shared/schema";
import { SET_SIZES, RENT_TABLE, SET_STYLE, PROPERTY_COLORS } from "@shared/schema";
import { CARD_DEF_MAP, getEffectiveColor } from "@shared/cardDefs";

export const COLORS = PROPERTY_COLORS as readonly PropertyColor[];
export const label = (c: PropertyColor) => SET_STYLE[c].label;
export const fillOf = (c: PropertyColor) => SET_STYLE[c].fill;
export const RAINBOW = `linear-gradient(135deg, ${COLORS.map((c, i) => `${SET_STYLE[c].fill} ${i * 10}% ${(i + 1) * 10}%`).join(", ")})`;

export const valueOf = (card: GameCard | string) => CARD_DEF_MAP[typeof card === "string" ? card : card.defId]?.value ?? 0;
export const sumValue = (cards: GameCard[]) => cards.reduce((s, c) => s + valueOf(c), 0);
export const nameOf = (defId: string) => CARD_DEF_MAP[defId]?.name ?? "Card";

export const ROLE_INFO: Record<string, { name: string; power: string }> = {
  harry: { name: "Harry Potter", power: "Shield one colour at the end of your turn. It can't be stolen or charged rent until your next turn." },
  hermione: { name: "Hermione Granger", power: "Play up to 4 actions a turn instead of 3." },
  draco: { name: "Draco Malfoy", power: "Accio, Confundus and Reducto can target complete sets." },
  cedric: { name: "Cedric Diggory", power: "Start your turn by drawing from the deck or taking the top 2 of the discard pile." },
  luna: { name: "Luna Lovegood", power: "Draw 3 cards at the start of your turn instead of 2." },
};
export const roleName = (r?: string) => (r ? ROLE_INFO[r]?.name ?? r : "");

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

/** What rent becomes if one more card joins the set, e.g. "Red rent 3G → 6G". */
export function rentStep(p: PlayerState, c: PropertyColor): string {
  const n = countOf(p, c);
  if (n >= SET_SIZES[c]) return `${label(c)} is already complete`;
  return `${label(c)} rent ${n ? RENT_TABLE[c][n - 1] : 0}G → ${RENT_TABLE[c][n]}G`;
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
    case "pay_rent": return `Waiting on ${who} to pay ${p.amount}G rent`;
    case "pay_birthday": return `Waiting on ${who} to pay 2G for the Yule Ball`;
    case "pay_debt": return `Waiting on ${who} to pay the Goblin 5G`;
    case "protego_response": return `Waiting on ${who} to decide on Protego`;
    case "harry_protect": return `Waiting on ${who} to pick a colour to shield`;
    case "cedric_draw_choice": return `Waiting on ${who} to choose where to draw from`;
    case "discard_excess": return `Waiting on ${who} to discard down to 7`;
    case "time_turner_play": return `Waiting on ${who} to pick a card with the Time-Turner`;
    default: return `Waiting on ${who} to choose a target for ${card}`;
  }
}

export const isPayment = (p: PendingAction | null) => !!p && ["pay_rent", "pay_debt", "pay_birthday"].includes(p.type);

export function hasProtego(p: PlayerState) {
  return p.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");
}

export function drawCount(p: PlayerState) {
  if (p.hand.length === 0) return 5;
  return roleActive(p, "luna") ? 3 : 2;
}

export { SET_SIZES, RENT_TABLE, CARD_DEF_MAP, getEffectiveColor };
