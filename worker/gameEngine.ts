/**
 * Game Engine — Server-authoritative game logic for HP Monopoly Deal.
 * All mutations happen here; clients send intents, engine validates & applies.
 */
import { v4 as uuidv4 } from "uuid";
import type {
  GameState, PlayerState, GameCard, PendingAction, PaymentResult,
  PropertyColor, RoleType, AnimalProfile, VariationId, CustomRules,
} from "../shared/schema";
import { SET_SIZES, RENT_TABLE, PROPERTY_COLORS, freshTurnTimer } from "../shared/schema";
import { CARD_DEF_MAP, getEffectiveColor, countCompleteSets } from "../shared/cardDefs";
import { gameSetup, type GameSetup } from "../shared/variations";

type Result = { success: boolean; error?: string };
const ok: Result = { success: true };
const fail = (error: string): Result => ({ success: false, error });

const PAYMENT_TYPES = ["pay_rent", "pay_debt", "pay_birthday"];
const COLOR_LABEL: Record<PropertyColor, string> = {
  brown: "Brown", light_blue: "Light Blue", pink: "Pink", orange: "Orange", red: "Red",
  yellow: "Yellow", green: "Green", dark_blue: "Dark Blue", transport: "Railroad", utility: "Utility",
};

// ========== HELPERS ==========

// Log tokens the client draws as colour chips: [[colour]] or [[colour|card name]].
const colorTag = (color: PropertyColor) => `[[${color}]]`;
function cardTag(card: GameCard | undefined, defId?: string): string {
  const def = CARD_DEF_MAP[card?.defId ?? defId ?? ""];
  if (!def) return "a card";
  const color = card ? getEffectiveColor(card) : def.color;
  return color ? `[[${color}|${def.name}]]` : def.name;
}
const ownedTag = (owner: PlayerState, defId: string) => cardTag(owner.properties.find(c => c.defId === defId), defId);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addEvent(state: GameState, playerEmoji: string, playerName: string, playerColor: string, message: string, cardDefId?: string) {
  state.eventLog.push({
    id: uuidv4(),
    timestamp: Date.now(),
    playerEmoji,
    playerName,
    playerColor,
    message,
    cardDefId,
  });
  // Keep last 100 events
  if (state.eventLog.length > 100) {
    state.eventLog = state.eventLog.slice(-100);
  }
}

function log(state: GameState, player: PlayerState, message: string, cardDefId?: string) {
  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass, message, cardDefId);
}

function getPlayer(state: GameState, visitorId: string): PlayerState | undefined {
  return state.players.find(p => p.visitorId === visitorId);
}

function getCurrentPlayer(state: GameState): PlayerState | undefined {
  return state.players[state.currentTurnIndex];
}

function isCurrentTurn(state: GameState, visitorId: string): boolean {
  return getCurrentPlayer(state)?.visitorId === visitorId;
}

// A role power only works while the player isn't silenced
export function roleActive(player: PlayerState | undefined, role: RoleType): boolean {
  if (!player || player.isSilenced) return false;
  // Lucha also has whichever powers he copied at the end of his last turn
  return player.roles.includes(role) || (player.roles.includes("lucha") && !!player.borrowedRoles?.includes(role));
}

// Harry's shielded colour, only while his power is switched on
export function shieldOf(player: PlayerState): PropertyColor | undefined {
  return roleActive(player, "harry") ? player.protectedColor : undefined;
}

function maxActionsFor(player: PlayerState): number {
  return roleActive(player, "hermione") ? 4 : 3;
}

function getPropertiesOfColor(player: PlayerState, color: PropertyColor): GameCard[] {
  return player.properties.filter(card => getEffectiveColor(card) === color);
}

function isSetComplete(player: PlayerState, color: PropertyColor): boolean {
  return getPropertiesOfColor(player, color).length >= SET_SIZES[color];
}

export function calculateRent(player: PlayerState, color: PropertyColor): number {
  const count = getPropertiesOfColor(player, color).length;
  const table = RENT_TABLE[color];
  if (count === 0) return 0;
  return table[Math.min(count, table.length) - 1];
}

function cardValue(card: GameCard): number {
  return CARD_DEF_MAP[card.defId]?.value ?? 0;
}

function totalValue(cards: GameCard[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
}

function hasProtego(player: PlayerState | undefined): boolean {
  return !!player && player.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");
}

function removeCard(arr: GameCard[], defId: string): GameCard | undefined {
  const idx = arr.findIndex(c => c.defId === defId);
  if (idx === -1) return undefined;
  return arr.splice(idx, 1)[0];
}

function drawFromPile(state: GameState): GameCard | null {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.drawPile = shuffle(state.discardPile);
    state.discardPile = [];
    addEvent(state, "🔄", "System", "#888", "Draw pile reshuffled from discard pile");
  }
  return state.drawPile.pop() ?? null;
}

// Cards a player must use when they owe money. Harry's shielded colour is
// excluded: he may pay with it, but can't be forced to.
function payableCards(player: PlayerState): GameCard[] {
  const shield = shieldOf(player);
  return [...player.bank, ...player.properties.filter(c => !shield || getEffectiveColor(c) !== shield)];
}

// ========== CREATE GAME ==========

export function createInitialGameState(
  roomCode: string,
  players: { visitorId: string; seatIndex: number; animal: AnimalProfile; isBot?: boolean; pickedRoles?: RoleType[] }[],
  gameSpeed: number,
  variationId?: VariationId,
  custom?: CustomRules,
): GameState {
  const setup = gameSetup(variationId, custom);
  const drawPile: GameCard[] = shuffle(setup.deck).map(id => ({ defId: id }));
  const roles = dealRoles(setup, players);

  const playerStates: PlayerState[] = players.map((p, i) => ({
    visitorId: p.visitorId,
    seatIndex: p.seatIndex,
    animal: p.animal,
    roles: roles[i],
    hand: [],
    properties: [],
    bank: [],
    isReady: false,
    isSleeping: !!p.isBot,
    isBot: !!p.isBot,
    isConnected: true,
    protectedColor: undefined,
    isSilenced: false,
  }));

  const state: GameState = {
    roomCode,
    status: "playing",
    players: playerStates,
    spectators: [],
    currentTurnIndex: 0,
    actionsUsed: 0,
    maxActions: 3,
    drawnThisTurn: false,
    drawPile,
    discardPile: [],
    pendingAction: null,
    turnTimer: gameSpeed,
    gameSpeed,
    eventLog: [],
    chatMessages: [],
    winnerId: null,
    variation: setup.variation,
    roleCards: setup.roles,
    freePlayCardId: null,
  };

  for (const player of state.players) {
    for (let i = 0; i < 5; i++) {
      const card = drawFromPile(state);
      if (card) player.hand.push(card);
    }
  }

  state.maxActions = maxActionsFor(getCurrentPlayer(state)!);
  state.turnTimer = freshTurnTimer(state);
  addEvent(state, "⚡", "System", "#FFD700", "The game begins! Wands at the ready...");
  return state;
}

/**
 * Roles for each player. When players choose, they keep their picks from the
 * roles in play (bots get one at random). Otherwise each player is dealt
 * rolesPerPlayer different roles, spread so no role repeats until all are out.
 */
