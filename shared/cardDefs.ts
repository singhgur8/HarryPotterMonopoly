import type { CardDef, PropertyColor } from "./schema";

// ========== MONEY CARDS (20) ==========
const moneyCards: CardDef[] = [
  // 6x 1G Bronze
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `money_1g_${i + 1}`,
    type: "money" as const,
    name: "1 Galleon",
    value: 1,
  })),
  // 5x 2G Silver
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `money_2g_${i + 1}`,
    type: "money" as const,
    name: "2 Galleons",
    value: 2,
  })),
  // 3x 3G Gold
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_3g_${i + 1}`,
    type: "money" as const,
    name: "3 Galleons",
    value: 3,
  })),
  // 3x 4G Emerald
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_4g_${i + 1}`,
    type: "money" as const,
    name: "4 Galleons",
    value: 4,
  })),
  // 2x 5G Sapphire
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `money_5g_${i + 1}`,
    type: "money" as const,
    name: "5 Galleons",
    value: 5,
  })),
  // 1x 10G Amethyst
  {
    id: "money_10g_1",
    type: "money" as const,
    name: "10 Galleons",
    value: 10,
  },
];

// ========== PROPERTY CARDS (28) ==========
const propertyCards: CardDef[] = [
  // Brown (2)
  { id: "prop_brown_1", type: "property", name: "The Cupboard Under the Stairs", shortName: "Cupboard", value: 1, color: "brown" },
  { id: "prop_brown_2", type: "property", name: "4 Privet Drive", shortName: "Privet Drive", value: 1, color: "brown" },
  // Light Blue (3)
  { id: "prop_lightblue_1", type: "property", name: "Ollivanders", value: 1, color: "light_blue" },
  { id: "prop_lightblue_2", type: "property", name: "Flourish & Blotts", shortName: "Flourish", value: 1, color: "light_blue" },
  { id: "prop_lightblue_3", type: "property", name: "Weasleys' Wizard Wheezes", shortName: "Wheezes", value: 1, color: "light_blue" },
  // Pink (3)
  { id: "prop_pink_1", type: "property", name: "The Three Broomsticks", shortName: "Broomsticks", value: 2, color: "pink" },
  { id: "prop_pink_2", type: "property", name: "Honeydukes", value: 2, color: "pink" },
  { id: "prop_pink_3", type: "property", name: "Zonko's Joke Shop", shortName: "Zonko's", value: 2, color: "pink" },
  // Orange (3)
  { id: "prop_orange_1", type: "property", name: "Ministry Atrium", shortName: "Atrium", value: 2, color: "orange" },
  { id: "prop_orange_2", type: "property", name: "Department of Mysteries", shortName: "Mysteries", value: 2, color: "orange" },
  { id: "prop_orange_3", type: "property", name: "Wizengamot Courtroom", shortName: "Wizengamot", value: 2, color: "orange" },
  // Red (3)
  { id: "prop_red_1", type: "property", name: "Hagrid's Hut", shortName: "Hagrid's", value: 3, color: "red" },
  { id: "prop_red_2", type: "property", name: "Forbidden Forest", shortName: "Forest", value: 3, color: "red" },
  { id: "prop_red_3", type: "property", name: "Whomping Willow", shortName: "Willow", value: 3, color: "red" },
  // Yellow (3)
  { id: "prop_yellow_1", type: "property", name: "Quidditch Pitch", shortName: "Pitch", value: 3, color: "yellow" },
  { id: "prop_yellow_2", type: "property", name: "Owlery", value: 3, color: "yellow" },
  { id: "prop_yellow_3", type: "property", name: "Prefects' Bathroom", shortName: "Bathroom", value: 3, color: "yellow" },
  // Green (3)
  { id: "prop_green_1", type: "property", name: "Great Hall", value: 4, color: "green" },
  { id: "prop_green_2", type: "property", name: "Library", value: 4, color: "green" },
  { id: "prop_green_3", type: "property", name: "Astronomy Tower", shortName: "Astronomy", value: 4, color: "green" },
  // Dark Blue (2)
  { id: "prop_darkblue_1", type: "property", name: "Hogwarts Castle", shortName: "Hogwarts", value: 4, color: "dark_blue" },
  { id: "prop_darkblue_2", type: "property", name: "Gringotts Bank", shortName: "Gringotts", value: 4, color: "dark_blue" },
  // Transport (4)
  { id: "prop_transport_1", type: "property", name: "Hogwarts Express", shortName: "Express", value: 2, color: "transport" },
  { id: "prop_transport_2", type: "property", name: "Knight Bus", value: 2, color: "transport" },
  { id: "prop_transport_3", type: "property", name: "Floo Network", value: 2, color: "transport" },
  { id: "prop_transport_4", type: "property", name: "Portkey", value: 2, color: "transport" },
  // Utility (2)
  { id: "prop_utility_1", type: "property", name: "Daily Prophet", shortName: "Prophet", value: 2, color: "utility" },
  { id: "prop_utility_2", type: "property", name: "The Quibbler", shortName: "Quibbler", value: 2, color: "utility" },
];

