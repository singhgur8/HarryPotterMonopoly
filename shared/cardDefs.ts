import type { CardDef, PropertyColor } from "./schema";

// ========== MONEY CARDS (20) ==========
const moneyCards: CardDef[] = [
  // 6x 1G Bronze
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `money_1g_${i + 1}`,
    type: "money" as const,
    name: "1 Galleon",
    image: "1g_bronze.webp",
    value: 1,
  })),
  // 5x 2G Silver
  ...Array.from({ length: 5 }, (_, i) => ({
    id: `money_2g_${i + 1}`,
    type: "money" as const,
    name: "2 Galleons",
    image: "2g_silver.webp",
    value: 2,
  })),
  // 3x 3G Gold
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_3g_${i + 1}`,
    type: "money" as const,
    name: "3 Galleons",
    image: "3g_gold.webp",
    value: 3,
  })),
  // 3x 4G Emerald
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `money_4g_${i + 1}`,
    type: "money" as const,
    name: "4 Galleons",
    image: "4g_emerald.webp",
    value: 4,
  })),
  // 2x 5G Sapphire
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `money_5g_${i + 1}`,
    type: "money" as const,
    name: "5 Galleons",
    image: "5g_sapphire.webp",
    value: 5,
  })),
  // 1x 10G Amethyst
  {
    id: "money_10g_1",
    type: "money" as const,
    name: "10 Galleons",
    image: "10g_amethyst.webp",
    value: 10,
  },
];

// ========== PROPERTY CARDS (28) ==========
const propertyCards: CardDef[] = [
  // Brown (2)
  { id: "prop_brown_1", type: "property", name: "The Cupboard Under the Stairs", image: "brown_1.webp", value: 1, color: "brown" },
  { id: "prop_brown_2", type: "property", name: "4 Privet Drive", image: "brown_2.webp", value: 1, color: "brown" },
  // Light Blue (3)
  { id: "prop_lightblue_1", type: "property", name: "Ollivanders", image: "light_blue_1.webp", value: 1, color: "light_blue" },
  { id: "prop_lightblue_2", type: "property", name: "Flourish & Blotts", image: "light_blue_2.webp", value: 1, color: "light_blue" },
  { id: "prop_lightblue_3", type: "property", name: "Weasleys' Wizard Wheezes", image: "light_blue_3.webp", value: 1, color: "light_blue" },
  // Pink (3)
  { id: "prop_pink_1", type: "property", name: "The Three Broomsticks", image: "pink_1.webp", value: 2, color: "pink" },
  { id: "prop_pink_2", type: "property", name: "Honeydukes", image: "pink_2.webp", value: 2, color: "pink" },
  { id: "prop_pink_3", type: "property", name: "Zonko's Joke Shop", image: "pink_3.webp", value: 2, color: "pink" },
  // Orange (3)
  { id: "prop_orange_1", type: "property", name: "Ministry Atrium", image: "orange_1.webp", value: 2, color: "orange" },
  { id: "prop_orange_2", type: "property", name: "Department of Mysteries", image: "orange_2.webp", value: 2, color: "orange" },
  { id: "prop_orange_3", type: "property", name: "Wizengamot Courtroom", image: "orange_3.webp", value: 2, color: "orange" },
  // Red (3)
  { id: "prop_red_1", type: "property", name: "Hagrid's Hut", image: "red_1.webp", value: 3, color: "red" },
  { id: "prop_red_2", type: "property", name: "Forbidden Forest", image: "red_2.webp", value: 3, color: "red" },
  { id: "prop_red_3", type: "property", name: "Whomping Willow", image: "red_3.webp", value: 3, color: "red" },
  // Yellow (3)
  { id: "prop_yellow_1", type: "property", name: "Quidditch Pitch", image: "yellow_1.webp", value: 3, color: "yellow" },
  { id: "prop_yellow_2", type: "property", name: "Owlery", image: "yellow_2.webp", value: 3, color: "yellow" },
  { id: "prop_yellow_3", type: "property", name: "Prefects' Bathroom", image: "yellow_3.webp", value: 3, color: "yellow" },
  // Green (3)
  { id: "prop_green_1", type: "property", name: "Great Hall", image: "green_1.webp", value: 4, color: "green" },
  { id: "prop_green_2", type: "property", name: "Library", image: "green_2.webp", value: 4, color: "green" },
  { id: "prop_green_3", type: "property", name: "Astronomy Tower", image: "green_3.webp", value: 4, color: "green" },
  // Dark Blue (2)
  { id: "prop_darkblue_1", type: "property", name: "Hogwarts Castle", image: "dark_blue_1.webp", value: 4, color: "dark_blue" },
  { id: "prop_darkblue_2", type: "property", name: "Gringotts Bank", image: "dark_blue_2.webp", value: 4, color: "dark_blue" },
  // Transport (4)
  { id: "prop_transport_1", type: "property", name: "Hogwarts Express", image: "transport_1.webp", value: 2, color: "transport" },
  { id: "prop_transport_2", type: "property", name: "Knight Bus", image: "transport_2.webp", value: 2, color: "transport" },
  { id: "prop_transport_3", type: "property", name: "Floo Network", image: "transport_3.webp", value: 2, color: "transport" },
  { id: "prop_transport_4", type: "property", name: "Portkey", image: "transport_4.webp", value: 2, color: "transport" },
  // Utility (2)
  { id: "prop_utility_1", type: "property", name: "Daily Prophet", image: "utility_1.webp", value: 2, color: "utility" },
  { id: "prop_utility_2", type: "property", name: "The Quibbler", image: "utility_2.webp", value: 2, color: "utility" },
];

// ========== WILD CARDS (11) ==========
const wildCards: CardDef[] = [
  // 2x Rainbow Wild (Polyjuice Potion)
  { id: "wild_rainbow_1", type: "wild", name: "Polyjuice Potion", image: "wild_rainbow.webp", value: 0, wildColors: "rainbow" },
  { id: "wild_rainbow_2", type: "wild", name: "Polyjuice Potion", image: "wild_rainbow.webp", value: 0, wildColors: "rainbow" },
  // Light Blue / Brown
  { id: "wild_lb_brown_1", type: "wild", name: "Light Blue / Brown Wild", image: "wild_lightblue_brown.webp", value: 1, wildColors: ["light_blue", "brown"] },
  // Light Blue / Transport
  { id: "wild_lb_trans_1", type: "wild", name: "Light Blue / Transport Wild", image: "wild_lightblue_transport.webp", value: 4, wildColors: ["light_blue", "transport"] },
  // 2x Pink / Orange
  { id: "wild_pink_orange_1", type: "wild", name: "Pink / Orange Wild", image: "wild_pink_orange.webp", value: 2, wildColors: ["pink", "orange"] },
  { id: "wild_pink_orange_2", type: "wild", name: "Pink / Orange Wild", image: "wild_pink_orange.webp", value: 2, wildColors: ["pink", "orange"] },
  // 2x Red / Yellow
  { id: "wild_red_yellow_1", type: "wild", name: "Red / Yellow Wild", image: "wild_red_yellow.webp", value: 3, wildColors: ["red", "yellow"] },
  { id: "wild_red_yellow_2", type: "wild", name: "Red / Yellow Wild", image: "wild_red_yellow.webp", value: 3, wildColors: ["red", "yellow"] },
  // Dark Blue / Green
  { id: "wild_db_green_1", type: "wild", name: "Dark Blue / Green Wild", image: "wild_darkblue_green.webp", value: 4, wildColors: ["dark_blue", "green"] },
  // Green / Transport
  { id: "wild_green_trans_1", type: "wild", name: "Green / Transport Wild", image: "wild_green_transport.webp", value: 4, wildColors: ["green", "transport"] },
  // Transport / Utility
  { id: "wild_trans_util_1", type: "wild", name: "Transport / Utility Wild", image: "wild_transport_utility.webp", value: 2, wildColors: ["transport", "utility"] },
];

// ========== RENT CARDS (13) ==========
// NOTE: Rent card images not yet generated — using placeholder names
const rentCards: CardDef[] = [
  // 2x Brown / Light Blue Rent
  { id: "rent_brown_lb_1", type: "rent", name: "Brown / Light Blue Rent", image: "rent_brown_lightblue.webp", value: 1, rentColors: ["brown", "light_blue"] },
  { id: "rent_brown_lb_2", type: "rent", name: "Brown / Light Blue Rent", image: "rent_brown_lightblue.webp", value: 1, rentColors: ["brown", "light_blue"] },
  // 2x Pink / Orange Rent
  { id: "rent_pink_orange_1", type: "rent", name: "Pink / Orange Rent", image: "rent_pink_orange.webp", value: 1, rentColors: ["pink", "orange"] },
  { id: "rent_pink_orange_2", type: "rent", name: "Pink / Orange Rent", image: "rent_pink_orange.webp", value: 1, rentColors: ["pink", "orange"] },
  // 2x Red / Yellow Rent
  { id: "rent_red_yellow_1", type: "rent", name: "Red / Yellow Rent", image: "rent_red_yellow.webp", value: 1, rentColors: ["red", "yellow"] },
  { id: "rent_red_yellow_2", type: "rent", name: "Red / Yellow Rent", image: "rent_red_yellow.webp", value: 1, rentColors: ["red", "yellow"] },
  // 2x Green / Dark Blue Rent
  { id: "rent_green_db_1", type: "rent", name: "Green / Dark Blue Rent", image: "rent_green_darkblue.webp", value: 1, rentColors: ["green", "dark_blue"] },
  { id: "rent_green_db_2", type: "rent", name: "Green / Dark Blue Rent", image: "rent_green_darkblue.webp", value: 1, rentColors: ["green", "dark_blue"] },
  // 2x Transport / Utility Rent
  { id: "rent_trans_util_1", type: "rent", name: "Transport / Utility Rent", image: "rent_transport_utility.webp", value: 1, rentColors: ["transport", "utility"] },
  { id: "rent_trans_util_2", type: "rent", name: "Transport / Utility Rent", image: "rent_transport_utility.webp", value: 1, rentColors: ["transport", "utility"] },
  // 3x Rainbow Rent
  { id: "rent_rainbow_1", type: "rent", name: "Rainbow Rent", image: "rent_rainbow.webp", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_2", type: "rent", name: "Rainbow Rent", image: "rent_rainbow.webp", value: 3, rentColors: "rainbow" },
  { id: "rent_rainbow_3", type: "rent", name: "Rainbow Rent", image: "rent_rainbow.webp", value: 3, rentColors: "rainbow" },
];

// ========== ACTION CARDS (34) ==========
const actionCards: CardDef[] = [
  // 10x Felix Felicis (Pass Go)
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `action_felix_${i + 1}`,
    type: "action" as const,
    name: "Felix Felicis",
    image: "action_felix_felicis.webp",
    value: 1,
    actionType: "felix_felicis" as const,
  })),
  // 3x Accio (Sly Deal)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_accio_${i + 1}`,
    type: "action" as const,
    name: "Accio",
    image: "action_accio.webp",
    value: 3,
    actionType: "accio" as const,
  })),
  // 3x Confundus Charm (Force Deal)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_confundus_${i + 1}`,
    type: "action" as const,
    name: "Confundus Charm",
    image: "action_confundus_charm.webp",
    value: 3,
    actionType: "confundus_charm" as const,
  })),
  // 2x Expelliarmus (Deal Breaker)
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_expelliarmus_${i + 1}`,
    type: "action" as const,
    name: "Expelliarmus",
    image: "action_expelliarmus.webp",
    value: 5,
    actionType: "expelliarmus" as const,
  })),
  // 3x Protego (Just Say No)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_protego_${i + 1}`,
    type: "action" as const,
    name: "Protego",
    image: "action_protego.webp",
    value: 4,
    actionType: "protego" as const,
  })),
  // 3x Gringotts Goblin (Debt Collector)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_goblin_${i + 1}`,
    type: "action" as const,
    name: "Gringotts Goblin",
    image: "action_gringotts_goblin.webp",
    value: 3,
    actionType: "gringotts_goblin" as const,
  })),
  // 3x Yule Ball (It's My Birthday)
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_yule_${i + 1}`,
    type: "action" as const,
    name: "Yule Ball",
    image: "action_yule_ball.webp",
    value: 2,
    actionType: "yule_ball" as const,
  })),
  // 3x Reducto
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `action_reducto_${i + 1}`,
    type: "action" as const,
    name: "Reducto",
    image: "action_reducto.webp",
    value: 4,
    actionType: "reducto" as const,
  })),
  // 2x Silencio
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_silencio_${i + 1}`,
    type: "action" as const,
    name: "Silencio",
    image: "action_silencio.webp",
    value: 5,
    actionType: "silencio" as const,
  })),
  // 2x Time-Turner
  ...Array.from({ length: 2 }, (_, i) => ({
    id: `action_time_turner_${i + 1}`,
    type: "action" as const,
    name: "Time-Turner",
    image: "action_time_turner.webp",
    value: 2,
    actionType: "time_turner" as const,
  })),
];