function dealRoles(setup: GameSetup, players: { isBot?: boolean; pickedRoles?: RoleType[] }[]): RoleType[][] {
  const pool = setup.roles;
  if (pool.length === 0) return players.map(() => []);
  const used = new Map<RoleType, number>(pool.map(r => [r, 0]));
  const take = (n: number): RoleType[] => {
    const order = shuffle(pool).sort((a, b) => used.get(a)! - used.get(b)!);
    const picked = order.slice(0, Math.min(n, pool.length));
    for (const r of picked) used.set(r, used.get(r)! + 1);
    return picked;
  };
  return players.map(p => {
    if (setup.roleMode === "choose" && !p.isBot) return pool.filter(r => p.pickedRoles?.includes(r));
    return take(setup.roleMode === "choose" ? 1 : setup.rolesPerPlayer);
  });
}

// ========== WHO THE GAME IS WAITING ON ==========

/** The player whose input the game needs next. */
export function getWaitingOn(state: GameState): string | null {
  if (state.status !== "playing") return null;
  const p = state.pendingAction;
  if (!p) return getCurrentPlayer(state)?.visitorId ?? null;
  if (p.type.startsWith("choose_") || p.type === "time_turner_play") return p.sourcePlayerId;
  return p.targetPlayerId;
}

// ========== TURN MANAGEMENT ==========

function canAct(state: GameState, visitorId: string): Result {
  if (state.status !== "playing") return fail("The game is over");
  if (!isCurrentTurn(state, visitorId)) return fail("Not your turn");
  if (state.pendingAction) return fail("Waiting on another action to finish");
  return ok;
}

export function drawCards(state: GameState, visitorId: string): Result {
  const check = canAct(state, visitorId);
  if (!check.success) return check;
  if (state.drawnThisTurn) return fail("Already drew cards this turn");

  const player = getPlayer(state, visitorId)!;
  // Empty hand at the start of a turn: draw 5 instead
  const drawCount = player.hand.length === 0 ? 5 : roleActive(player, "luna") ? 3 : 2;
  let drawn = 0;
  for (let i = 0; i < drawCount; i++) {
    const card = drawFromPile(state);
    if (card) { player.hand.push(card); drawn++; }
  }
  state.drawnThisTurn = true;
  log(state, player, `drew ${drawn} cards`);
  return ok;
}

/** The extra ways a player may draw at the start of their turn (besides the deck). */
export function drawOptions(state: GameState, player: PlayerState): { discard: boolean; opponent: boolean } {
  if (player.hand.length === 0) return { discard: false, opponent: false }; // empty hand: draw 5 from the deck
  return {
    discard: roleActive(player, "cedric") && state.discardPile.length > 0,
    opponent: roleActive(player, "ganda") && state.players.some(p => p.visitorId !== player.visitorId && p.hand.length > 0),
  };
}

export function cedricChooseSource(state: GameState, visitorId: string, source: "deck" | "discard" | "opponent", targetId?: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "cedric_draw_choice" || pending.targetPlayerId !== visitorId) {
    return fail("Nothing to choose right now");
  }
  const player = getPlayer(state, visitorId)!;
  state.pendingAction = null;

  if (source === "discard" && roleActive(player, "cedric") && state.discardPile.length > 0) {
    // The discard pile is face up, so everyone sees what Cedric picked up
    const taken: string[] = [];
    for (let i = 0; i < 2 && state.discardPile.length > 0; i++) {
      const card = state.discardPile.pop()!;
      player.hand.push(card);
      taken.push(CARD_DEF_MAP[card.defId]?.name ?? "a card");
    }
    state.drawnThisTurn = true;
    log(state, player, `used Cedric's power to take ${taken.join(" and ")} from the discard pile`);
    return ok;
  }
  if (source === "opponent") {
    const target = getPlayer(state, targetId ?? "");
    if (!roleActive(player, "ganda") || !target || target === player || target.hand.length === 0) {
      state.pendingAction = pending;
      return fail("Pick a player who has cards in their hand");
    }
    const [card] = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1);
    player.hand.push(card);
    state.drawnThisTurn = true;
    log(state, player, `used Ganda's power to take a random card from ${target.animal.name}'s hand`);
    return ok;
  }
  return drawCards(state, visitorId);
}

/** The draw timer ran out: draw for the current player. Never makes a choice for them (e.g. Cedric's). */
export function autoDraw(state: GameState): Result {
  const player = getCurrentPlayer(state);
  if (!player) return fail("No one to draw for");
  return drawCards(state, player.visitorId);
}

// Time-Turner: the retrieved card is played for free, and must be played next
function freePlayGuard(state: GameState, cardDefId: string): Result {
  if (state.freePlayCardId && state.freePlayCardId !== cardDefId) {
    const name = CARD_DEF_MAP[state.freePlayCardId]?.name ?? "the card";
    return fail(`Play ${name} from Rewind first`);
  }
  return ok;
}

function withFreePlay(state: GameState, cardDefId: string, run: () => Result): Result {
  const free = state.freePlayCardId === cardDefId;
  const before = state.actionsUsed;
  const result = run();
  if (free && result.success) {
    state.actionsUsed = before;
    state.freePlayCardId = null;
  }
  return result;
}

export function playCard(state: GameState, visitorId: string, cardDefId: string, _asProperty?: boolean, targetColor?: PropertyColor): Result {
  const check = canAct(state, visitorId);
  if (!check.success) return check;
  if (!state.drawnThisTurn) return fail("Draw your cards first");
  const guard = freePlayGuard(state, cardDefId);
  if (!guard.success) return guard;
  const free = state.freePlayCardId === cardDefId;
  if (!free && state.actionsUsed >= state.maxActions) return fail("No actions left this turn");

  const player = getPlayer(state, visitorId)!;
  if (!player.hand.some(c => c.defId === cardDefId)) return fail("Card not in hand");
  const def = CARD_DEF_MAP[cardDefId];
  if (!def) return fail("Unknown card");

  return withFreePlay(state, cardDefId, () => {
    switch (def.type) {
      case "money":
        removeCard(player.hand, cardDefId);
        player.bank.push({ defId: cardDefId });
        state.actionsUsed++;
        log(state, player, `banked ${def.name}`, def.id);
        return ok;

      case "property":
        removeCard(player.hand, cardDefId);
        player.properties.push({ defId: cardDefId, assignedColor: def.color });
        state.actionsUsed++;
        log(state, player, `played ${cardTag(undefined, cardDefId)}`, def.id);
        checkWinCondition(state, visitorId);
        return ok;

      case "wild":
        return playWildCard(state, player, cardDefId, targetColor);

      case "rent":
        return playRentCard(state, player, cardDefId, targetColor);

      case "action":
        return playActionCard(state, player, cardDefId);

      default:
        return fail("Cannot play this card type");
    }
  });
}

function playWildCard(state: GameState, player: PlayerState, cardDefId: string, targetColor?: PropertyColor): Result {
  const def = CARD_DEF_MAP[cardDefId];
  let color: PropertyColor | undefined;
  if (def.wildColors === "rainbow") {
    if (!targetColor || !PROPERTY_COLORS.includes(targetColor)) return fail("Choose a colour for the wild card");
    color = targetColor;
  } else if (Array.isArray(def.wildColors)) {
    color = targetColor && def.wildColors.includes(targetColor) ? targetColor : def.wildColors[0];
  }
  if (!color) return fail("Invalid colour");
  removeCard(player.hand, cardDefId);
  player.properties.push({ defId: cardDefId, assignedColor: color });
  state.actionsUsed++;
  log(state, player, `played ${def.name} as ${colorTag(color)}`, def.id);
  checkWinCondition(state, player.visitorId);
  return ok;
}

