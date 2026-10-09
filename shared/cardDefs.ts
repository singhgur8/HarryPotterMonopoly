import type { CardDef, PropertyColor, RoleType } from "./schema";

// ========== MONEY CARDS (20) ==========
const moneyCards: CardDef[] = [
  // 6x 1M
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `money_1g_${i + 1}`,
    type: "money" as const,
    name: "1M",
    value: 1,
  })),
  // 5x 2M
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `money_2g_${i + 1}`,
    type: "money" as const,
    name: "2M",
    value: 2,
  })),
  // 3x 3M
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_3g_${i + 1}`,
    type: "money" as const,
    name: "3M",
    value: 3,
  })),
  // 3x 4M
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_4g_${i + 1}`,
    type: "money" as const,
    name: "4M",
    value: 4,
  })),
  // 2x 5M
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `money_5g_${i + 1}`,
    type: "money" as const,
    name: "5M",
    value: 5,
  })),
  // 1x 10M
  {
    id: "money_10g_1",
    type: "money" as const,
    name: "10M",
    value: 10,
  },
];

// ========== PROPERTY CARDS (28) ==========
const propertyCards: CardDef[] = [
  // Brown (2)
  { id: "prop_brown_1", type: "property", name: "Mediterranean Avenue", shortName: "Med. Ave", value: 1, color: "brown" },
  { id: "prop_brown_2", type: "property", name: "Baltic Avenue", shortName: "Baltic", value: 1, color: "brown" },
  // Light Blue (3)
  { id: "prop_lightblue_1", type: "property", name: "Oriental Avenue", shortName: "Oriental", value: 1, color: "light_blue" },
  { id: "prop_lightblue_2", type: "property", name: "Vermont Avenue", shortName: "Vermont", value: 1, color: "light_blue" },
  { id: "prop_lightblue_3", type: "property", name: "Connecticut Avenue", shortName: "Connecticut", value: 1, color: "light_blue" },
  // Pink (3)
  { id: "prop_pink_1", type: "property", name: "St. Charles Place", shortName: "St. Charles", value: 2, color: "pink" },
  { id: "prop_pink_2", type: "property", name: "States Avenue", shortName: "States", value: 2, color: "pink" },
  { id: "prop_pink_3", type: "property", name: "Virginia Avenue", shortName: "Virginia", value: 2, color: "pink" },
  // Orange (3)
  { id: "prop_orange_1", type: "property", name: "St. James Place", shortName: "St. James", value: 2, color: "orange" },
  { id: "prop_orange_2", type: "property", name: "Tennessee Avenue", shortName: "Tennessee", value: 2, color: "orange" },
  { id: "prop_orange_3", type: "property", name: "New York Avenue", shortName: "New York", value: 2, color: "orange" },
  // Red (3)
  { id: "prop_red_1", type: "property", name: "Kentucky Avenue", shortName: "Kentucky", value: 3, color: "red" },
  { id: "prop_red_2", type: "property", name: "Indiana Avenue", shortName: "Indiana", value: 3, color: "red" },
  { id: "prop_red_3", type: "property", name: "Illinois Avenue", shortName: "Illinois", value: 3, color: "red" },
  // Yellow (3)
  { id: "prop_yellow_1", type: "property", name: "Atlantic Avenue", shortName: "Atlantic", value: 3, color: "yellow" },
  { id: "prop_yellow_2", type: "property", name: "Ventnor Avenue", shortName: "Ventnor", value: 3, color: "yellow" },
  { id: "prop_yellow_3", type: "property", name: "Marvin Gardens", shortName: "Marvin", value: 3, color: "yellow" },
  // Green (3)
  { id: "prop_green_1", type: "property", name: "Pacific Avenue", shortName: "Pacific", value: 4, color: "green" },
  { id: "prop_green_2", type: "property", name: "North Carolina Avenue", shortName: "N. Carolina", value: 4, color: "green" },
  { id: "prop_green_3", type: "property", name: "Pennsylvania Avenue", shortName: "Pennsylvania", value: 4, color: "green" },
  // Dark Blue (2)
  { id: "prop_darkblue_1", type: "property", name: "Park Place", value: 4, color: "dark_blue" },
  { id: "prop_darkblue_2", type: "property", name: "Boardwalk", value: 4, color: "dark_blue" },
  // Railroad (4)
  { id: "prop_transport_1", type: "property", name: "Reading Railroad", shortName: "Reading", value: 2, color: "transport" },
  { id: "prop_transport_2", type: "property", name: "Pennsylvania Railroad", shortName: "Penn. RR", value: 2, color: "transport" },
  { id: "prop_transport_3", type: "property", name: "B. & O. Railroad", shortName: "B. & O.", value: 2, color: "transport" },
  { id: "prop_transport_4", type: "property", name: "Short Line", value: 2, color: "transport" },
  // Utility (2)
  { id: "prop_utility_1", type: "property", name: "Electric Company", shortName: "Electric Co.", value: 2, color: "utility" },
  { id: "prop_utility_2", type: "property", name: "Water Works", value: 2, color: "utility" },
];

