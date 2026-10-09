/**
 * Role power rules the server and the screen both need, so they always agree:
 * whether a power is on, Tharki's Shortcut (set sizes), Kanjar's friend and
 * Gandu's half price.
 */
import type { PlayerState, PropertyColor, RoleType } from "./schema";
import { SET_SIZES, PROPERTY_COLORS } from "./schema";

/** True when Power Outage has cut this role. It cuts the one role the attacker picked (older games: all of them). */
export function roleCut(player: PlayerState | undefined, role: RoleType | string): boolean {
  return !!player?.isSilenced && (!player.silencedRole || player.silencedRole === role);
}

// A role power only works while Power Outage hasn't cut it
export function roleActive(player: PlayerState | undefined, role: RoleType | string): boolean {
  if (!player || roleCut(player, role)) return false;
  const roles = player.roles ?? [];
  if (roles.includes(role as RoleType)) return true;
  // Lucha also has the power he copied at the end of his last turn, unless Lucha himself is cut
  return roles.includes("lucha") && !roleCut(player, "lucha") && !!player.borrowedRoles?.includes(role as RoleType);
}

/** Tharki's Shortcut colour, only while his power is switched on. */
export function shortcutOf(player: PlayerState | undefined): PropertyColor | undefined {
  return roleActive(player, "tharki") ? player!.shortcutColor : undefined;
}

/** Colours a Shortcut works on: only ones that need 3 or more cards (Gurjot: 2-card colours made Tharki too strong). */
export const canShortcut = (color: PropertyColor) => SET_SIZES[color] > 2;

/** Cards this player needs for a full set of a colour (one fewer on Tharki's Shortcut colour). */
export function setSizeFor(player: PlayerState | undefined, color: PropertyColor): number {
  const size = SET_SIZES[color];
  return shortcutOf(player) === color && canShortcut(color) ? size - 1 : size;
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

/** What a player pays for any charge (rent, Birthday, Debt Collector...): Gandu pays half, rounded up (there's no change). */
export function chargeOwedBy(player: PlayerState | undefined, amount: number): number {
  return roleActive(player, "gandu") ? Math.ceil(amount / 2) : amount;
}