function rentColorsOf(defId: string): PropertyColor[] {
  const def = CARD_DEF_MAP[defId];
  if (def?.type !== "rent") return [];
  return def.rentColors === "rainbow" ? [...PROPERTY_COLORS] : [...(def.rentColors as PropertyColor[])];
}

function playRentCard(state: GameState, player: PlayerState, cardDefId: string, targetColor?: PropertyColor): Result {
  const def = CARD_DEF_MAP[cardDefId];
  let rentColor: PropertyColor | undefined;

  if (def.rentColors === "rainbow") {
    if (!targetColor) return fail("Choose a colour to charge rent for");
    rentColor = targetColor;
  } else if (Array.isArray(def.rentColors)) {
    const [c1, c2] = def.rentColors;
    if (targetColor && (def.rentColors as PropertyColor[]).includes(targetColor)) rentColor = targetColor;
    else rentColor = calculateRent(player, c1) >= calculateRent(player, c2) ? c1 : c2;
  }
  if (!rentColor) return fail("Invalid rent colour");

  const baseRent = calculateRent(player, rentColor);
  if (baseRent === 0) return fail(`You have no ${COLOR_LABEL[rentColor]} properties, so the rent would be 0`);
  const multiplier = state.rentMultiplier ?? 1;
  const rentAmount = baseRent * multiplier;

  removeCard(player.hand, cardDefId);
  state.discardPile.push({ defId: cardDefId });
  state.actionsUsed++;
  state.rentMultiplier = undefined;
  const doubled = multiplier > 1 ? ` (${multiplier === 2 ? "doubled" : `${multiplier}x`})` : "";
  log(state, player, `charged everyone ${rentAmount}M ${colorTag(rentColor)} rent${doubled}`, def.id);

  // Every other player pays, one at a time
  const targets = state.players.filter(p => p.visitorId !== player.visitorId).map(p => p.visitorId);
  startPayments(state, "pay_rent", player.visitorId, targets, rentAmount, cardDefId, rentColor);
  return ok;
}

// Set up a queue of payers. Skips anyone Harry's shield protects from this rent.
function startPayments(state: GameState, type: "pay_rent" | "pay_debt" | "pay_birthday", sourceId: string, targets: string[], amount: number, cardDefId: string, rentColor?: PropertyColor) {
  const payment: PendingAction = {
    type,
    sourcePlayerId: sourceId,
    targetPlayerId: "",
    amount,
    cardDefId,
    data: { rentColor, remainingTargets: [...targets], allTargets: [...targets], results: [] as PaymentResult[] },
  };
  nextPayer(state, payment);
}

function nextPayer(state: GameState, payment: PendingAction) {
  const data = payment.data;
  while (data.remainingTargets.length > 0) {
    const nextId: string = data.remainingTargets.shift();
    const next = getPlayer(state, nextId);
    if (!next) continue;
    if (payment.type === "pay_rent" && data.rentColor && shieldOf(next) === data.rentColor) {
      log(state, next, `is shielded from ${colorTag(data.rentColor as PropertyColor)} rent by Harry's charm`);
      data.results.push({ playerId: nextId, outcome: "shielded", amount: 0 });
      continue;
    }
    state.pendingAction = { ...payment, targetPlayerId: nextId, data: { ...data } };
    return;
  }
  state.pendingAction = null;
}

function playActionCard(state: GameState, player: PlayerState, cardDefId: string): Result {
  const def = CARD_DEF_MAP[cardDefId];
  const others = state.players.filter(p => p.visitorId !== player.visitorId);

  // Actions that need a target can't be played if nobody has a valid target
  const discardIt = () => {
    removeCard(player.hand, cardDefId);
    state.discardPile.push({ defId: cardDefId });
    state.actionsUsed++;
  };
  const choose = (type: PendingAction["type"], message: string) => {
    discardIt();
    state.pendingAction = {
      type, sourcePlayerId: player.visitorId, targetPlayerId: player.visitorId, cardDefId,
      data: { free: state.freePlayCardId === cardDefId },
    };
    log(state, player, message, def.id);
    return ok;
  };

  switch (def.actionType) {
    case "felix_felicis": {
      discardIt();
      let drawn = 0;
      for (let i = 0; i < 2; i++) {
        const card = drawFromPile(state);
        if (card) { player.hand.push(card); drawn++; }
      }
      log(state, player, `played Pass Go and drew ${drawn} extra cards`, def.id);
      return ok;
    }

    case "accio":
      if (!others.some(o => o.properties.some(c => canTakeProperty(player, o, c.defId).success))) {
        return fail("No one has a property you can take");
      }
      return choose("choose_steal", "played Sly Deal and is choosing a property to take");

    case "confundus_charm":
      if (player.properties.length === 0) return fail("You need a property of your own to swap");
      if (!others.some(o => o.properties.some(c => canTakeProperty(player, o, c.defId).success))) {
        return fail("No one has a property you can swap for");
      }
      return choose("choose_swap", "played Forced Deal and is choosing properties to swap");

    case "expelliarmus":
      if (!others.some(o => PROPERTY_COLORS.some(c => isSetComplete(o, c) && shieldOf(o) !== c))) {
        return fail("No one has a complete set you can take");
      }
      return choose("choose_steal_set", "played Deal Breaker and is choosing a set to take");

    case "gringotts_goblin":
      if (others.length === 0) return fail("No one to collect from");
      return choose("choose_goblin", "played Debt Collector and is choosing who owes 5M");

    case "reducto":
      if (!others.some(o => o.properties.some(c => canTakeProperty(player, o, c.defId).success))) {
        return fail("No one has a property you can destroy");
      }
      return choose("choose_reducto", "played Demolish and is choosing what to destroy");

    case "silencio":
      if (!others.some(o => !o.isSilenced)) return fail("Everyone's power is already off");
      return choose("choose_silencio", "played Power Outage and is choosing whose power to cut");

    case "yule_ball": {
      discardIt();
      log(state, player, "played It's My Birthday. Everyone pays 2M", def.id);
      startPayments(state, "pay_birthday", player.visitorId, others.map(o => o.visitorId), 2, cardDefId);
      return ok;
    }

    case "time_turner": {
      const choices = state.discardPile.filter(c => CARD_DEF_MAP[c.defId]?.actionType !== "time_turner");
      if (choices.length === 0) return fail("There's nothing in the discard pile to take");
      return choose("time_turner_play", "played Rewind and is choosing a card from the discard pile");
    }

    case "double_rent": {
      const rents = player.hand.filter(c => CARD_DEF_MAP[c.defId]?.type === "rent");
      if (rents.length === 0) return fail("You need a rent card in your hand to double");
      if (!rents.some(c => rentColorsOf(c.defId).some(col => calculateRent(player, col) > 0))) {
        return fail("You have no properties to charge rent for yet");
      }
      // This card and the rent card both use a play (unless this one came free from Rewind)
      const needed = state.freePlayCardId === cardDefId ? 1 : 2;
      if (state.actionsUsed + needed > state.maxActions) return fail("You need a play left for the rent card too");
      discardIt();
      state.rentMultiplier = (state.rentMultiplier ?? 1) * 2;
      log(state, player, "played Double the Rent. Their next rent is doubled", def.id);
      return ok;
    }

    case "protego":
      // Protego is played in response to an attack; on your own turn it can only be banked
      removeCard(player.hand, cardDefId);
      player.bank.push({ defId: cardDefId });
      state.actionsUsed++;
      log(state, player, `banked Just Say No (${def.value}M)`, def.id);
      return ok;

    default:
      return fail("Unknown action type");
  }
}