// ========== WILD CARDS (11) ==========
const wildCards: CardDef[] = [
  // 2x any-colour Property Wild Card
  { id: "wild_rainbow_1", type: "wild", name: "Property Wild Card", shortName: "Any colour", text: "Joins a colour you already have. On its own it has no colour and earns no rent. Move it between your sets on your turn.", value: 0, wildColors: "rainbow" },
  { id: "wild_rainbow_2", type: "wild", name: "Property Wild Card", shortName: "Any colour", text: "Joins a colour you already have. On its own it has no colour and earns no rent. Move it between your sets on your turn.", value: 0, wildColors: "rainbow" },
  // Light Blue / Brown
  { id: "wild_lb_brown_1", type: "wild", name: "Property Wild Card (Light Blue / Brown)", value: 1, wildColors: ["light_blue", "brown"] },
  // Light Blue / Railroad
  { id: "wild_lb_trans_1", type: "wild", name: "Property Wild Card (Light Blue / Railroad)", value: 4, wildColors: ["light_blue", "transport"] },
  // 2x Pink / Orange
  { id: "wild_pink_orange_1", type: "wild", name: "Property Wild Card (Pink / Orange)", value: 2, wildColors: ["pink", "orange"] },
  { id: "wild_pink_orange_2", type: "wild", name: "Property Wild Card (Pink / Orange)", value: 2, wildColors: ["pink", "orange"] },
  // 2x Red / Yellow
  { id: "wild_red_yellow_1", type: "wild", name: "Property Wild Card (Red / Yellow)", value: 3, wildColors: ["red", "yellow"] },
  { id: "wild_red_yellow_2", type: "wild", name: "Property Wild Card (Red / Yellow)", value: 3, wildColors: ["red", "yellow"] },
  // Dark Blue / Green
  { id: "wild_db_green_1", type: "wild", name: "Property Wild Card (Dark Blue / Green)", value: 4, wildColors: ["dark_blue", "green"] },
  // Green / Railroad
  { id: "wild_green_trans_1", type: "wild", name: "Property Wild Card (Green / Railroad)", value: 4, wildColors: ["green", "transport"] },
  // Railroad / Utility
  { id: "wild_trans_util_1", type: "wild", name: "Property Wild Card (Railroad / Utility)", value: 2, wildColors: ["transport", "utility"] },
];

