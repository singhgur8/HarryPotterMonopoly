/**
 * Versions of the game the host can pick in the lobby. Each one names the
 * roles dealt to players and the cards in its draw pile. Custom is built from
 * the host's own picks (CustomRules) instead of a fixed list.
 *
 * To add a role to a variation: add its id to RoleType in schema.ts, add its
 * role card (role_<id>) to cardDefs.ts, then list it in `roles` below. Its
 * power, if it has one, goes in worker/gameEngine.ts behind roleActive().
 * Every role card is offered in Custom games automatically.
 *
 * To add a card to a variation: define it in cardDefs.ts with a new id, then
 * add that id to the variation's `deck`. One id is one copy of the card.
 * Every action card is offered in Custom games automatically.
 *
 * To add a variation: add its id to VariationId in schema.ts and an entry here.
 */
import type { ActionType, CustomRules, GameRules, RoleType, TemplateId, VariationId } from "./schema";
import { ALL_CARD_DEFS, CLASSIC_DECK, COPY_IDS, MAX_COPIES, MONOPOLY_DEAL_DECK, PRIME_DECK, PRIME_EXTRA_COPIES, copyKey } from "./cardDefs";

export interface Variation {
  id: VariationId;
  name: string;
  description: string; // one line, shown in the lobby
  roles: RoleType[];   // dealt at random; repeats when there are more players than roles
  deck: string[];      // card ids in the draw pile
  rules?: GameRules;   // rule switches; none means the Harry Potter rules
}

// ---------- Custom games ----------

/** Every role there is, in card order. */
export const ALL_ROLES: RoleType[] = ALL_CARD_DEFS.filter(d => d.type === "role").map(d => d.roleType!);

/** Every action card a Custom game can include, by action. */
export const ACTION_CHOICES: { type: ActionType; name: string; text: string }[] = [];
for (const d of ALL_CARD_DEFS) {
  if (d.type === "action" && !ACTION_CHOICES.some(a => a.type === d.actionType)) {
    ACTION_CHOICES.push({ type: d.actionType!, name: d.name, text: d.text ?? "" });
  }
}

/** Money cards a Custom game can include, by value (copyKey money_<value>). */
export const MONEY_CHOICES: number[] = Array.from(new Set(ALL_CARD_DEFS.filter(d => d.type === "money").map(d => d.value))).sort((a, b) => a - b);

export const MIN_SETS_TO_WIN = 1;
export const MAX_SETS_TO_WIN = 6;
export const DEFAULT_SETS_TO_WIN = 3;

/** Versions a Custom game can start from. */
export const isTemplateId = (v: unknown): v is TemplateId => isVariationId(v) && v !== "custom";

/** How many copies of each action and money card a deck has. */
function countsIn(deck: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(Object.keys(COPY_IDS).map(k => [k, 0]));
  for (const id of deck) {
    const key = copyKey(id);
    if (key) counts[key]++;
  }
  return counts;
}

/** Custom rules that play exactly like another version, for the host to change from there. */
export function customFrom(id: TemplateId): CustomRules {
  const v = VARIATIONS[id];
  return {
    template: id,
    roles: [...v.roles],
    roleMode: "random",
    rolesPerPlayer: 1,
    counts: countsIn(v.deck),
    setsToWin: v.rules?.setsToWin ?? DEFAULT_SETS_TO_WIN,
  };
}

/**
 * The template's properties, wilds and rent cards, plus the chosen number of
 * each action and money card.
 */
export function customDeck(rules: CustomRules): string[] {
  const base = VARIATIONS[rules.template].deck.filter(id => !copyKey(id));
  const counted = Object.entries(rules.counts).flatMap(([key, n]) => (COPY_IDS[key] ?? []).slice(0, n));
  return [...base, ...counted];
}

/**
 * Apply a host's changes to Custom rules, ignoring anything invalid. Fields
 * left out of `change` keep their current value. `useTemplate` starts over
 * from that version before the other changes.
 */