export function bankCard(state: GameState, visitorId: string, cardDefId: string): Result {
  const check = canAct(state, visitorId);
  if (!check.success) return check;
  if (!state.drawnThisTurn) return fail("Draw your cards first");
  const guard = freePlayGuard(state, cardDefId);
  if (!guard.success) return guard;
  const free = state.freePlayCardId === cardDefId;
  if (!free && state.actionsUsed >= state.maxActions) return fail("No actions left this turn");

  const player = getPlayer(state, visitorId)!;
  const def = CARD_DEF_MAP[cardDefId];
  if (!def || !player.hand.some(c => c.defId === cardDefId)) return fail("Card not in hand");
  if (def.type === "property" || def.type === "wild") return fail("Properties can't go in the bank");
  if (def.value === 0) return fail("This card has no bank value");

  return withFreePlay(state, cardDefId, () => {
    player.bank.push(removeCard(player.hand, cardDefId)!);
    state.actionsUsed++;
    log(state, player, `banked ${def.name} (${def.value}M)`, def.id);
    return ok;
  });
}

export function endTurn(state: GameState, visitorId: string): Result {
  const check = canAct(state, visitorId);
  if (!check.success) return check;
  if (!state.drawnThisTurn) return fail("Draw your cards first");
  if (state.freePlayCardId) return fail("Play the card you took with Rewind first");

  const player = getPlayer(state, visitorId)!;
  if (roleActive(player, "lucha") && luchaChoices(state, player).length > 0) {
    state.pendingAction = { type: "lucha_choose", sourcePlayerId: visitorId, targetPlayerId: visitorId };
    return ok;
  }
  return harryThenFinalize(state, visitorId);
}

function harryThenFinalize(state: GameState, visitorId: string): Result {
  const player = getPlayer(state, visitorId)!;
  if (roleActive(player, "harry")) {
    state.pendingAction = { type: "harry_protect", sourcePlayerId: visitorId, targetPlayerId: visitorId };
    return ok;
  }
  return finalizeTurn(state, visitorId);
}

/** Players Lucha may copy: anyone else, but not the same player twice in a row unless it's one on one. */
export function luchaChoices(state: GameState, lucha: PlayerState): PlayerState[] {
  const others = state.players.filter(p => p.visitorId !== lucha.visitorId);
  return others.length > 1 ? others.filter(p => p.visitorId !== lucha.borrowedFrom) : others;
}

export function luchaChoose(state: GameState, visitorId: string, targetId: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "lucha_choose" || pending.targetPlayerId !== visitorId) return fail("Nothing to copy right now");
  const player = getPlayer(state, visitorId)!;
  const target = luchaChoices(state, player).find(p => p.visitorId === targetId);
  if (!target) return fail("Pick someone you didn't copy last time");

  player.borrowedRoles = target.roles.filter(r => r !== "lucha");
  player.borrowedFrom = target.visitorId;
  // A shield only lasts while Lucha has Harry's power
  if (!roleActive(player, "harry")) player.protectedColor = undefined;
  const names = player.borrowedRoles.map(r => CARD_DEF_MAP[`role_${r}`]?.name ?? r).join(" and ");
  log(state, player, names
    ? `copied ${target.animal.name}'s power (${names}) for their next turn`
    : `copied ${target.animal.name}, who has no power to copy, for their next turn`);
  state.pendingAction = null;
  return harryThenFinalize(state, visitorId);
}

function finalizeTurn(state: GameState, visitorId: string): Result {
  const player = getPlayer(state, visitorId)!;
  if (player.hand.length > 7) {
    state.pendingAction = {
      type: "discard_excess",
      sourcePlayerId: visitorId,
      targetPlayerId: visitorId,
      data: { mustDiscard: player.hand.length - 7 },
    };
    return ok;
  }
  advanceTurn(state);
  return ok;
}

function advanceTurn(state: GameState) {
  const currentPlayer = getCurrentPlayer(state);
  if (currentPlayer) log(state, currentPlayer, "ended their turn");

  state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
  beginTurn(state);
}

// Start the turn of whoever currentTurnIndex now points at
function beginTurn(state: GameState) {
  state.actionsUsed = 0;
  state.drawnThisTurn = false;
  state.pendingAction = null;
  state.freePlayCardId = null;
  state.rentMultiplier = undefined;

  const next = getCurrentPlayer(state)!;
  state.maxActions = maxActionsFor(next);
  log(state, next, "starts their turn");

  const options = drawOptions(state, next);
  if (options.discard || options.opponent) {
    state.pendingAction = { type: "cedric_draw_choice", sourcePlayerId: next.visitorId, targetPlayerId: next.visitorId, data: options };
  }
  state.turnTimer = freshTurnTimer(state);
}

// ========== FLIP WILD ==========

export function flipWild(state: GameState, visitorId: string, cardDefId: string, newColor: PropertyColor): Result {
  // Flipping a wild is free, but only on your own turn
  if (state.status !== "playing") return fail("The game is over");
  const player = getPlayer(state, visitorId);
  if (!player) return fail("Player not found");
  if (!isCurrentTurn(state, visitorId)) return fail("You can only move wilds on your turn");
  const card = player.properties.find(c => c.defId === cardDefId);
  if (!card) return fail("Card not in your properties");
  const def = CARD_DEF_MAP[cardDefId];
  if (!def || def.type !== "wild") return fail("Not a wild card");
  if (!PROPERTY_COLORS.includes(newColor)) return fail("Invalid colour");
  if (Array.isArray(def.wildColors) && !def.wildColors.includes(newColor)) {
    return fail(`This wild can only be ${def.wildColors.map(c => COLOR_LABEL[c]).join(" or ")}`);
  }
  if (card.assignedColor === newColor) return ok;
  card.assignedColor = newColor;
  log(state, player, `moved ${def.name} to ${colorTag(newColor)}`, def.id);
  checkWinCondition(state, visitorId);
  return ok;
}

// ========== PAYMENT SYSTEM ==========