// ========== RENT CARDS (13) ==========
const rentCards: CardDef[] = [
  // 2x Brown / Light Blue Rent
  { id: "rent_brown_lb_1", type: "rent", name: "Rent (Brown / Light Blue)", value: 1, rentColors: ["brown", "light_blue"] },
  { id: "rent_brown_lb_2", type: "rent", name: "Rent (Brown / Light Blue)", value: 1, rentColors: ["brown", "light_blue"] },
  // 2x Pink / Orange Rent
  { id: "rent_pink_orange_1", type: "rent", name: "Rent (Pink / Orange)", value: 1, rentColors: ["pink", "orange"] },
  { id: "rent_pink_orange_2", type: "rent", name: "Rent (Pink / Orange)", value: 1, rentColors: ["pink", "orange"] },
  // 2x Red / Yellow Rent
  { id: "rent_red_yellow_1", type: "rent", name: "Rent (Red / Yellow)", value: 1, rentColors: ["red", "yellow"] },
  { id: "rent_red_yellow_2", type: "rent", name: "Rent (Red / Yellow)", value: 1, rentColors: ["red", "yellow"] },
  // 2x Green / Dark Blue Rent
  { id: "rent_green_db_1", type: "rent", name: "Rent (Green / Dark Blue)", value: 1, rentColors: ["green", "dark_blue"] },
  { id: "rent_green_db_2", type: "rent", name: "Rent (Green / Dark Blue)", value: 1, rentColors: ["green", "dark_blue"] },
  // 2x Railroad / Utility Rent
  { id: "rent_trans_util_1", type: "rent", name: "Rent (Railroad / Utility)", value: 1, rentColors: ["transport", "utility"] },
  { id: "rent_trans_util_2", type: "rent", name: "Rent (Railroad / Utility)", value: 1, rentColors: ["transport", "utility"] },
  // 3x Wild Rent
  { id: "rent_rainbow_1", type: "rent", name: "Wild Rent", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_2", type: "rent", name: "Wild Rent", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_3", type: "rent", name: "Wild Rent", value: 3, rentColors: "rainbow" },
];

// ========== ACTION CARDS (34) ==========
const actionCards: CardDef[] = [
  // 10x Pass Go
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `action_felix_${i + 1}`,
    type: "action" as const,
    name: "Pass Go",
    value: 1,
    actionType: "felix_felicis" as const,
    text: "Draw 2 extra cards.",
    target: "self" as const,
      })),
  // 3x Sly Deal
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_accio_${i + 1}`,
    type: "action" as const,
    name: "Sly Deal",
    value: 3,
    actionType: "accio" as const,
    text: "Take one property from another player. Not from a complete set.",
    target: "one" as const,
  })),
  // 3x Forced Deal
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_confundus_${i + 1}`,
    type: "action" as const,
    name: "Forced Deal",
    value: 3,
    actionType: "confundus_charm" as const,
    text: "Swap one of your properties for one of another player's. Not from complete sets.",
    target: "one" as const,
  })),
  // 2x Deal Breaker
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_expelliarmus_${i + 1}`,
    type: "action" as const,
    name: "Deal Breaker",
    value: 5,
    actionType: "expelliarmus" as const,
    text: "Take a complete set from another player.",
    target: "one" as const,
  })),
  // 3x Just Say No
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_protego_${i + 1}`,
    type: "action" as const,
    name: "Just Say No",
    value: 4,
    actionType: "protego" as const,
    text: "Cancel an action played against you.",
    target: "reaction" as const,
  })),
  // 3x Debt Collector
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_goblin_${i + 1}`,
    type: "action" as const,
    name: "Debt Collector",
    value: 3,
    actionType: "gringotts_goblin" as const,
    text: "One player of your choice pays you 5M.",
    target: "one" as const,
  })),
  // 3x It's My Birthday
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_yule_${i + 1}`,
    type: "action" as const,
    name: "It's My Birthday",
    value: 2,
    actionType: "yule_ball" as const,
    text: "Every other player pays you 2M.",
    target: "all" as const,
  })),
  // 3x Demolish (was Reducto)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_reducto_${i + 1}`,
    type: "action" as const,
    name: "Demolish",
    value: 4,
    actionType: "reducto" as const,
    text: "Destroy one of another player's properties. Not from a complete set, and never bank cards.",
    target: "one" as const,
  })),
  // 2x Power Outage (was Silencio)
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_silencio_${i + 1}`,
    type: "action" as const,
    name: "Power Outage",
    value: 5,
    actionType: "silencio" as const,
    text: "Switch off a player's role power (one role of your choice if they have several). On their turn, after drawing, they can pay 10M to switch it back on (not a play).",
    target: "one" as const,
  })),
  // 2x Rewind (was Time-Turner)
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_time_turner_${i + 1}`,
    type: "action" as const,
    name: "Rewind",
    value: 2,
    actionType: "time_turner" as const,
    text: "Take any card from the discard pile and play it now.",
    target: "self" as const,
  })),
];