// ========== WILD CARDS (11) ==========
const wildCards: CardDef[] = [
  // 2x Rainbow Wild (Polyjuice Potion)
  { id: "wild_rainbow_1", type: "wild", name: "Polyjuice Potion", shortName: "Polyjuice", text: "Counts as any colour. You can move it between sets on your turn.", value: 0, wildColors: "rainbow" },
  { id: "wild_rainbow_2", type: "wild", name: "Polyjuice Potion", shortName: "Polyjuice", text: "Counts as any colour. You can move it between sets on your turn.", value: 0, wildColors: "rainbow" },
  // Light Blue / Brown
  { id: "wild_lb_brown_1", type: "wild", name: "Light Blue / Brown Wild", value: 1, wildColors: ["light_blue", "brown"] },
  // Light Blue / Transport
  { id: "wild_lb_trans_1", type: "wild", name: "Light Blue / Transport Wild", value: 4, wildColors: ["light_blue", "transport"] },
  // 2x Pink / Orange
  { id: "wild_pink_orange_1", type: "wild", name: "Pink / Orange Wild", value: 2, wildColors: ["pink", "orange"] },
  { id: "wild_pink_orange_2", type: "wild", name: "Pink / Orange Wild", value: 2, wildColors: ["pink", "orange"] },
  // 2x Red / Yellow
  { id: "wild_red_yellow_1", type: "wild", name: "Red / Yellow Wild", value: 3, wildColors: ["red", "yellow"] },
  { id: "wild_red_yellow_2", type: "wild", name: "Red / Yellow Wild", value: 3, wildColors: ["red", "yellow"] },
  // Dark Blue / Green
  { id: "wild_db_green_1", type: "wild", name: "Dark Blue / Green Wild", value: 4, wildColors: ["dark_blue", "green"] },
  // Green / Transport
  { id: "wild_green_trans_1", type: "wild", name: "Green / Transport Wild", value: 4, wildColors: ["green", "transport"] },
  // Transport / Utility
  { id: "wild_trans_util_1", type: "wild", name: "Transport / Utility Wild", value: 2, wildColors: ["transport", "utility"] },
];

// ========== RENT CARDS (13) ==========
const rentCards: CardDef[] = [
  // 2x Brown / Light Blue Rent
  { id: "rent_brown_lb_1", type: "rent", name: "Brown / Light Blue Rent", value: 1, rentColors: ["brown", "light_blue"] },
  { id: "rent_brown_lb_2", type: "rent", name: "Brown / Light Blue Rent", value: 1, rentColors: ["brown", "light_blue"] },
  // 2x Pink / Orange Rent
  { id: "rent_pink_orange_1", type: "rent", name: "Pink / Orange Rent", value: 1, rentColors: ["pink", "orange"] },
  { id: "rent_pink_orange_2", type: "rent", name: "Pink / Orange Rent", value: 1, rentColors: ["pink", "orange"] },
  // 2x Red / Yellow Rent
  { id: "rent_red_yellow_1", type: "rent", name: "Red / Yellow Rent", value: 1, rentColors: ["red", "yellow"] },
  { id: "rent_red_yellow_2", type: "rent", name: "Red / Yellow Rent", value: 1, rentColors: ["red", "yellow"] },
  // 2x Green / Dark Blue Rent
  { id: "rent_green_db_1", type: "rent", name: "Green / Dark Blue Rent", value: 1, rentColors: ["green", "dark_blue"] },
  { id: "rent_green_db_2", type: "rent", name: "Green / Dark Blue Rent", value: 1, rentColors: ["green", "dark_blue"] },
  // 2x Transport / Utility Rent
  { id: "rent_trans_util_1", type: "rent", name: "Transport / Utility Rent", value: 1, rentColors: ["transport", "utility"] },
  { id: "rent_trans_util_2", type: "rent", name: "Transport / Utility Rent", value: 1, rentColors: ["transport", "utility"] },
  // 3x Rainbow Rent
  { id: "rent_rainbow_1", type: "rent", name: "Rainbow Rent", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_2", type: "rent", name: "Rainbow Rent", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_3", type: "rent", name: "Rainbow Rent", value: 3, rentColors: "rainbow" },
];

