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
import { CARD_DEF_MAP, getEffectiveColor, countCompleteSets, colorOnTable, isAnyColourWild } from "../shared/cardDefs";
import { gameSetup, type GameSetup } from "../shared/variations";
import { cheapestCover } from "../shared/payment";
import { roleActive, canShortcut, setSizeFor, setSizesFor, sparedBy, chargeOwedBy, KANJAR_MIN_PLAYERS } from "../shared/rolePowers";

export { roleActive };

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

// Harry's shielded colour, only while his power is switched on
export function shieldOf(player: PlayerState): PropertyColor | undefined {
  return roleActive(player, "harry") ? player.protectedColor : undefined;
}

function maxActionsFor(player: PlayerState): number {
  return roleActive(player, "hermione") ? 4 : 3;
}

function getPropertiesOfColor(player: PlayerState, color: PropertyColor): GameCard[] {
  return player.properties.filter(card => colorOnTable(card, player.properties) === color);
}

/** Colours this player has a card of, which an any-colour wild can join. */
function ownedColors(player: PlayerState): PropertyColor[] {
  return PROPERTY_COLORS.filter(c => getPropertiesOfColor(player, c).length > 0);
}

/**
 * An any-colour wild left without a card of its colour (that card was stolen,
 * paid away or flipped elsewhere) goes back to having no colour, so it doesn't
 * quietly rejoin that colour later. Its owner can move it again on their turn.
 */
export function settleWilds(state: GameState) {
  for (const p of state.players) {
    for (const card of p.properties) {
      if (card.assignedColor && isAnyColourWild(card.defId) && !colorOnTable(card, p.properties)) card.assignedColor = undefined;
    }
  }
}

// Tharki's Shortcut colour is complete with one fewer card
function isSetComplete(player: PlayerState, color: PropertyColor): boolean {
  return getPropertiesOfColor(player, color).length >= setSizeFor(player, color);
}

// A complete set always earns the full-set rent, Shortcut or not
export function calculateRent(player: PlayerState, color: PropertyColor): number {
  const count = getPropertiesOfColor(player, color).length;
  const table = RENT_TABLE[color];
  if (count === 0) return 0;
  if (isSetComplete(player, color)) return table[table.length - 1];
  return table[Math.min(count, table.length) - 1];
}

const completeSetCount = (player: PlayerState) => countCompleteSets(player.properties, setSizesFor(player));

function cardValue(card: GameCard): number {
  return CARD_DEF_MAP[card.defId]?.value ?? 0;
}

