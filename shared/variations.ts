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
import type { ActionType, CustomRules, GameRules, RoleType, VariationId } from "./schema";
import { ALL_CARD_DEFS, CARD_DEF_MAP, CLASSIC_DECK, MONOPOLY_DEAL_DECK, PRIME_DECK, PRIME_EXTRA_COPIES } from "./cardDefs";

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

/** Every action card a Custom game can include, with how many copies it adds. */
export const ACTION_CHOICES: { type: ActionType; name: string; text: string; copies: number }[] = [];
for (const d of ALL_CARD_DEFS) {
  if (d.type !== "action" || !d.actionType || PRIME_EXTRA_COPIES.includes(d.id)) continue;
  const known = ACTION_CHOICES.find(a => a.type === d.actionType);
  if (known) known.copies++;
  else ACTION_CHOICES.push({ type: d.actionType, name: d.name, text: d.text ?? "", copies: 1 });
}

/** Action cards that aren't in a regular Monopoly Deal deck: off by default in Custom. */
export const NON_CLASSIC_ACTIONS: ActionType[] = [
  "reducto", "silencio", "time_turner", "double_rent",
  "hand_seven", "hand_steal", "chargeback", "reverse", "destroy", "bank_robber",
];

export const DEFAULT_CUSTOM_RULES: CustomRules = {
  roles: ["harry", "hermione", "draco", "cedric", "luna"],
  actions: ACTION_CHOICES.map(a => a.type).filter(t => !NON_CLASSIC_ACTIONS.includes(t)),
  roleMode: "random",
  rolesPerPlayer: 1,
};

/** Money, properties, wilds and rent from the classic deck, plus the chosen action cards. */
export function customDeck(rules: CustomRules): string[] {
  const base = CLASSIC_DECK.filter(id => CARD_DEF_MAP[id].type !== "action");
  const actions = ALL_CARD_DEFS.filter(d => d.type === "action" && !PRIME_EXTRA_COPIES.includes(d.id) && rules.actions.includes(d.actionType!)).map(d => d.id);
  return [...base, ...actions];
}

/**
 * Apply a host's changes to Custom rules, ignoring anything invalid. Fields
 * left out of `change` keep their current value.
 */
export function updateCustomRules(current: CustomRules, change: Record<string, unknown>): CustomRules {
  const next = { ...current };
  if (Array.isArray(change.roles)) next.roles = ALL_ROLES.filter(r => (change.roles as unknown[]).includes(r));
  if (Array.isArray(change.actions)) next.actions = ACTION_CHOICES.map(a => a.type).filter(t => (change.actions as unknown[]).includes(t));
  if (change.roleMode === "random" || change.roleMode === "choose") next.roleMode = change.roleMode;
  if (typeof change.rolesPerPlayer === "number") next.rolesPerPlayer = Math.round(change.rolesPerPlayer);
  next.rolesPerPlayer = Math.max(1, Math.min(next.rolesPerPlayer, Math.max(1, next.roles.length)));
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
    roles: ["ganda", "lucha"],
    deck: [...CLASSIC_DECK],
  },
  custom: {
    id: "custom",
    name: "Custom",
    description: "Pick the roles, the action cards and how roles are handed out.",
    roles: DEFAULT_CUSTOM_RULES.roles,
    deck: customDeck(DEFAULT_CUSTOM_RULES),
  },
};

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
    return { variation: "custom", deck: customDeck(custom), roles: custom.roles, roleMode: custom.roleMode, rolesPerPlayer: custom.rolesPerPlayer, rules: {} };
  }
  return { variation: v.id, deck: v.deck, roles: v.roles, roleMode: "random", rolesPerPlayer: 1, rules: v.rules ?? {} };
}
