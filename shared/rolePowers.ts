/**
 * Role power rules the server and the screen both need, so they always agree:
 * whether a power is on, Tharki's Shortcut (set sizes), Kanjar's friend and
 * Gandu's half rent.
 */
import type { PlayerState, PropertyColor, RoleType } from "./schema";
import { SET_SIZES, PROPERTY_COLORS } from "./schema";

// A role power only works while the player isn't silenced
export function roleActive(player: PlayerState | undefined, role: RoleType | string): boolean {
  if (!player || player.isSilenced) return false;
  const roles = player.roles ?? [];
  // Lucha also has whichever powers he copied at the end of his last turn
  return roles.includes(role as RoleType) || (roles.includes("lucha") && !!player.borrowedRoles?.includes(role as RoleType));
}

/** Tharki's Shortcut colour, only while his power is switched on. */
export function shortcutOf(player: PlayerState | undefined): PropertyColor | undefined {
  return roleActive(player, "tharki") ? player!.shortcutColor : undefined;
}

/** Cards this player needs for a full set of a colour (one fewer on Tharki's Shortcut colour). */
export function setSizeFor(player: PlayerState | undefined, color: PropertyColor): number {
  const size = SET_SIZES[color];
  return shortcutOf(player) === color ? size - 1 : size;
}

/** Set sizes for every colour, for countCompleteSets. */
export function setSizesFor(player: PlayerState | undefined): Record<PropertyColor, number> {
  return Object.fromEntries(PROPERTY_COLORS.map(c => [c, setSizeFor(player, c)])) as Record<PropertyColor, number>;
}

/** Kanjar only plays in games of this many players or more (one on one he'd always be safe). */
export const KANJAR_MIN_PLAYERS = 3;

/** Kanjar's friend this round, only while his power is switched on. */
export function friendOf(player: PlayerState | undefined): string | undefined {
  return roleActive(player, "kanjar") ? player!.friendId : undefined;
}

/** True when `target` is Kanjar and `actor` is his friend: the actor can't charge him or act against him. */
export function sparedBy(actor: PlayerState | undefined, target: PlayerState | undefined): boolean {
  return !!actor && !!target && actor !== target && friendOf(target) === actor.visitorId;
}

/** What a player pays for a rent charge: Gandu pays half, rounded up (there's no change). */
export function rentOwedBy(player: PlayerState | undefined, amount: number): number {
  return roleActive(player, "gandu") ? Math.ceil(amount / 2) : amount;
}