// ========== ACTION CARDS (34) ==========
const actionCards: CardDef[] = [
  // 10x Felix Felicis (Pass Go)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `action_felix_${i + 1}`,
    type: "action" as const,
    name: "Felix Felicis",
    value: 1,
    actionType: "felix_felicis" as const,
    text: "Draw 2 extra cards.",
    target: "self" as const,
    shortName: "Felix",
  })),
  // 3x Accio (Sly Deal)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_accio_${i + 1}`,
    type: "action" as const,
    name: "Accio",
    value: 3,
    actionType: "accio" as const,
    text: "Take one property from another player. Not from a complete set.",
    target: "one" as const,
  })),
  // 3x Confundus Charm (Force Deal)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_confundus_${i + 1}`,
    type: "action" as const,
    name: "Confundus Charm",
    value: 3,
    actionType: "confundus_charm" as const,
    text: "Swap one of your properties for one of another player's. Not from complete sets.",
    target: "one" as const,
    shortName: "Confundus",
  })),
  // 2x Expelliarmus (Deal Breaker)
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_expelliarmus_${i + 1}`,
    type: "action" as const,
    name: "Expelliarmus",
    value: 5,
    actionType: "expelliarmus" as const,
    text: "Take a complete set from another player.",
    target: "one" as const,
  })),
  // 3x Protego (Just Say No)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_protego_${i + 1}`,
    type: "action" as const,
    name: "Protego",
    value: 4,
    actionType: "protego" as const,
    text: "Cancel an action played against you.",
    target: "reaction" as const,
  })),
  // 3x Gringotts Goblin (Debt Collector)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_goblin_${i + 1}`,
    type: "action" as const,
    name: "Gringotts Goblin",
    value: 3,
    actionType: "gringotts_goblin" as const,
    text: "One player of your choice pays you 5G.",
    target: "one" as const,
    shortName: "Goblin",
  })),
  // 3x Yule Ball (It's My Birthday)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_yule_${i + 1}`,
    type: "action" as const,
    name: "Yule Ball",
    value: 2,
    actionType: "yule_ball" as const,
    text: "Every other player pays you 2G.",
    target: "all" as const,
  })),
  // 3x Reducto
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_reducto_${i + 1}`,
    type: "action" as const,
    name: "Reducto",
    value: 4,
    actionType: "reducto" as const,
    text: "Destroy one of another player's properties. Not from a complete set, and never bank cards.",
    target: "one" as const,
  })),
  // 2x Silencio
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_silencio_${i + 1}`,
    type: "action" as const,
    name: "Silencio",
    value: 5,
    actionType: "silencio" as const,
    text: "Switch off a player's role power until they pay 10G.",
    target: "one" as const,
  })),
  // 2x Time-Turner
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_time_turner_${i + 1}`,
    type: "action" as const,
    name: "Time-Turner",
    value: 2,
    actionType: "time_turner" as const,
    text: "Take any card from the discard pile and play it now.",
    target: "self" as const,
  })),
];

// ========== ROLE CARDS (5) ==========
const roleCards: CardDef[] = [
  {
    id: "role_harry",
    type: "role",
    name: "Harry Potter",
    value: 0,
    roleType: "harry",
    shortName: "Harry",
    text: "At the end of your turn, shield one colour. It can't be stolen or charged rent until your next turn.",
    rolePower: "Protect one color at end of turn — immune to steal/rent actions. Can still voluntarily pay with protected properties. Owes nothing if only protected properties remain.",
  },
  {
    id: "role_hermione",
    type: "role",
    name: "Hermione Granger",
    value: 0,
    roleType: "hermione",
    shortName: "Hermione",
    rolePower: "Play up to 4 actions per turn instead of 3.",
  },
  {
    id: "role_draco",
    type: "role",
    name: "Draco Malfoy",
    value: 0,
    roleType: "draco",
    shortName: "Draco",
    text: "Accio, Confundus and Reducto can target complete sets.",
    rolePower: "Can target properties in complete sets with Accio, Confundus, and Reducto.",
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
    rolePower: "Draw 3 cards at start of turn instead of 2.",
  },
];

// ========== COMBINED DECK ==========
export const ALL_CARD_DEFS: CardDef[] = [
  ...moneyCards,
  ...propertyCards,
  ...wildCards,
  ...rentCards,
  ...actionCards,
  ...roleCards,
];

// Index by ID for fast lookup
export const CARD_DEF_MAP: Record<string, CardDef> = {};
for (const def of ALL_CARD_DEFS) {
  CARD_DEF_MAP[def.id] = def;
}

// Get all non-role cards for the play deck (roles are dealt separately)
export function getPlayDeckCardIds(): string[] {
  return ALL_CARD_DEFS
    .filter((c) => c.type !== "role")
    .map((c) => c.id);
}

// Utility: get the effective color for a game card (handles wilds)
export function getEffectiveColor(card: { defId: string; assignedColor?: PropertyColor }): PropertyColor | undefined {
  const def = CARD_DEF_MAP[card.defId];
  if (!def) return undefined;
  if (def.type === "property") return def.color;
  if (def.type === "wild") return card.assignedColor;
  return undefined;
}

// Count complete sets for a player's properties
export function countCompleteSets(
  properties: { defId: string; assignedColor?: PropertyColor }[],
  setSizes: Record<PropertyColor, number>
): number {
  const colorCounts: Partial<Record<PropertyColor, number>> = {};
  for (const card of properties) {
    const color = getEffectiveColor(card);
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