// ========== ROLE CARDS (5) ==========
const roleCards: CardDef[] = [
  {
    id: "role_harry",
    type: "role",
    name: "Harry Potter",
    image: "role_boy_wizard.webp",
    value: 0,
    roleType: "harry",
    rolePower: "Protect one color at end of turn — immune to steal/rent actions. Can still voluntarily pay with protected properties. Owes nothing if only protected properties remain.",
  },
  {
    id: "role_hermione",
    type: "role",
    name: "Hermione Granger",
    image: "role_brightest_witch.webp",
    value: 0,
    roleType: "hermione",
    rolePower: "Play up to 4 actions per turn instead of 3.",
  },
  {
    id: "role_draco",
    type: "role",
    name: "Draco Malfoy",
    image: "role_cunning_rival.webp",
    value: 0,
    roleType: "draco",
    rolePower: "Can target properties in complete sets with Accio, Confundus, and Reducto.",
  },
  {
    id: "role_cedric",
    type: "role",
    name: "Cedric Diggory",
    image: "role_champion.webp",
    value: 0,
    roleType: "cedric",
    rolePower: "Choose to draw from deck OR pick top 2 from discard pile at start of turn.",
  },
  {
    id: "role_luna",
    type: "role",
    name: "Luna Lovegood",
    image: "role_dreamer.webp",
    value: 0,
    roleType: "luna",
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