function totalValue(cards: GameCard[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
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
  return [...player.bank, ...player.properties.filter(c => !shield || colorOnTable(c, player.properties) !== shield)];
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
    rules: setup.rules,
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
  // Kanjar needs 3 or more players: one on one his friend would be everyone
  const pool = setup.roles.filter(r => r !== "kanjar" || players.length >= KANJAR_MIN_PLAYERS);
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
    opponent: roleActive(player, "ganda") && state.players.some(p => p.visitorId !== player.visitorId && p.hand.length > 0 && !sparedBy(player, p)),
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
    if (sparedBy(player, target)) {
      state.pendingAction = pending;
      return fail(friendError(target));
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
    // It can only join a colour you already have; with no colour picked it sits on its own
    if (targetColor && !ownedColors(player).includes(targetColor)) {
      return fail(`You have no ${COLOR_LABEL[targetColor] ?? "such"} cards for the wild to join`);
    }
    color = targetColor;
  } else if (Array.isArray(def.wildColors)) {
    color = targetColor && def.wildColors.includes(targetColor) ? targetColor : def.wildColors[0];
    if (!color) return fail("Invalid colour");
  }
  removeCard(player.hand, cardDefId);
  player.properties.push({ defId: cardDefId, assignedColor: color });
  state.actionsUsed++;
  log(state, player, color ? `played ${def.name} as ${colorTag(color)}` : `played ${def.name} on its own, with no colour yet`, def.id);
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

  // Monopoly Deal rules: Wild Rent charges one player of your choice
  if (def.rentColors === "rainbow" && state.rules?.wildRentOneTarget) {
    state.pendingAction = {
      type: "choose_rent_target", sourcePlayerId: player.visitorId, targetPlayerId: player.visitorId, cardDefId,
      amount: rentAmount,
      data: { rentColor, multiplier, free: state.freePlayCardId === cardDefId },
    };
    log(state, player, `played Wild Rent for ${rentAmount}M ${colorTag(rentColor)}${doubled} and is choosing who pays`, def.id);
    return ok;
  }
  log(state, player, `charged everyone ${rentAmount}M ${colorTag(rentColor)} rent${doubled}`, def.id);

  // Every other player pays, one at a time
  const targets = state.players.filter(p => p.visitorId !== player.visitorId).map(p => p.visitorId);
  startPayments(state, "pay_rent", player.visitorId, targets, rentAmount, cardDefId, rentColor);
  return ok;
}

// Set up a queue of payers. Skips anyone Harry's shield protects from this rent.
// `resume` is a payment queue this one interrupted (Chargeback, Reverse); it carries on afterwards.
function startPayments(state: GameState, type: "pay_rent" | "pay_debt" | "pay_birthday", sourceId: string, targets: string[], amount: number, cardDefId: string, rentColor?: PropertyColor, resume?: PendingAction) {
  const payment: PendingAction = {
    type,
    sourcePlayerId: sourceId,
    targetPlayerId: "",
    amount,
    cardDefId,
    data: { rentColor, baseAmount: amount, remainingTargets: [...targets], allTargets: [...targets], results: [] as PaymentResult[], resume },
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
    const source = getPlayer(state, payment.sourcePlayerId);
    if (sparedBy(source, next)) {
      log(state, next, `is Kanjar's friend with ${source!.animal.name} this round, so they can't charge them`);
      data.results.push({ playerId: nextId, outcome: "friend", amount: 0 });
      continue;
    }
    // Each payer's amount starts from the full charge (Gandu pays half of any charge)
    const base: number = data.baseAmount ?? payment.amount ?? 0;
    const amount = chargeOwedBy(next, base);
    if (amount < base) log(state, next, `pays half as Gandu: ${amount}M instead of ${base}M`);
    state.pendingAction = { ...payment, amount, targetPlayerId: nextId, data: { ...data } };
    return;
  }
  state.pendingAction = null;
  if (data.resume) nextPayer(state, data.resume);
}

function playActionCard(state: GameState, player: PlayerState, cardDefId: string): Result {
  const def = CARD_DEF_MAP[cardDefId];
  // Kanjar's friend can't aim anything at Kanjar this round
  const others = state.players.filter(p => p.visitorId !== player.visitorId && !sparedBy(player, p));

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
      const everyone = state.players.filter(p => p.visitorId !== player.visitorId);
      startPayments(state, "pay_birthday", player.visitorId, everyone.map(o => o.visitorId), 2, cardDefId);
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

    case "hand_seven": {
      if (player.hand.length - 1 >= 7) return fail("You already have 7 cards in your hand");
      discardIt();
      let drawn = 0;
      while (player.hand.length < 7) {
        const card = drawFromPile(state);
        if (!card) break;
        player.hand.push(card);
        drawn++;
      }
      log(state, player, `played Hand 7 and drew ${drawn} card${drawn === 1 ? "" : "s"}`, def.id);
      return ok;
    }

    case "hand_steal":
      if (!others.some(o => o.hand.length > 0)) return fail("No one has cards in their hand");
      return choose("choose_hand_steal", "played Hand Steal and is choosing whose hand to take from");

    case "destroy":
      if (!others.some(o => o.properties.some(c => canTakeProperty(player, o, c.defId, true).success))) {
        return fail("No one has a property you can destroy");
      }
      return choose("choose_destroy", "played Destroy and is choosing a property to discard");

    case "bank_robber":
      if (!others.some(o => o.bank.length > 0)) return fail("No one has money in their bank");
      return choose("choose_bank_robber", "played Bank Robber and is choosing whose bank to rob");

    case "protego": case "chargeback": case "reverse":
      // These answer an attack; on your own turn they can only be banked
      removeCard(player.hand, cardDefId);
      player.bank.push({ defId: cardDefId });
      state.actionsUsed++;
      log(state, player, `banked ${def.name} (${def.value}M)`, def.id);
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
  return nextEndOfTurnChoice(state, visitorId);
}

// End-of-turn choices, asked one after another (after Lucha's copy)
const END_OF_TURN_CHOICES = ["harry_protect", "tharki_shortcut", "kanjar_friend"] as const;
type EndOfTurnChoice = typeof END_OF_TURN_CHOICES[number];

function wantsChoice(state: GameState, player: PlayerState, type: EndOfTurnChoice): boolean {
  switch (type) {
    case "harry_protect": return roleActive(player, "harry");
    // Only asked when there's something to keep, move or pick
    case "tharki_shortcut": return roleActive(player, "tharki") && (!!player.shortcutColor || shortcutChoices(player).length > 0);
    case "kanjar_friend": return roleActive(player, "kanjar") && state.players.length >= KANJAR_MIN_PLAYERS;
  }
}

function nextEndOfTurnChoice(state: GameState, visitorId: string, after?: EndOfTurnChoice): Result {
  const player = getPlayer(state, visitorId)!;
  const start = after ? END_OF_TURN_CHOICES.indexOf(after) + 1 : 0;
  for (const type of END_OF_TURN_CHOICES.slice(start)) {
    if (wantsChoice(state, player, type)) {
      state.pendingAction = { type, sourcePlayerId: visitorId, targetPlayerId: visitorId };
      return ok;
    }
  }
  state.pendingAction = null;
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
  // A shield, Shortcut or friend only lasts while Lucha has that power
  if (!roleActive(player, "harry")) player.protectedColor = undefined;
  if (!roleActive(player, "tharki")) player.shortcutColor = undefined;
  if (!roleActive(player, "kanjar")) player.friendId = undefined;
  const names = player.borrowedRoles.map(r => CARD_DEF_MAP[`role_${r}`]?.name ?? r).join(" and ");
  log(state, player, names
    ? `copied ${target.animal.name}'s power (${names}) for their next turn`
    : `copied ${target.animal.name}, who has no power to copy, for their next turn`);
  state.pendingAction = null;
  return nextEndOfTurnChoice(state, visitorId);
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

export function flipWild(state: GameState, visitorId: string, cardDefId: string, newColor: PropertyColor | null): Result {
  // Flipping a wild is free, but only on your own turn
  if (state.status !== "playing") return fail("The game is over");
  const player = getPlayer(state, visitorId);
  if (!player) return fail("Player not found");
  if (!isCurrentTurn(state, visitorId)) return fail("You can only move wilds on your turn");
  const card = player.properties.find(c => c.defId === cardDefId);
  if (!card) return fail("Card not in your properties");
  const def = CARD_DEF_MAP[cardDefId];
  if (!def || def.type !== "wild") return fail("Not a wild card");
  // No colour: the any-colour wild leaves its set and sits on its own
  if (newColor == null && def.wildColors === "rainbow") {
    if (!card.assignedColor) return ok;
    card.assignedColor = undefined;
    log(state, player, `took ${def.name} out of their sets. It sits on its own with no colour`, def.id);
    return ok;
  }
  if (!newColor || !PROPERTY_COLORS.includes(newColor)) return fail("Invalid colour");
  if (Array.isArray(def.wildColors) && !def.wildColors.includes(newColor)) {
    return fail(`This wild can only be ${def.wildColors.map(c => COLOR_LABEL[c]).join(" or ")}`);
  }
  if (card.assignedColor === newColor) return ok;
  if (def.wildColors === "rainbow" && !ownedColors(player).includes(newColor)) {
    return fail(`You have no ${COLOR_LABEL[newColor]} cards for the wild to join`);
  }
  card.assignedColor = newColor;
  settleWilds(state);
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
// The side being asked is always asked, even with no Just Say No in hand, so
// nobody can tell from the game skipping the question who holds one. They can
// always allow it; only someone holding a Just Say No can block.

function askProtego(state: GameState, original: PendingAction, responderId: string, blocks: number) {
  state.pendingAction = {
    type: "protego_response",
    sourcePlayerId: original.sourcePlayerId,
    targetPlayerId: responderId,
    cardDefId: original.cardDefId,
    data: { originalAction: original, blocks },
  };
}

function offerProtego(state: GameState, original: PendingAction) {
  if (getPlayer(state, original.targetPlayerId)) askProtego(state, original, original.targetPlayerId, 0);
  else executeAction(state, original);
}

export function playProtego(state: GameState, visitorId: string): Result {
  return blockWith(state, visitorId, "protego");
}

// Block with a Just Say No, or with a Reverse that can't be played back
function blockWith(state: GameState, visitorId: string, actionType: "protego" | "reverse"): Result {
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
  const idx = player.hand.findIndex(c => CARD_DEF_MAP[c.defId]?.actionType === actionType);
  if (idx === -1) return fail(actionType === "protego" ? "You don't have a Just Say No" : "You don't have a Reverse");
  const card = player.hand.splice(idx, 1)[0];
  state.discardPile.push(card);
  blocks++;
  const said = actionType === "protego" ? "said Just Say No" : "played Reverse as a Just Say No";
  log(state, player, blocks % 2 === 1 ? `${said} to block it` : `${said} back to push it through`, card.defId);

  // The other side may answer with their own Protego
  const nextResponder = blocks % 2 === 1 ? original.sourcePlayerId : original.targetPlayerId;
  if (getPlayer(state, nextResponder)) askProtego(state, original, nextResponder, blocks);
  else resolveProtego(state, original, blocks);
  return ok;
}

export function declineProtego(state: GameState, visitorId: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "protego_response") return fail("Nothing to decide right now");
  if (pending.targetPlayerId !== visitorId) return fail("Not your decision");
  resolveProtego(state, pending.data.originalAction, pending.data.blocks ?? 0);
  return ok;
}

// ========== CHARGEBACK AND REVERSE (Prime) ==========

/** The attack aimed at this player that they can answer right now, if any. */
function attackOn(state: GameState, visitorId: string): PendingAction | null {
  const p = state.pendingAction;
  if (!p || p.targetPlayerId !== visitorId) return null;
  if (PAYMENT_TYPES.includes(p.type)) return p;
  if (p.type === "protego_response" && p.data.originalAction.targetPlayerId === visitorId) return p.data.originalAction;
  return null;
}

function discardFromHand(state: GameState, player: PlayerState, actionType: string): GameCard | undefined {
  const idx = player.hand.findIndex(c => CARD_DEF_MAP[c.defId]?.actionType === actionType);
  if (idx === -1) return undefined;
  const card = player.hand.splice(idx, 1)[0];
  state.discardPile.push(card);
  return card;
}

/** Chargeback: cancel your part of a charge, then charge any other player the same amount. */
export function playChargeback(state: GameState, visitorId: string): Result {
  const original = attackOn(state, visitorId);
  if (!original || !PAYMENT_TYPES.includes(original.type)) return fail("Chargeback answers a charge against you");
  const player = getPlayer(state, visitorId)!;
  const card = discardFromHand(state, player, "chargeback");
  if (!card) return fail("You don't have a Chargeback");
  const amount = original.amount ?? 0;
  original.data.results = [...(original.data.results ?? []), { playerId: visitorId, outcome: "blocked", amount: 0 }];
  log(state, player, `played Chargeback to cancel the ${amount}M charge and is choosing who pays it instead`, card.defId);
  state.pendingAction = {
    type: "choose_chargeback", sourcePlayerId: visitorId, targetPlayerId: visitorId, cardDefId: card.defId,
    amount, data: { resume: original },
  };
  return ok;
}

/**
 * Reverse: stop an action played on you and play it back on whoever played it.
 * Charges become the same charge on them; steals and Destroy let you pick from
 * their table; the rest go straight at them. If it can't be played back it
 * works as a Just Say No.
 */
export function playReverse(state: GameState, visitorId: string): Result {
  const original = attackOn(state, visitorId);
  if (!original) return fail("Reverse answers an action played on you");
  const player = getPlayer(state, visitorId)!;
  if (!player.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "reverse")) return fail("You don't have a Reverse");
  const attacker = getPlayer(state, original.sourcePlayerId);
  const plan = attacker && reversePlan(state, original, player, attacker);
  if (!plan) return blockWith(state, visitorId, "reverse");

  const card = discardFromHand(state, player, "reverse")!;
  log(state, player, `played Reverse to turn ${CARD_DEF_MAP[original.cardDefId ?? ""]?.name ?? "it"} back on ${attacker!.animal.name}`, card.defId);
  plan(card.defId);
  return ok;
}

function reversePlan(state: GameState, original: PendingAction, me: PlayerState, attacker: PlayerState): ((cardDefId: string) => void) | null {
  const pick = (type: PendingAction["type"]) => (cardDefId: string) => {
    state.pendingAction = {
      type, sourcePlayerId: me.visitorId, targetPlayerId: me.visitorId, cardDefId,
      data: { onlyTarget: attacker.visitorId, reversed: true },
    };
  };
  const direct = (type: PendingAction["type"]) => (cardDefId: string) => {
    log(state, me, `aims ${CARD_DEF_MAP[original.cardDefId ?? ""]?.name ?? "it"} at ${attacker.animal.name}`);
    offerProtego(state, { type, sourcePlayerId: me.visitorId, targetPlayerId: attacker.visitorId, cardDefId, data: {} });
  };
  const takeable = (allowComplete = false) => attacker.properties.some(c => canTakeProperty(me, attacker, c.defId, allowComplete).success);
  if (sparedBy(me, attacker)) return null; // Kanjar's friend can only block him, not hit back

  if (PAYMENT_TYPES.includes(original.type)) {
    const amount = original.amount ?? 0;
    if (amount <= 0) return null;
    return cardDefId => {
      original.data.results = [...(original.data.results ?? []), { playerId: me.visitorId, outcome: "blocked", amount: 0 }];
      startPayments(state, "pay_debt", me.visitorId, [attacker.visitorId], amount, cardDefId, undefined, original);
    };
  }
  switch (original.type) {
    case "choose_steal": case "choose_reducto": return takeable() ? pick(original.type) : null;
    case "choose_destroy": return takeable(true) ? pick(original.type) : null;
    case "choose_swap": return me.properties.length > 0 && takeable() ? pick(original.type) : null;
    case "choose_steal_set":
      return PROPERTY_COLORS.some(c => isSetComplete(attacker, c) && shieldOf(attacker) !== c) ? pick(original.type) : null;
    case "choose_hand_steal": return attacker.hand.length > 0 ? direct(original.type) : null;
    case "choose_bank_robber": return attacker.bank.length > 0 ? direct(original.type) : null;
    case "choose_silencio": return !attacker.isSilenced ? direct(original.type) : null;
    default: return null;
  }
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
      const stolen = getPropertiesOfColor(target, color);
      target.properties = target.properties.filter(c => !stolen.includes(c));
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
    case "choose_destroy": {
      const id = d.targetCardDefId as string;
      if (!canTakeProperty(attacker, target, id, true).success) { log(state, attacker, "'s Destroy fizzled"); return; }
      const card = removeCard(target.properties, id)!;
      state.discardPile.push({ defId: card.defId });
      log(state, attacker, `used Destroy to discard ${target.animal.name}'s ${cardTag(card)}`, card.defId);
      return;
    }
    case "choose_hand_steal": {
      if (target.hand.length === 0) { log(state, attacker, "'s Hand Steal fizzled: their hand is empty"); return; }
      const card = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1)[0];
      attacker.hand.push(card);
      log(state, attacker, `used Hand Steal to take a random card from ${target.animal.name}'s hand`);
      return;
    }
    case "choose_bank_robber": {
      const cash = target.bank.splice(0);
      attacker.bank.push(...cash);
      log(state, attacker, `used Bank Robber to take ${target.animal.name}'s whole bank (${totalValue(cash)}M)`);
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

// `allowComplete`: Destroy can hit a complete set
function canTakeProperty(attacker: PlayerState, target: PlayerState, cardDefId: string, allowComplete = false): Result {
  const card = target.properties.find(c => c.defId === cardDefId);
  if (!card) return fail("That property isn't there any more");
  if (sparedBy(attacker, target)) return fail(friendError(target));
  const color = colorOnTable(card, target.properties);
  if (color && shieldOf(target) === color) return fail("That colour is shielded by Harry's charm");
  if (color && !allowComplete && isSetComplete(target, color) && !roleActive(attacker, "draco")) {
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
  if (sparedBy(attacker, target)) return fail(friendError(target));
  if (pending.data?.onlyTarget && targetPlayerId !== pending.data.onlyTarget) return fail("Reverse turns it back on the player who played it");

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
    case "choose_destroy": {
      if (!targetCardDefId) return fail("Choose a property to discard");
      const check = canTakeProperty(attacker, target, targetCardDefId, true);
      if (!check.success) return check;
      log(state, attacker, `aims Destroy at ${target.animal.name}'s ${ownedTag(target, targetCardDefId)}`);
      offerProtego(state, action("choose_destroy", { targetCardDefId }));
      return ok;
    }
    case "choose_hand_steal": {
      if (target.hand.length === 0) return fail("Their hand is empty");
      log(state, attacker, `aims Hand Steal at ${target.animal.name}`);
      offerProtego(state, action("choose_hand_steal", {}));
      return ok;
    }
    case "choose_bank_robber": {
      if (target.bank.length === 0) return fail("Their bank is empty");
      log(state, attacker, `aims Bank Robber at ${target.animal.name}`);
      offerProtego(state, action("choose_bank_robber", {}));
      return ok;
    }
    case "choose_chargeback": {
      const amount = pending.amount ?? 0;
      log(state, attacker, `used Chargeback to charge ${target.animal.name} ${amount}M`);
      startPayments(state, "pay_debt", visitorId, [targetPlayerId], amount, pending.cardDefId!, undefined, pending.data?.resume);
      return ok;
    }
    case "choose_silencio": {
      if (target.isSilenced) return fail("Their power is already off");
      log(state, attacker, `aims Power Outage at ${target.animal.name}`);
      offerProtego(state, action("choose_silencio", {}));
      return ok;
    }
    case "choose_rent_target": {
      const amount = pending.amount ?? 0;
      log(state, attacker, `charged ${target.animal.name} ${amount}M ${colorTag(pending.data.rentColor)} rent`);
      startPayments(state, "pay_rent", visitorId, [targetPlayerId], amount, pending.cardDefId!, pending.data.rentColor);
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
  return nextEndOfTurnChoice(state, visitorId, "harry_protect");
}

/** Colours Tharki can put his Shortcut on: ones he has a card of that need 3 or more for a set. */
export function shortcutChoices(player: PlayerState): PropertyColor[] {
  return ownedColors(player).filter(canShortcut);
}

// Tharki's Shortcut stays put until he moves it, like Harry's shield. At the
// end of each turn he keeps it (no colour), moves it (a colour) or drops it (null).
export function tharkiShortcutColor(state: GameState, visitorId: string, color?: PropertyColor | null): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "tharki_shortcut" || pending.targetPlayerId !== visitorId) return fail("Nothing to shortcut right now");
  const player = getPlayer(state, visitorId)!;
  if (!roleActive(player, "tharki")) return fail("Only Tharki can shortcut a colour");
  if (color && !shortcutChoices(player).includes(color)) return fail("Pick a colour you have that needs 3 or more cards");

  if (color === null) {
    if (player.shortcutColor) log(state, player, `dropped their Shortcut on ${colorTag(player.shortcutColor)}`);
    player.shortcutColor = undefined;
  } else if (color && color !== player.shortcutColor) {
    player.shortcutColor = color;
    log(state, player, `put their Shortcut on ${colorTag(color)}: it needs ${setSizeFor(player, color)} cards for a full set`);
  }
  // Moving the Shortcut can complete a third set
  checkWinCondition(state, visitorId);
  if (state.status !== "playing") return ok;
  return nextEndOfTurnChoice(state, visitorId, "tharki_shortcut");
}

/**
 * Kanjar picks his friend for the next round: until his next pick they can't
 * charge him rent or play anything against him. Sending no one keeps the friend he has.
 */
export function kanjarChooseFriend(state: GameState, visitorId: string, friendId?: string): Result {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "kanjar_friend" || pending.targetPlayerId !== visitorId) return fail("Nothing to pick right now");
  const player = getPlayer(state, visitorId)!;
  if (friendId) {
    const friend = getPlayer(state, friendId);
    if (!friend || friend === player) return fail("Pick another player");
    if (friend.visitorId !== player.friendId) {
      player.friendId = friend.visitorId;
      log(state, player, `made ${friend.animal.name} their friend. ${friend.animal.name} can't charge them or act against them until their next pick`);
    } else {
      log(state, player, `stays friends with ${friend.animal.name}`);
    }
  }
  return nextEndOfTurnChoice(state, visitorId, "kanjar_friend");
}

function friendError(kanjar: PlayerState): string {
  return `${kanjar.animal.name} is Kanjar and you're their friend this round, so you can't act against them`;
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
  // Only on your own turn, after drawing. Paying doesn't use up a play.
  if (!isCurrentTurn(state, visitorId)) return fail("You can end the Power Outage on your own turn");
  if (!state.drawnThisTurn) return fail("Draw first, then you can end the Power Outage");
  if (state.pendingAction) return fail("Finish what's happening first");
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
  "choose_rent_target", "choose_hand_steal", "choose_destroy", "choose_bank_robber",
];

/** Take back an action card while still picking its target. The card and the action come back. */
export function cancelChoice(state: GameState, visitorId: string): Result {
  const pending = state.pendingAction;
  if (!pending || !CANCELLABLE.includes(pending.type)) return fail("Nothing to take back");
  if (pending.sourcePlayerId !== visitorId) return fail("Not your action");
  if (pending.data?.reversed) return fail("A Reverse can't be taken back");
  const player = getPlayer(state, visitorId)!;
  const cardDefId = pending.cardDefId!;
  const idx = state.discardPile.map(c => c.defId).lastIndexOf(cardDefId);
  if (idx < 0) return fail("Card not found");
  state.discardPile.splice(idx, 1);
  player.hand.push({ defId: cardDefId });
  if (pending.data?.free) state.freePlayCardId = cardDefId;
  else state.actionsUsed = Math.max(0, state.actionsUsed - 1);
  if ((pending.data?.multiplier ?? 1) > 1) state.rentMultiplier = pending.data.multiplier; // Double the Rent waits for the next rent
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
  // One on one, Kanjar's friend would be everyone, so friendships end
  if (left.length < KANJAR_MIN_PLAYERS) for (const p of left) p.friendId = undefined;
  for (const p of left) if (p.friendId === visitorId) p.friendId = undefined;
  if (left.length > 1 && !left.every(p => p.isBot)) {
    if (wasTurn) beginTurn(state);
    else dropFromPending(state, visitorId);
  } else {
    const sets = completeSetCount;
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
    // A Chargeback or Reverse charge interrupted another payment queue: carry on with it
    const resume: PendingAction | undefined = original.data?.resume;
    if (resume) {
      state.pendingAction = resume;
      dropFromPending(state, visitorId);
    }
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

// The bot pays the smallest total that covers the debt, preferring bank,
// then loose properties, then complete sets. It never pays with Harry's shielded colour.
function botPayment(state: GameState, player: PlayerState, amount: number): string[] {
  const options = payableCards(player).map(c => {
    const color = player.bank.includes(c) ? undefined : colorOnTable(c, player.properties);
    return { id: c.defId, value: cardValue(c), keep: player.bank.includes(c) ? 0 : color && isSetComplete(player, color) ? 2 : 1 };
  });
  // If it can't cover the debt it must hand over everything payable
  return cheapestCover(options, amount) ?? payableCards(player).map(c => c.defId);
}

function bestColorFor(player: PlayerState, colors: PropertyColor[]): PropertyColor {
  return [...colors].sort((a, b) => getPropertiesOfColor(player, b).length - getPropertiesOfColor(player, a).length)[0];
}

/** Where a bot plays a wild: its biggest matching set. An any-colour wild with nothing to join sits alone. */
function botWildColor(player: PlayerState, defId: string): PropertyColor | undefined {
  const def = CARD_DEF_MAP[defId];
  if (def.wildColors !== "rainbow") return bestColorFor(player, def.wildColors as PropertyColor[]);
  const owned = ownedColors(player);
  return owned.length ? bestColorFor(player, owned) : undefined;
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
      case "choose_chargeback": {
        // Others are still waiting to pay after this, so even a sleeping player picks someone
        const richest = state.players.filter(p => p.visitorId !== id && !sparedBy(bot, p)).sort((a, b) => worth(b) - worth(a))[0];
        if (richest && chooseTarget(state, id, richest.visitorId).success) return true;
        state.pendingAction = null;
        if (pending.data?.resume) nextPayer(state, pending.data.resume);
        return true;
      }
      case "choose_goblin": case "choose_rent_target":
        if (bot.isBot) {
          const richest = state.players.filter(p => p.visitorId !== id && !sparedBy(bot, p))
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
      case "tharki_shortcut": {
        // A sleeping player keeps their Shortcut; a practice bot puts it on its closest set
        const choices = shortcutChoices(bot).filter(c => !isSetComplete({ ...bot, shortcutColor: undefined }, c));
        const best = bot.isBot && choices.length
          ? [...choices].sort((a, b) => (SET_SIZES[a] - getPropertiesOfColor(bot, a).length) - (SET_SIZES[b] - getPropertiesOfColor(bot, b).length))[0]
          : undefined;
        return tharkiShortcutColor(state, id, best).success;
      }
      case "kanjar_friend": {
        // A sleeping player keeps their friend; a practice bot befriends the biggest threat
        const pick = bot.isBot
          ? state.players.filter(p => p.visitorId !== id).sort((a, b) => completeSetCount(b) - completeSetCount(a) || worth(b) - worth(a))[0]
          : undefined;
        return kanjarChooseFriend(state, id, pick?.visitorId).success;
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
    if (def?.type === "wild") return playCard(state, id, card, false, botWildColor(bot, card)).success;
    if (bankCard(state, id, card).success) return true;
    state.freePlayCardId = null;
    return true;
  }

  // A practice bot ends its Power Outage when its bank alone covers the 10M
  if (bot.isBot && bot.isSilenced && totalValue(bot.bank) >= 10 &&
      paySilencio(state, id, botPayment(state, { ...bot, properties: [] }, 10)).success) {
    return true;
  }

  if (state.actionsUsed < state.maxActions) {
    const prop = bot.hand.find(c => CARD_DEF_MAP[c.defId]?.type === "property");
    if (prop) return playCard(state, id, prop.defId).success;
    const wild = bot.hand.find(c => CARD_DEF_MAP[c.defId]?.type === "wild");
    if (wild) return playCard(state, id, wild.defId, false, botWildColor(bot, wild.defId)).success;
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
    if (def?.type === "action" && ["yule_ball", "gringotts_goblin", "felix_felicis", "double_rent", "hand_seven"].includes(def.actionType!)) {
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
  const completeSets = completeSetCount(player);
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