export function payWithCards(state: GameState, visitorId: string, cardDefIds: string[]): Result {
  const pending = state.pendingAction;
  if (!pending || !PAYMENT_TYPES.includes(pending.type)) return fail("Nothing to pay right now");
  if (pending.targetPlayerId !== visitorId) return fail("Not your payment to make");

  const player = getPlayer(state, visitorId)!;
  const source = getPlayer(state, pending.sourcePlayerId)!;
  const amount = pending.amount ?? 0;
  const ids = Array.from(new Set(cardDefIds || []));

  const chosen: GameCard[] = [];
  for (const id of ids) {
    const card = player.bank.find(c => c.defId === id) ?? player.properties.find(c => c.defId === id);
    if (!card) return fail("One of those cards isn't in your bank or properties");
    chosen.push(card);
  }
  const paid = totalValue(chosen);

  // You pay the full amount if you can. If you can't, you hand over everything
  // you're required to pay with. No change is given.
  if (paid < amount) {
    const required = payableCards(player);
    const missing = required.filter(c => !ids.includes(c.defId));
    if (missing.length > 0) {
      return fail(`You owe ${amount}M. Pick at least ${amount}M, or everything you have if you can't cover it`);
    }
  }

  for (const card of chosen) {
    if (removeCard(player.bank, card.defId)) source.bank.push(card);
    else if (removeCard(player.properties, card.defId)) source.properties.push(card);
  }

  if (chosen.length === 0) log(state, player, `had nothing to pay ${source.animal.name} with`);
  else log(state, player, `paid ${source.animal.name} ${paid}M`);
  pending.data = pending.data ?? { remainingTargets: [], results: [] };
  pending.data.results = [...(pending.data.results ?? []), { playerId: visitorId, outcome: chosen.length ? "paid" : "nothing", amount: paid }];

  checkWinCondition(state, source.visitorId);
  if (state.status !== "playing") { state.pendingAction = null; return ok; }
  nextPayer(state, pending);
  return ok;
}

// ========== PROTEGO (Just Say No) ==========
// An attack waits in a "protego_response" while the defender (and then the
// attacker, and so on) may cancel it. An even number of Protegos means the
// original action happens; an odd number cancels it.

function offerProtego(state: GameState, original: PendingAction) {
  const defender = getPlayer(state, original.targetPlayerId);
  if (hasProtego(defender)) {
    state.pendingAction = {
      type: "protego_response",
      sourcePlayerId: original.sourcePlayerId,
      targetPlayerId: original.targetPlayerId,
      cardDefId: original.cardDefId,
      data: { originalAction: original, blocks: 0 },
    };
  } else {
    executeAction(state, original);
  }
}

export function playProtego(state: GameState, visitorId: string): Result {
  const pending = state.pendingAction;
  if (!pending) return fail("Nothing to block right now");
  if (pending.targetPlayerId !== visitorId) return fail("That action isn't aimed at you");

  let original: PendingAction;
  let blocks: number;
  if (pending.type === "protego_response") {
    original = pending.data.originalAction;
    blocks = pending.data.blocks ?? 0;
  } else if (PAYMENT_TYPES.includes(pending.type)) {
    original = pending;
    blocks = 0;
  } else {
    return fail("Just Say No can't block this");
  }

  const player = getPlayer(state, visitorId)!;
  const idx = player.hand.findIndex(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");
  if (idx === -1) return fail("You don't have a Just Say No");
  state.discardPile.push(player.hand.splice(idx, 1)[0]);
  blocks++;
  log(state, player, blocks % 2 === 1 ? "said Just Say No to block it" : "said Just Say No back to push it through", "action_protego_1");

  // The other side may answer with their own Protego
  const nextResponder = blocks % 2 === 1 ? original.sourcePlayerId : original.targetPlayerId;
  if (hasProtego(getPlayer(state, nextResponder))) {
    state.pendingAction = {
      type: "protego_response",
      sourcePlayerId: original.sourcePlayerId,
      targetPlayerId: nextResponder,
      cardDefId: original.cardDefId,
      data: { originalAction: original, blocks },
    };
    return ok;
  }
  resolveProtego(state, original, blocks);
  return ok;
}

export function declineProtego(state: GameState, visitorId: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "protego_response") return fail("Nothing to decide right now");
  if (pending.targetPlayerId !== visitorId) return fail("Not your decision");
  resolveProtego(state, pending.data.originalAction, pending.data.blocks ?? 0);
  return ok;
}

function resolveProtego(state: GameState, original: PendingAction, blocks: number) {
  if (blocks % 2 === 0) {
    executeAction(state, original);
    return;
  }
  const target = getPlayer(state, original.targetPlayerId);
  addEvent(state, "🛡️", "Just Say No", "#888", `${target?.animal.name ?? "The target"} is protected. The action is cancelled`);
  if (PAYMENT_TYPES.includes(original.type)) {
    original.data.results = [...(original.data.results ?? []), { playerId: original.targetPlayerId, outcome: "blocked", amount: 0 }];
    nextPayer(state, original);
  } else {
    state.pendingAction = null;
  }
}

// Carry out an attack once it's no longer blocked
function executeAction(state: GameState, action: PendingAction) {
  const attacker = getPlayer(state, action.sourcePlayerId);
  const target = getPlayer(state, action.targetPlayerId);
  state.pendingAction = null;
  if (!attacker || !target) return;
  const d = action.data ?? {};

  if (PAYMENT_TYPES.includes(action.type)) {
    // Payment goes back to the payer to choose cards
    state.pendingAction = action;
    return;
  }

  switch (action.type) {
    case "choose_steal": {
      const check = canTakeProperty(attacker, target, d.targetCardDefId);
      if (!check.success) { log(state, attacker, `'s Sly Deal fizzled: ${check.error}`); return; }
      const card = removeCard(target.properties, d.targetCardDefId)!;
      attacker.properties.push(card);
      log(state, attacker, `used Sly Deal to take ${cardTag(card)} from ${target.animal.name}`, card.defId);
      checkWinCondition(state, attacker.visitorId);
      return;
    }
    case "choose_swap": {
      const check = canTakeProperty(attacker, target, d.targetCardDefId);
      const ours = attacker.properties.find(c => c.defId === d.ownCardDefId);
      if (!check.success || !ours) { log(state, attacker, "'s Forced Deal fizzled"); return; }
      const theirs = removeCard(target.properties, d.targetCardDefId)!;
      removeCard(attacker.properties, d.ownCardDefId);
      attacker.properties.push(theirs);
      target.properties.push(ours);
      log(state, attacker, `used Forced Deal to swap their ${cardTag(ours)} for ${target.animal.name}'s ${cardTag(theirs)}`);
      checkWinCondition(state, attacker.visitorId);
      if (state.status === "playing") checkWinCondition(state, target.visitorId);
      return;
    }
    case "choose_steal_set": {
      const color = d.color as PropertyColor;
      if (!isSetComplete(target, color) || shieldOf(target) === color) { log(state, attacker, "'s Deal Breaker fizzled"); return; }
      const stolen = target.properties.filter(c => getEffectiveColor(c) === color);
      target.properties = target.properties.filter(c => getEffectiveColor(c) !== color);
      attacker.properties.push(...stolen);
      log(state, attacker, `used Deal Breaker to take ${target.animal.name}'s ${colorTag(color)} set`);
      checkWinCondition(state, attacker.visitorId);
      return;
    }
    case "choose_reducto": {
      const id = d.targetCardDefId as string;
      if (!canTakeProperty(attacker, target, id).success) { log(state, attacker, "'s Demolish fizzled"); return; }
      const card = removeCard(target.properties, id)!;
      state.discardPile.push({ defId: card.defId });
      log(state, attacker, `used Demolish to destroy ${target.animal.name}'s ${cardTag(card)}`, card.defId);
      return;
    }
    case "choose_silencio": {
      target.isSilenced = true;
      log(state, attacker, `cut ${target.animal.name}'s power. Their role power is off until they pay 10M`);
      // Silencing the current player mid-turn would only happen through odd timing, but keep actions consistent
      if (isCurrentTurn(state, target.visitorId)) state.maxActions = maxActionsFor(target);
      return;
    }
  }
}