// ========== EXTRA ACTION CARDS ==========
// Not in the Classic deck; a Custom game can add them.
const extraActionCards: CardDef[] = [
  // 2x Double the Rent
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_double_rent_${i + 1}`,
    type: "action" as const,
    name: "Double the Rent",
    value: 1,
    actionType: "double_rent" as const,
    text: "Play before a rent card to double that rent. Uses one of your plays.",
    target: "self" as const,
  })),
];

// ========== PRIME EDITION ==========
// Added on top of the Monopoly Deal deck in Prime games (19 cards).
const primeCards: CardDef[] = [
  { id: "money_1g_7", type: "money", name: "1M", value: 1 },
  { id: "money_2g_6", type: "money", name: "2M", value: 2 },
  { id: "money_3g_4", type: "money", name: "3M", value: 3 },
  { id: "money_4g_4", type: "money", name: "4M", value: 4 },
  { id: "money_5g_3", type: "money", name: "5M", value: 5 },
  { id: "wild_rainbow_3", type: "wild", name: "Property Wild Card", shortName: "Any colour", text: "Counts as any colour. You can move it between sets on your turn.", value: 0, wildColors: "rainbow" },
  { id: "wild_lb_brown_2", type: "wild", name: "Property Wild Card (Light Blue / Brown)", value: 1, wildColors: ["light_blue", "brown"] },
  { id: "wild_trans_util_2", type: "wild", name: "Property Wild Card (Railroad / Utility)", value: 2, wildColors: ["transport", "utility"] },
  { id: "wild_red_yellow_3", type: "wild", name: "Property Wild Card (Red / Yellow)", value: 3, wildColors: ["red", "yellow"] },
  { id: "wild_green_trans_2", type: "wild", name: "Property Wild Card (Green / Railroad)", value: 4, wildColors: ["green", "transport"] },
  { id: "action_protego_4", type: "action", name: "Just Say No", value: 4, actionType: "protego", text: "Cancel an action played against you.", target: "reaction" },
  { id: "action_hand_seven_1", type: "action", name: "Refresh", value: 1, actionType: "hand_seven", text: "Discard your whole hand, then draw 5 fresh cards.", target: "self" },
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_hand_steal_${i + 1}`, type: "action" as const, name: "Hand Steal", value: 3, actionType: "hand_steal" as const,
    text: "Take a random card from another player's hand.", target: "one" as const,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_chargeback_${i + 1}`, type: "action" as const, name: "Chargeback", value: 4, actionType: "chargeback" as const,
    text: "When you're charged, cancel it. Instead, you charge a player of your choice that same amount.", target: "reaction" as const,
  })),
  { id: "action_reverse_1", type: "action", name: "Reverse", value: 5, actionType: "reverse", text: "Stop an action played on you and turn it back on the player who played it. If it can't be turned back, it works as a Just Say No.", target: "reaction" },
  { id: "action_destroy_1", type: "action", name: "Destroy", value: 5, actionType: "destroy", text: "Discard one of another player's properties, even from a complete set.", target: "one" },
  { id: "action_bank_robber_1", type: "action", name: "Bank Robber", value: 10, actionType: "bank_robber", text: "Take all the money in another player's bank.", target: "one" },
];

// ========== VEGAS (BETA) ==========
// Added on top of the Monopoly Deal deck in Vegas games.
const vegasCards: CardDef[] = [
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_guess_draw_${i + 1}`, type: "action" as const, name: "Guess and Draw", value: 2, actionType: "guess_draw" as const,
    text: "Guess if the top card of the deck is a Property, Cash or Action. Right: keep it and guess again. Wrong: it's discarded and you stop.",
    target: "self" as const,
  })),
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_all_in_${i + 1}`, type: "action" as const, name: "All In", value: 3, actionType: "all_in" as const,
    text: "Everyone stakes cards worth the poorest player's bank and properties. Everyone rolls two dice: the highest roll takes the whole pot.",
    target: "all" as const,
  })),
];

/** Prime's extra copy of a card every deck already has: Custom games leave it out. */
export const PRIME_EXTRA_COPIES = ["action_protego_4"];

// ========== ROLE CARDS (5) ==========
const roleCards: CardDef[] = [
  {
    id: "role_harry",
    type: "role",
    name: "Harry Potter",
    value: 0,
    roleType: "harry",
    shortName: "Harry",
    text: "Shield one colour. It can't be stolen or charged rent. It stays until you move it at the end of one of your turns.",
    rolePower: "Shield one color; it stays until Harry moves or drops it at the end of a turn — immune to steal/rent actions. Can still voluntarily pay with protected properties. Owes nothing if only protected properties remain.",
  },
  {
    id: "role_hermione",
    type: "role",
    name: "Hermione Granger",
    value: 0,
    roleType: "hermione",
    shortName: "Hermione",
    text: "Play up to 4 actions a turn instead of 3.",
    rolePower: "Play up to 4 actions per turn instead of 3.",
  },
  {
    id: "role_draco",
    type: "role",
    name: "Draco Malfoy",
    value: 0,
    roleType: "draco",
    shortName: "Draco",
    text: "Sly Deal, Forced Deal and Demolish can target complete sets.",
    rolePower: "Can target properties in complete sets with Sly Deal, Forced Deal and Demolish.",
  },
  {
    id: "role_cedric",
    type: "role",
    name: "Cedric Diggory",
    value: 0,
    roleType: "cedric",
    shortName: "Cedric",
    text: "Start your turn by drawing from the deck or taking the top 2 of the discard pile.",
    rolePower: "Choose to draw from deck OR pick top 2 from discard pile at start of turn.",
  },
  {
    id: "role_luna",
    type: "role",
    name: "Luna Lovegood",
    value: 0,
    roleType: "luna",
    shortName: "Luna",
    text: "Draw 3 cards at the start of your turn instead of 2.",
    rolePower: "Draw 3 cards at start of turn instead of 2.",
  },
  // ----- GG roles -----
  // Their powers live in worker/gameEngine.ts (search the role id) and shared/rolePowers.ts.
  {
    id: "role_ganda",
    type: "role",
    name: "Ganda",
    value: 0,
    roleType: "ganda",
    text: "Start your turn by drawing from the deck, or by taking one random card from another player's hand.",
  },
  {
    id: "role_lucha",
    type: "role",
    name: "Lucha",
    value: 0,
    roleType: "lucha",
    text: "At the end of each turn, copy one role power from another player for your next turn (just one, even if they have several). Pick someone new each time, unless it's one on one.",
  },
  {
    id: "role_gandu",
    type: "role",
    name: "Gandu",
    value: 0,
    roleType: "gandu",
    text: "Pay half of anything charged to you (rent, birthdays, debts), rounded up (1M stays 1M, 3M becomes 2M).",
  },
  {
    id: "role_tharki",
    type: "role",
    name: "Tharki",
    value: 0,
    roleType: "tharki",
    text: "Shortcut one colour that needs 3 or more cards: its set is complete with one fewer card. 2-card colours (brown, dark blue, utility) can't be shortcut. It stays until you move it at the end of one of your turns.",
  },
  {
    id: "role_kanjar",
    type: "role",
    name: "Kanjar",
    value: 0,
    roleType: "kanjar",
    text: "At the end of each turn, pick a friend. Until your next pick they can't charge you rent or play anything against you. Needs 3 or more players.",
  },
];

// ========== COMBINED DECK ==========
export const ALL_CARD_DEFS: CardDef[] = [
  ...moneyCards,
  ...propertyCards,
  ...wildCards,
  ...rentCards,
  ...actionCards,
  ...extraActionCards,
  ...primeCards,
  ...vegasCards,
  ...roleCards,
];

// Index by ID for fast lookup
export const CARD_DEF_MAP: Record<string, CardDef> = {};
for (const def of ALL_CARD_DEFS) {
  CARD_DEF_MAP[def.id] = def;
}

// ========== EXTRA COPIES FOR CUSTOM GAMES ==========
// Custom games set how many copies of each action card (by action) and each
// money card (by value) go in the deck. Copies past the ones above get ids
// that carry on the numbering, e.g. action_accio_4.
export const MAX_COPIES = 10;

/** What sets a card's copy count in Custom games, or null for cards that come from the template's deck. */
export function copyKey(defId: string): string | null {
  const d = CARD_DEF_MAP[defId];
  if (d?.type === "action") return d.actionType!;
  if (d?.type === "money") return `money_${d.value}`;
  return null;
}

/** The ids of every copy of a card, by copyKey: the first n are the copies in an n-copy deck. */
export const COPY_IDS: Record<string, string[]> = {};
for (const d of ALL_CARD_DEFS) {
  const key = copyKey(d.id);
  if (key) (COPY_IDS[key] ??= []).push(d.id);
}
for (const ids of Object.values(COPY_IDS)) {
  const first = CARD_DEF_MAP[ids[0]];
  const stem = first.id.replace(/_\d+$/, "");
  for (let n = 1; ids.length < MAX_COPIES; n++) {
    const id = `${stem}_${n}`;
    if (CARD_DEF_MAP[id]) continue;
    CARD_DEF_MAP[id] = { ...first, id };
    ids.push(id);
  }
}

// The Classic Harry Potter play deck: every card above except the extra
// action cards and roles (roles are dealt separately). Variations in
// shared/variations.ts build on it.
export const CLASSIC_DECK: string[] = [
  ...moneyCards, ...propertyCards, ...wildCards, ...rentCards, ...actionCards,
].map((c) => c.id);

// Real Monopoly Deal: the classic deck with Double the Rent in place of the
// Harry Potter actions (Demolish, Power Outage, Rewind). Houses and hotels
// aren't in this game.
export const MONOPOLY_DEAL_DECK: string[] = [
  ...CLASSIC_DECK.filter((id) => !["reducto", "silencio", "time_turner"].includes(CARD_DEF_MAP[id].actionType ?? "")),
  ...extraActionCards.filter((c) => c.actionType === "double_rent").map((c) => c.id),
];

// Prime: the Monopoly Deal deck plus the Prime cards
export const PRIME_DECK: string[] = [...MONOPOLY_DEAL_DECK, ...primeCards.map((c) => c.id)];

// Vegas: the Monopoly Deal deck plus Guess and Draw and All In
export const VEGAS_DECK: string[] = [...MONOPOLY_DEAL_DECK, ...vegasCards.map((c) => c.id)];

/** The role card for a role, e.g. role_harry. */
export const roleDef = (role: RoleType): CardDef | undefined => CARD_DEF_MAP[`role_${role}`];

// Utility: get the effective color for a game card (handles wilds)
export function getEffectiveColor(card: { defId: string; assignedColor?: PropertyColor }): PropertyColor | undefined {
  const def = CARD_DEF_MAP[card.defId];
  if (!def) return undefined;
  if (def.type === "property") return def.color;
  if (def.type === "wild") return card.assignedColor;
  return undefined;
}

/** The any-colour Property Wild Card. */
export const isAnyColourWild = (defId: string) => CARD_DEF_MAP[defId]?.wildColors === "rainbow";

/**
 * The colour a card on someone's table counts as. The any-colour wild only
 * counts towards a colour while that set also holds a card of its own colour
 * (a property or a two-colour wild). On its own it sits there with no colour:
 * it doesn't make a set and can't be charged rent for.
 */
export function colorOnTable(
  card: { defId: string; assignedColor?: PropertyColor },
  properties: { defId: string; assignedColor?: PropertyColor }[],
): PropertyColor | undefined {
  const color = getEffectiveColor(card);
  if (!color || !isAnyColourWild(card.defId)) return color;
  return properties.some(o => !isAnyColourWild(o.defId) && getEffectiveColor(o) === color) ? color : undefined;
}

// Count complete sets for a player's properties
export function countCompleteSets(
  properties: { defId: string; assignedColor?: PropertyColor }[],
  setSizes: Record<PropertyColor, number>
): number {
  const colorCounts: Partial<Record<PropertyColor, number>> = {};
  for (const card of properties) {
    const color = colorOnTable(card, properties);
    if (color) {
      colorCounts[color] = (colorCounts[color] || 0) + 1;
    }
  }
  let completeSets = 0;
  for (const [color, count] of Object.entries(colorCounts)) {
    const needed = setSizes[color as PropertyColor];
    if (needed && count! >= needed) {
      completeSets++;
    }
  }
  return completeSets;
}
