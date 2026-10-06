/**
 * Versions of the game the host can pick in the lobby. Each one names the
 * roles dealt to players and the cards in its draw pile.
 *
 * To add a role to a variation: add its id to RoleType in schema.ts, add its
 * role card (role_<id>) to cardDefs.ts, then list it in `roles` below. Its
 * power, if it has one, goes in worker/gameEngine.ts behind roleActive().
 *
 * To add a card to a variation: define it in cardDefs.ts with a new id, then
 * add that id to the variation's `deck`. One id is one copy of the card.
 *
 * To add a variation: add its id to VariationId in schema.ts and an entry here.
 */
import type { RoleType, VariationId } from "./schema";
import { CLASSIC_DECK } from "./cardDefs";

export interface Variation {
  id: VariationId;
  name: string;
  description: string; // one line, shown in the lobby
  roles: RoleType[];   // dealt at random; repeats when there are more players than roles
  deck: string[];      // card ids in the draw pile
}

export const VARIATIONS: Record<VariationId, Variation> = {
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
};

export const DEFAULT_VARIATION: VariationId = "classic";
export const VARIATION_IDS = Object.keys(VARIATIONS) as VariationId[];

export const isVariationId = (v: unknown): v is VariationId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(VARIATIONS, v);

/** The variation a game or room is using; older saves have none and are classic. */
export const variationOf = (id?: string): Variation =>
  isVariationId(id) ? VARIATIONS[id] : VARIATIONS[DEFAULT_VARIATION];