// ========== TARGET SELECTION ==========

function canTakeProperty(attacker: PlayerState, target: PlayerState, cardDefId: string): Result {
  const card = target.properties.find(c => c.defId === cardDefId);
  if (!card) return fail("That property isn't there any more");
  const color = getEffectiveColor(card);
  if (color && shieldOf(target) === color) return fail("That colour is shielded by Harry's charm");
  if (color && isSetComplete(target, color) && !roleActive(attacker, "draco")) {
    return fail("You can't take from a complete set");
  }
  return ok;
}

export function chooseTarget(state: GameState, visitorId: string, targetPlayerId: string, targetCardDefId?: string, ownCardDefId?: string): Result {
  const pending = state.pendingAction;
  if (!pending) return fail("Nothing to choose right now");
  if (pending.sourcePlayerId !== visitorId || pending.targetPlayerId !== visitorId) return fail("Not your action");

  const attacker = getPlayer(state, visitorId)!;
  const target = getPlayer(state, targetPlayerId);
  if (!target) return fail("Choose another player");
  if (target.visitorId === visitorId) return fail("Choose another player, not yourself");

  const action = (type: PendingAction["type"], data: any): PendingAction => ({
    type, sourcePlayerId: visitorId, targetPlayerId, cardDefId: pending.cardDefId, data,
  });

  switch (pending.type) {
    case "choose_steal": {
      if (!targetCardDefId) return fail("Choose a property to take");
      const check = canTakeProperty(attacker, target, targetCardDefId);
      if (!check.success) return check;
      log(state, attacker, `aims Sly Deal at ${target.animal.name}'s ${ownedTag(target, targetCardDefId)}`);
      offerProtego(state, action("choose_steal", { targetCardDefId }));
      return ok;
    }
    case "choose_swap": {
      if (!targetCardDefId || !ownCardDefId) return fail("Choose one of your properties and one of theirs");
      if (!attacker.properties.some(c => c.defId === ownCardDefId)) return fail("That isn't your property");
      const check = canTakeProperty(attacker, target, targetCardDefId);
      if (!check.success) return check;
      log(state, attacker, `aims Forced Deal at ${target.animal.name}'s ${ownedTag(target, targetCardDefId)}`);
      offerProtego(state, action("choose_swap", { targetCardDefId, ownCardDefId }));
      return ok;
    }
    case "choose_steal_set": {
      const color = targetCardDefId as PropertyColor; // the colour is sent in this field
      if (!PROPERTY_COLORS.includes(color) || !isSetComplete(target, color)) return fail("That's not a complete set");
      if (shieldOf(target) === color) return fail("That colour is shielded by Harry's charm");
      log(state, attacker, `aims Deal Breaker at ${target.animal.name}'s ${colorTag(color)} set`);
      offerProtego(state, action("choose_steal_set", { color }));
      return ok;
    }
    case "choose_reducto": {
      if (!targetCardDefId) return fail("Choose a property to destroy");
      // Demolish only hits properties; money in the bank is safe
      const check = canTakeProperty(attacker, target, targetCardDefId);
      if (!check.success) return check;
      log(state, attacker, `aims Demolish at ${target.animal.name}'s ${ownedTag(target, targetCardDefId)}`);
      offerProtego(state, action("choose_reducto", { targetCardDefId }));
      return ok;
    }
    case "choose_silencio": {
      if (target.isSilenced) return fail("Their power is already off");
      log(state, attacker, `aims Power Outage at ${target.animal.name}`);
      offerProtego(state, action("choose_silencio", {}));
      return ok;
    }
    case "choose_goblin": {
      log(state, attacker, `played Debt Collector on ${target.animal.name}, who owes 5M`);
      startPayments(state, "pay_debt", visitorId, [targetPlayerId], 5, pending.cardDefId!);
      return ok;
    }
    default:
      return fail("Nothing to choose right now");
  }
}

// ========== SPECIAL ACTIONS ==========

// Harry's shield stays put until he moves it. At the end of each turn he
// keeps it (no colour), moves it (a colour) or drops it (null).
export function harryProtectColor(state: GameState, visitorId: string, color?: PropertyColor | null): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "harry_protect" || pending.targetPlayerId !== visitorId) return fail("Nothing to shield right now");
  const player = getPlayer(state, visitorId)!;
  if (!roleActive(player, "harry")) return fail("Only Harry can shield a colour");
  if (color && !PROPERTY_COLORS.includes(color)) return fail("Invalid colour");

  if (color === null) {
    if (player.protectedColor) log(state, player, `dropped their shield on ${colorTag(player.protectedColor)}`);
    player.protectedColor = undefined;
  } else if (color && color !== player.protectedColor) {
    player.protectedColor = color;
    log(state, player, `moved their shield to ${colorTag(color)}`);
  }
  state.pendingAction = null;
  return finalizeTurn(state, visitorId);
}

export function timeTurnerChoose(state: GameState, visitorId: string, cardDefId: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "time_turner_play" || pending.sourcePlayerId !== visitorId) return fail("No Rewind to use");
  const def = CARD_DEF_MAP[cardDefId];
  if (!def || def.actionType === "time_turner") return fail("Choose a different card");
  const idx = state.discardPile.findIndex(c => c.defId === cardDefId);
  if (idx === -1) return fail("That card isn't in the discard pile");

  const player = getPlayer(state, visitorId)!;
  player.hand.push(state.discardPile.splice(idx, 1)[0]);
  state.freePlayCardId = cardDefId;
  state.pendingAction = null;
  log(state, player, `took ${def.name} back with Rewind and plays it next`, def.id);
  return ok;
}

export function paySilencio(state: GameState, visitorId: string, cardDefIds: string[]): Result {
  const player = getPlayer(state, visitorId);
  if (!player || !player.isSilenced) return fail("Your power isn't off");
  const ids = Array.from(new Set(cardDefIds || []));
  const chosen: GameCard[] = [];
  for (const id of ids) {
    const card = player.bank.find(c => c.defId === id) ?? player.properties.find(c => c.defId === id);
    if (!card) return fail("One of those cards isn't in your bank or properties");
    chosen.push(card);
  }
  const total = totalValue(chosen);
  if (total < 10) return fail(`Pick at least 10M to end the Power Outage (you picked ${total}M)`);

  for (const card of chosen) {
    if (!removeCard(player.bank, card.defId)) removeCard(player.properties, card.defId);
    state.discardPile.push({ defId: card.defId });
  }
  player.isSilenced = false;
  if (isCurrentTurn(state, visitorId)) state.maxActions = maxActionsFor(player);
  log(state, player, `paid ${total}M to end the Power Outage. Their role power is back`);
  return ok;
}

const CANCELLABLE: PendingAction["type"][] = [
  "choose_steal", "choose_swap", "choose_steal_set", "choose_reducto", "choose_silencio", "choose_goblin", "time_turner_play",
];