export function updateCustomRules(current: CustomRules, change: Record<string, unknown>): CustomRules {
  let next: CustomRules = { ...current, counts: { ...current.counts } };
  if (isTemplateId(change.useTemplate)) next = customFrom(change.useTemplate);
  if (isTemplateId(change.template)) next.template = change.template;
  if (Array.isArray(change.roles)) next.roles = ALL_ROLES.filter(r => (change.roles as unknown[]).includes(r));
  // Saves from before card counts listed the action cards in play, every copy of each
  if (Array.isArray(change.actions) && !change.counts) {
    const full = countsIn(ALL_CARD_DEFS.filter(d => d.type === "action" && !PRIME_EXTRA_COPIES.includes(d.id)).map(d => d.id));
    for (const a of ACTION_CHOICES) next.counts[a.type] = (change.actions as unknown[]).includes(a.type) ? full[a.type] : 0;
  }
  if (change.counts && typeof change.counts === "object") {
    for (const [key, n] of Object.entries(change.counts as Record<string, unknown>)) {
      if (key in COPY_IDS && typeof n === "number" && Number.isFinite(n)) next.counts[key] = Math.max(0, Math.min(MAX_COPIES, Math.round(n)));
    }
  }
  if (change.roleMode === "random" || change.roleMode === "choose") next.roleMode = change.roleMode;
  if (typeof change.rolesPerPlayer === "number" && Number.isFinite(change.rolesPerPlayer)) next.rolesPerPlayer = Math.round(change.rolesPerPlayer);
  next.rolesPerPlayer = Math.max(1, Math.min(next.rolesPerPlayer, Math.max(1, next.roles.length)));
  if (typeof change.setsToWin === "number" && Number.isFinite(change.setsToWin)) next.setsToWin = Math.round(change.setsToWin);
  next.setsToWin = Math.max(MIN_SETS_TO_WIN, Math.min(MAX_SETS_TO_WIN, next.setsToWin || DEFAULT_SETS_TO_WIN));
  return next;
}

// ---------- The variations ----------

export const VARIATIONS: Record<VariationId, Variation> = {
  deal: {
    id: "deal",
    name: "Classic Monopoly Deal",
    description: "The real card game: no roles, Double the Rent, and Wild Rent charges one player.",
    roles: [],
    deck: MONOPOLY_DEAL_DECK,
    rules: { wildRentOneTarget: true },
  },
  prime: {
    id: "prime",
    name: "Prime",
    description: "Monopoly Deal plus 19 Prime cards: Hand 7, Hand Steal, Chargeback, Reverse, Destroy and Bank Robber.",
    roles: [],
    deck: PRIME_DECK,
    rules: { wildRentOneTarget: true },
  },
  classic: {
    id: "classic",
    name: "Classic Harry Potter",
    description: "The original deck with five Hogwarts roles.",
    roles: ["harry", "hermione", "draco", "cedric", "luna"],
    deck: CLASSIC_DECK,
  },
  gg: {
    id: "gg",
    name: "GG",
    description: "New roles, with more on the way.",
    roles: ["ganda", "lucha", "gandu", "tharki", "kanjar"],
    deck: [...CLASSIC_DECK],
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "Start from any version, then change the roles, card counts and how many sets win.",
    roles: [],
    deck: [], // built from the host's picks by customDeck()
  },
};

/** A new Custom game starts as Classic Harry Potter. */
export const DEFAULT_CUSTOM_RULES: CustomRules = customFrom("classic");

export const DEFAULT_VARIATION: VariationId = "classic";
export const VARIATION_IDS = Object.keys(VARIATIONS) as VariationId[];

export const isVariationId = (v: unknown): v is VariationId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(VARIATIONS, v);

/** The variation a game or room is using; older saves have none and are classic. */
export const variationOf = (id?: string): Variation =>
  isVariationId(id) ? VARIATIONS[id] : VARIATIONS[DEFAULT_VARIATION];

/** Everything the engine needs to deal a game. */
export interface GameSetup {
  variation: VariationId;
  deck: string[];
  roles: RoleType[];
  roleMode: "random" | "choose";
  rolesPerPlayer: number;
  rules: GameRules;
}

export function gameSetup(id?: VariationId, custom: CustomRules = DEFAULT_CUSTOM_RULES): GameSetup {
  const v = variationOf(id);
  if (v.id === "custom") {
    const rules = { ...VARIATIONS[custom.template].rules, setsToWin: custom.setsToWin };
    return { variation: "custom", deck: customDeck(custom), roles: custom.roles, roleMode: custom.roleMode, rolesPerPlayer: custom.rolesPerPlayer, rules };
  }
  return { variation: v.id, deck: v.deck, roles: v.roles, roleMode: "random", rolesPerPlayer: 1, rules: v.rules ?? {} };
}