/** Take back an action card while still picking its target. The card and the action come back. */
export function cancelChoice(state: GameState, visitorId: string): Result {
  const pending = state.pendingAction;
  if (!pending || !CANCELLABLE.includes(pending.type)) return fail("Nothing to take back");
  if (pending.sourcePlayerId !== visitorId) return fail("Not your action");
  const player = getPlayer(state, visitorId)!;
  const cardDefId = pending.cardDefId!;
  const idx = state.discardPile.map(c => c.defId).lastIndexOf(cardDefId);
  if (idx < 0) return fail("Card not found");
  state.discardPile.splice(idx, 1);
  player.hand.push({ defId: cardDefId });
  if (pending.data?.free) state.freePlayCardId = cardDefId;
  else state.actionsUsed = Math.max(0, state.actionsUsed - 1);
  state.pendingAction = null;
  log(state, player, `took back ${CARD_DEF_MAP[cardDefId]?.name ?? "a card"}`, cardDefId);
  return ok;
}

export function discardCards(state: GameState, visitorId: string, cardDefIds: string[]): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "discard_excess") return fail("No discard needed");
  if (pending.targetPlayerId !== visitorId) return fail("Not your discard");

  const player = getPlayer(state, visitorId)!;
  const mustDiscard = pending.data?.mustDiscard ?? 0;
  const ids = Array.from(new Set(cardDefIds || []));
  if (ids.length !== mustDiscard) return fail(`Discard exactly ${mustDiscard} card${mustDiscard === 1 ? "" : "s"}`);
  if (!ids.every(id => player.hand.some(c => c.defId === id))) return fail("One of those cards isn't in your hand");

  for (const id of ids) state.discardPile.push(removeCard(player.hand, id)!);
  state.pendingAction = null;
  log(state, player, `discarded ${mustDiscard} card${mustDiscard === 1 ? "" : "s"}`);
  advanceTurn(state);
  return ok;
}

// ========== SLEEP MODE ==========

/** Anyone can put the player the game is waiting on to sleep once the timer runs out. */
export function putToSleep(state: GameState, actorId: string, targetPlayerId: string): Result {
  if (state.status !== "playing") return fail("The game is over");
  if (!getPlayer(state, actorId)) return fail("Only players can do that");
  const target = getPlayer(state, targetPlayerId);
  if (!target) return fail("Player not found");
  if (target.visitorId === actorId) return fail("You can't put yourself to sleep");
  if (state.turnTimer > 0) return fail("Their time isn't up yet");
  if (getWaitingOn(state) !== targetPlayerId) return fail("The game isn't waiting on them");
  target.isSleeping = true;
  addEvent(state, "💤", target.animal.name, target.animal.colorClass, "fell asleep. A bot is playing for them");
  return ok;
}

/** A player who lost connection and didn't come back in time is handed to the bot. */
export function sleepForDisconnect(state: GameState, visitorId: string): boolean {
  const player = getPlayer(state, visitorId);
  if (state.status !== "playing" || !player || player.isSleeping || player.isConnected) return false;
  player.isSleeping = true;
  addEvent(state, "📡", player.animal.name, player.animal.colorClass, "lost connection. A bot is playing for them until they're back");
  return true;
}

export function wakeUp(state: GameState, visitorId: string): Result {
  const player = getPlayer(state, visitorId);
  if (!player) return fail("Player not found");
  if (!player.isSleeping || player.isBot) return ok;
  player.isSleeping = false;
  log(state, player, "is back");
  return ok;
}

// ========== FORFEIT ==========

/**
 * A player gives up. Their hand, properties and bank are shuffled back into
 * the draw pile (nobody gets them until they're drawn again) and they leave
 * the table for good; they can still watch. Anything they were in the middle
 * of is dropped. If one player is left, or only practice bots, the game ends.
 */
export function forfeit(state: GameState, visitorId: string): Result {
  if (state.status !== "playing") return fail("The game is over");
  const player = getPlayer(state, visitorId);
  if (!player) return fail("Only players can forfeit");

  const idx = state.players.indexOf(player);
  const wasTurn = idx === state.currentTurnIndex;
  state.players.splice(idx, 1);
  if (idx < state.currentTurnIndex) state.currentTurnIndex--;
  else if (wasTurn) state.currentTurnIndex = idx % state.players.length;

  const returned = [...player.hand, ...player.properties, ...player.bank].map(c => ({ defId: c.defId }));
  state.drawPile = shuffle([...state.drawPile, ...returned]);
  addEvent(state, "🏳️", player.animal.name, player.animal.colorClass,
    `forfeited. Their ${returned.length} cards were shuffled back into the draw pile`);

  const left = state.players;
  if (left.length > 1 && !left.every(p => p.isBot)) {
    if (wasTurn) beginTurn(state);
    else dropFromPending(state, visitorId);
  } else {
    const sets = (p: PlayerState) => countCompleteSets(p.properties, SET_SIZES);
    const winner = [...left].sort((a, b) => sets(b) - sets(a) || worth(b) - worth(a))[0];
    state.status = "finished";
    state.pendingAction = null;
    state.winnerId = winner?.visitorId ?? null;
    if (winner) addEvent(state, "🏆", winner.animal.name, winner.animal.colorClass,
      left.length === 1 ? "won the game. Everyone else forfeited!" : "won the game as the bot closest to three sets");
  }
  return ok;
}

// Take a player who just left out of whatever the game is waiting on
function dropFromPending(state: GameState, visitorId: string) {
  const pending = state.pendingAction;
  if (!pending) return;
  const original: PendingAction = pending.type === "protego_response" ? pending.data.originalAction : pending;
  if (original.sourcePlayerId === visitorId) {
    state.pendingAction = null;
    return;
  }
  if (PAYMENT_TYPES.includes(original.type)) {
    const data = original.data = original.data ?? {};
    data.remainingTargets = (data.remainingTargets ?? []).filter((id: string) => id !== visitorId);
    data.allTargets = (data.allTargets ?? []).filter((id: string) => id !== visitorId);
    data.results = (data.results ?? []).filter((r: PaymentResult) => r.playerId !== visitorId);
    // The next payer in line is asked straight away
    if (original.targetPlayerId === visitorId) nextPayer(state, original);
    return;
  }
  if (original.targetPlayerId === visitorId) state.pendingAction = null;
}

// The bot pays with the cheapest cards: bank first, then loose properties,
// then complete sets. It never pays with Harry's shielded colour.
function botPayment(state: GameState, player: PlayerState, amount: number): string[] {
  const shield = shieldOf(player);
  const bank = [...player.bank].sort((a, b) => cardValue(a) - cardValue(b));
  const props = player.properties
    .filter(c => !shield || getEffectiveColor(c) !== shield)
    .sort((a, b) => {
      const ca = getEffectiveColor(a), cb = getEffectiveColor(b);
      const fa = ca && isSetComplete(player, ca) ? 1 : 0, fb = cb && isSetComplete(player, cb) ? 1 : 0;
      return fa - fb || cardValue(a) - cardValue(b);
    });
  const picked: string[] = [];
  let total = 0;
  for (const card of [...bank, ...props]) {
    if (total >= amount) break;
    if (cardValue(card) === 0) continue;
    picked.push(card.defId);
    total += cardValue(card);
  }
  // If it still can't cover the debt it must hand over everything payable
  if (total < amount) return payableCards(player).map(c => c.defId);
  return picked;
}

function bestColorFor(player: PlayerState, colors: PropertyColor[]): PropertyColor {
  return [...colors].sort((a, b) => getPropertiesOfColor(player, b).length - getPropertiesOfColor(player, a).length)[0];
}

/**
 * Make one move for a sleeping player. Returns true if it did something.
 * The bot keeps the game moving: it draws, plays properties, banks money,
 * pays debts with its cheapest cards and ends its turn. It never attacks.
 */
export function botStep(state: GameState): boolean {
  const waitingOn = getWaitingOn(state);
  const bot = waitingOn ? getPlayer(state, waitingOn) : undefined;
  if (!bot || !bot.isSleeping || state.status !== "playing") return false;
  const id = bot.visitorId;
  const pending = state.pendingAction;

  if (pending) {
    // Practice bots defend themselves with Protego when they hold one
    if (bot.isBot && hasProtegoInHand(bot) && pending.targetPlayerId === id &&
        (pending.type === "protego_response" || PAYMENT_TYPES.includes(pending.type)) &&
        playProtego(state, id).success) {
      return true;
    }
    switch (pending.type) {
      case "choose_goblin":
        if (bot.isBot) {
          const richest = state.players.filter(p => p.visitorId !== id)
            .sort((a, b) => worth(b) - worth(a))[0];
          if (richest && chooseTarget(state, id, richest.visitorId).success) return true;
        }
        log(state, bot, "'s action was dropped while they were asleep");
        state.pendingAction = null;
        return true;
      case "pay_rent": case "pay_debt": case "pay_birthday":
        return payWithCards(state, id, botPayment(state, bot, pending.amount ?? 0)).success
          || payWithCards(state, id, payableCards(bot).map(c => c.defId)).success;
      case "protego_response":
        return declineProtego(state, id).success;
      case "harry_protect": {
        // A sleeping player keeps their shield where it is; a practice bot guards its best colour
        const owned = PROPERTY_COLORS.filter(c => getPropertiesOfColor(bot, c).length > 0);
        return harryProtectColor(state, id, bot.isBot && owned.length ? bestColorFor(bot, owned) : undefined).success;
      }
      case "cedric_draw_choice":
        return cedricChooseSource(state, id, "deck").success;
      case "lucha_choose": {
        // Copy whoever has the most powers
        const pick = [...luchaChoices(state, bot)].sort((a, b) => b.roles.length - a.roles.length)[0];
        return luchaChoose(state, id, pick.visitorId).success;
      }
      case "discard_excess": {
        const n = pending.data?.mustDiscard ?? 0;
        // Keep properties; throw away the lowest-value cards first
        const order = [...bot.hand].sort((a, b) => {
          const pa = CARD_DEF_MAP[a.defId]?.type === "property" ? 1 : 0, pb = CARD_DEF_MAP[b.defId]?.type === "property" ? 1 : 0;
          return pa - pb || cardValue(a) - cardValue(b);
        });
        return discardCards(state, id, order.slice(0, n).map(c => c.defId)).success;
      }
      default:
        // A sleeping attacker gives up the half-finished action
        log(state, bot, "'s action was dropped while they were asleep");
        state.pendingAction = null;
        return true;
    }
  }

  if (!isCurrentTurn(state, id)) return false;
  if (!state.drawnThisTurn) return drawCards(state, id).success;

  if (state.freePlayCardId) {
    const def = CARD_DEF_MAP[state.freePlayCardId];
    const card = state.freePlayCardId;
    if (def?.type === "property") return playCard(state, id, card).success;
    if (def?.type === "wild") {
      const colors = def.wildColors === "rainbow" ? [...PROPERTY_COLORS] : def.wildColors as PropertyColor[];
      return playCard(state, id, card, false, bestColorFor(bot, colors)).success;
    }
    if (bankCard(state, id, card).success) return true;
    state.freePlayCardId = null;
    return true;
  }

  if (state.actionsUsed < state.maxActions) {
    const prop = bot.hand.find(c => CARD_DEF_MAP[c.defId]?.type === "property");
    if (prop) return playCard(state, id, prop.defId).success;
    const wild = bot.hand.find(c => CARD_DEF_MAP[c.defId]?.type === "wild");
    if (wild) {
      const def = CARD_DEF_MAP[wild.defId];
      const colors = def.wildColors === "rainbow" ? [...PROPERTY_COLORS] : def.wildColors as PropertyColor[];
      return playCard(state, id, wild.defId, false, bestColorFor(bot, colors)).success;
    }
    if (bot.isBot && botAttack(state, bot)) return true;
    const money = bot.hand.find(c => CARD_DEF_MAP[c.defId]?.type === "money");
    if (money) return playCard(state, id, money.defId).success;
  }
  return endTurn(state, id).success;
}

const worth = (p: PlayerState) => [...p.bank, ...p.properties].reduce((n, c) => n + cardValue(c), 0);
const hasProtegoInHand = (p: PlayerState) => p.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");

/**
 * Practice bots also charge you, so you can test paying and Protego on your own:
 * they play rent for their best set, Yule Ball, Gringotts Goblin and Felix Felicis.
 * They still never steal or destroy cards.
 */
function botAttack(state: GameState, bot: PlayerState): boolean {
  const id = bot.visitorId;
  for (const card of bot.hand) {
    const def = CARD_DEF_MAP[card.defId];
    if (def?.type === "rent") {
      const colors = def.rentColors === "rainbow" ? [...PROPERTY_COLORS] : def.rentColors as PropertyColor[];
      const best = [...colors].sort((a, b) => calculateRent(bot, b) - calculateRent(bot, a))[0];
      if (best && calculateRent(bot, best) > 0 && playCard(state, id, card.defId, false, best).success) return true;
    }
    if (def?.type === "action" && ["yule_ball", "gringotts_goblin", "felix_felicis", "double_rent"].includes(def.actionType!)) {
      if (playCard(state, id, card.defId).success) return true;
    }
  }
  return false;
}

// ========== WIN CONDITION ==========

function checkWinCondition(state: GameState, visitorId: string) {
  if (state.status !== "playing") return;
  const player = getPlayer(state, visitorId);
  if (!player) return;
  const completeSets = countCompleteSets(player.properties, SET_SIZES);
  if (completeSets >= 3) {
    state.winnerId = visitorId;
    state.status = "finished";
    state.pendingAction = null;
    addEvent(state, "🏆", player.animal.name, player.animal.colorClass, `won the game with ${completeSets} complete sets!`);
  }
}

// ========== SANITIZE STATE FOR CLIENT ==========

/**
 * Create a version of game state safe to send to a specific player.
 * Hides other players' hands and the draw pile.
 */
export function sanitizeStateForPlayer(state: GameState, visitorId: string): GameState {
  return {
    ...state,
    drawPileCount: state.drawPile.length,
    drawPile: [],
    waitingOn: getWaitingOn(state),
    players: state.players.map(p => ({
      ...p,
      hand: p.visitorId === visitorId ? p.hand : p.hand.map(() => ({ defId: "__hidden__" })),
    })),
  };
}
