/**
 * Game Engine — Server-authoritative game logic for HP Monopoly Deal.
 * All mutations happen here; clients send intents, engine validates & applies.
 */
import { v4 as uuidv4 } from "uuid";
import type {
  GameState, PlayerState, GameCard, PendingAction,
  PropertyColor, RoleType, EventLogEntry, AnimalProfile,
} from "../shared/schema";
import { SET_SIZES, RENT_TABLE, ANIMALS } from "../shared/schema";
import { ALL_CARD_DEFS, CARD_DEF_MAP, getPlayDeckCardIds, getEffectiveColor, countCompleteSets } from "../shared/cardDefs";

// ========== HELPERS ==========

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addEvent(state: GameState, playerEmoji: string, playerName: string, playerColor: string, message: string, cardImage?: string) {
  state.eventLog.push({
    id: uuidv4(),
    timestamp: Date.now(),
    playerEmoji,
    playerName,
    playerColor,
    message,
    cardImage,
  });
  // Keep last 100 events
  if (state.eventLog.length > 100) {
    state.eventLog = state.eventLog.slice(-100);
  }
}

function getPlayer(state: GameState, visitorId: string): PlayerState | undefined {
  return state.players.find(p => p.visitorId === visitorId);
}

function getCurrentPlayer(state: GameState): PlayerState | undefined {
  return state.players[state.currentTurnIndex];
}

function isCurrentTurn(state: GameState, visitorId: string): boolean {
  const current = getCurrentPlayer(state);
  return current?.visitorId === visitorId;
}

// Get all properties of a specific color for a player
function getPropertiesOfColor(player: PlayerState, color: PropertyColor): GameCard[] {
  return player.properties.filter(card => getEffectiveColor(card) === color);
}

// Check if a color set is complete for a player
function isSetComplete(player: PlayerState, color: PropertyColor): boolean {
  const count = getPropertiesOfColor(player, color).length;
  return count >= SET_SIZES[color];
}

// Calculate rent for a given color based on how many properties the player has
function calculateRent(player: PlayerState, color: PropertyColor): number {
  const count = getPropertiesOfColor(player, color).length;
  const table = RENT_TABLE[color];
  if (count === 0) return 0;
  return table[Math.min(count, table.length) - 1];
}

// Calculate total value of cards (for payment purposes)
function cardValue(card: GameCard): number {
  const def = CARD_DEF_MAP[card.defId];
  return def?.value ?? 0;
}

function totalValue(cards: GameCard[]): number {
  return cards.reduce((sum, c) => sum + cardValue(c), 0);
}

// Check if a player has a Protego in hand
function hasProtego(player: PlayerState): boolean {
  return player.hand.some(c => {
    const def = CARD_DEF_MAP[c.defId];
    return def?.actionType === "protego";
  });
}

// Remove a card from an array by defId (first match)
function removeCard(arr: GameCard[], defId: string): GameCard | undefined {
  const idx = arr.findIndex(c => c.defId === defId);
  if (idx === -1) return undefined;
  return arr.splice(idx, 1)[0];
}

// Draw from pile, reshuffling discard if needed
function drawFromPile(state: GameState): GameCard | null {
  if (state.drawPile.length === 0) {
    if (state.discardPile.length === 0) return null;
    state.drawPile = shuffle(state.discardPile);
    state.discardPile = [];
    addEvent(state, "🔄", "System", "#888", "Draw pile reshuffled from discard pile");
  }
  return state.drawPile.pop() ?? null;
}

// ========== CREATE GAME ==========

export function createInitialGameState(
  roomCode: string,
  players: { visitorId: string; seatIndex: number; animal: AnimalProfile }[],
  gameSpeed: number,
): GameState {
  // Build the play deck (no role cards)
  const deckIds = getPlayDeckCardIds();
  const shuffled = shuffle(deckIds);
  const drawPile: GameCard[] = shuffled.map(id => ({ defId: id }));

  // Assign random roles
  const roleTypes: RoleType[] = shuffle(["harry", "hermione", "draco", "cedric", "luna"] as RoleType[]);

  // Create player states
  const playerStates: PlayerState[] = players.map((p, i) => ({
    visitorId: p.visitorId,
    seatIndex: p.seatIndex,
    animal: p.animal,
    role: roleTypes[i % roleTypes.length],
    hand: [],
    properties: [],
    bank: [],
    isReady: false,
    isSleeping: false,
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
    roleCards: roleTypes,
  };

  // Deal 5 cards to each player
  for (const player of state.players) {
    for (let i = 0; i < 5; i++) {
      const card = drawFromPile(state);
      if (card) player.hand.push(card);
    }
  }

  // Set max actions for Hermione
  const current = getCurrentPlayer(state);
  if (current) {
    state.maxActions = (current.role === "hermione" && !current.isSilenced) ? 4 : 3;
  }

  addEvent(state, "⚡", "System", "#FFD700", "The game begins! Wands at the ready...");

  return state;
}

// ========== TURN MANAGEMENT ==========

export function drawCards(state: GameState, visitorId: string): { success: boolean; error?: string } {
  if (!isCurrentTurn(state, visitorId)) return { success: false, error: "Not your turn" };
  if (state.drawnThisTurn) return { success: false, error: "Already drew cards this turn" };
  if (state.pendingAction) return { success: false, error: "Must resolve pending action first" };

  const player = getPlayer(state, visitorId)!;
  const drawCount = (player.role === "luna" && !player.isSilenced) ? 3 : 2;

  // Cedric's choice is handled separately via cedric_choose_source
  // Default draw from deck
  const drawn: GameCard[] = [];
  for (let i = 0; i < drawCount; i++) {
    const card = drawFromPile(state);
    if (card) {
      drawn.push(card);
      player.hand.push(card);
    }
  }

  state.drawnThisTurn = true;
  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `drew ${drawn.length} cards`);

  return { success: true };
}

// Cedric draws from discard pile instead
export function cedricDrawFromDiscard(state: GameState, visitorId: string): { success: boolean; error?: string } {
  const player = getPlayer(state, visitorId);
  if (!player || player.role !== "cedric" || player.isSilenced) {
    return { success: false, error: "Only Cedric can draw from discard" };
  }
  if (!isCurrentTurn(state, visitorId)) return { success: false, error: "Not your turn" };
  if (state.actionsUsed > 0) return { success: false, error: "Already drew cards this turn" };

  // Take top 2 from discard
  const drawn: GameCard[] = [];
  for (let i = 0; i < 2; i++) {
    if (state.discardPile.length > 0) {
      const card = state.discardPile.pop()!;
      drawn.push(card);
      player.hand.push(card);
    }
  }

  if (drawn.length === 0) {
    return { success: false, error: "Discard pile is empty" };
  }

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `used Cedric's power to draw ${drawn.length} from the discard pile`);

  return { success: true };
}

export function playCard(state: GameState, visitorId: string, cardDefId: string, asProperty?: boolean, targetColor?: PropertyColor): { success: boolean; error?: string; needsTarget?: boolean; pendingAction?: PendingAction } {
  if (!isCurrentTurn(state, visitorId)) return { success: false, error: "Not your turn" };
  if (!state.drawnThisTurn) return { success: false, error: "Must draw cards first" };
  if (state.pendingAction) return { success: false, error: "Must resolve pending action first" };
  if (state.actionsUsed >= state.maxActions) return { success: false, error: "No actions remaining this turn" };

  const player = getPlayer(state, visitorId)!;
  const cardInHand = player.hand.find(c => c.defId === cardDefId);
  if (!cardInHand) return { success: false, error: "Card not in hand" };

  const def = CARD_DEF_MAP[cardDefId];
  if (!def) return { success: false, error: "Unknown card" };

  // Handle different card types
  switch (def.type) {
    case "money":
      // Money always goes to bank
      removeCard(player.hand, cardDefId);
      player.bank.push({ defId: cardDefId });
      state.actionsUsed++;
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        `banked ${def.name}`, def.image);
      return { success: true };

    case "property":
      removeCard(player.hand, cardDefId);
      player.properties.push({ defId: cardDefId, assignedColor: def.color });
      state.actionsUsed++;
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        `played ${def.name}`, def.image);
      checkWinCondition(state, visitorId);
      return { success: true };

    case "wild":
      return playWildCard(state, player, cardDefId, def, targetColor);

    case "rent":
      return playRentCard(state, player, cardDefId, def, targetColor);

    case "action":
      return playActionCard(state, player, cardDefId, def);

    default:
      return { success: false, error: "Cannot play this card type" };
  }
}

function playWildCard(state: GameState, player: PlayerState, cardDefId: string, def: typeof CARD_DEF_MAP[string], targetColor?: PropertyColor): { success: boolean; error?: string } {
  if (def.wildColors === "rainbow") {
    if (!targetColor) return { success: false, error: "Must choose a color for rainbow wild" };
    removeCard(player.hand, cardDefId);
    player.properties.push({ defId: cardDefId, assignedColor: targetColor });
    state.actionsUsed++;
    addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
      `played Polyjuice Potion as ${targetColor}`, def.image);
  } else if (Array.isArray(def.wildColors)) {
    // Two-color wild: if targetColor specified, use it; otherwise default to first color
    const color = targetColor && def.wildColors.includes(targetColor) ? targetColor : def.wildColors[0];
    removeCard(player.hand, cardDefId);
    player.properties.push({ defId: cardDefId, assignedColor: color });
    state.actionsUsed++;
    addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
      `played ${def.name} as ${color}`, def.image);
  }
  checkWinCondition(state, player.visitorId);
  return { success: true };
}

function playRentCard(state: GameState, player: PlayerState, cardDefId: string, def: typeof CARD_DEF_MAP[string], targetColor?: PropertyColor): { success: boolean; error?: string } {
  // Determine which color to charge rent for
  let rentColor: PropertyColor | undefined;

  if (def.rentColors === "rainbow") {
    // Rainbow rent: player chooses any color they own property of
    if (!targetColor) return { success: false, error: "Must choose a color for rainbow rent" };
    rentColor = targetColor;
  } else if (Array.isArray(def.rentColors)) {
    // Two-color rent: must choose one of the pair
    if (targetColor && (def.rentColors as PropertyColor[]).includes(targetColor)) {
      rentColor = targetColor;
    } else {
      // Default to whichever color the player has more properties of
      const [c1, c2] = def.rentColors;
      const count1 = getPropertiesOfColor(player, c1).length;
      const count2 = getPropertiesOfColor(player, c2).length;
      rentColor = count1 >= count2 ? c1 : c2;
    }
  }

  if (!rentColor) return { success: false, error: "Invalid rent color" };

  const rentAmount = calculateRent(player, rentColor);
  if (rentAmount === 0) return { success: false, error: "No properties of that color — rent is 0" };

  // Remove from hand, discard
  removeCard(player.hand, cardDefId);
  state.discardPile.push({ defId: cardDefId });
  state.actionsUsed++;

  // Charge all other players
  const targets = state.players.filter(p => p.visitorId !== player.visitorId);
  
  for (const target of targets) {
    // Check Harry's protection
    if (target.protectedColor === rentColor) {
      addEvent(state, target.animal.emoji, target.animal.name, target.animal.colorClass,
        `is protected from ${rentColor} rent by Harry's shield`);
      continue;
    }

    // Set pending action for each target (process one at a time)
    if (!state.pendingAction) {
      state.pendingAction = {
        type: "pay_rent",
        sourcePlayerId: player.visitorId,
        targetPlayerId: target.visitorId,
        amount: rentAmount,
        cardDefId,
        data: { rentColor, remainingTargets: targets.filter(t => t.visitorId !== target.visitorId).map(t => t.visitorId) },
      };
    }
  }

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `charged ${rentAmount}G ${rentColor} rent`, def.image);

  return { success: true };
}

function playActionCard(state: GameState, player: PlayerState, cardDefId: string, def: typeof CARD_DEF_MAP[string]): { success: boolean; error?: string; needsTarget?: boolean } {
  switch (def.actionType) {
    case "felix_felicis": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      // Draw 2 more cards
      for (let i = 0; i < 2; i++) {
        const card = drawFromPile(state);
        if (card) player.hand.push(card);
      }
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "used Felix Felicis — drew 2 extra cards", def.image);
      return { success: true };
    }

    case "accio": {
      // Needs target selection — return that info
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      state.pendingAction = {
        type: "choose_steal",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId, // Attacker picks
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "cast Accio — choose a property to steal", def.image);
      return { success: true, needsTarget: true };
    }

    case "confundus_charm": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      state.pendingAction = {
        type: "choose_swap",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId, // Attacker picks
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "cast Confundus Charm — choose properties to swap", def.image);
      return { success: true, needsTarget: true };
    }

    case "expelliarmus": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      state.pendingAction = {
        type: "choose_steal_set",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId,
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "cast Expelliarmus — choose a complete set to steal", def.image);
      return { success: true, needsTarget: true };
    }

    case "gringotts_goblin": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      // Needs target player
      state.pendingAction = {
        type: "pay_debt",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId, // Will be set when target chosen
        amount: 5,
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "sent a Gringotts Goblin — choose who owes 5G", def.image);
      return { success: true, needsTarget: true };
    }

    case "yule_ball": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      // All other players owe 2G
      const targets = state.players.filter(p => p.visitorId !== player.visitorId);
      if (targets.length > 0) {
        state.pendingAction = {
          type: "pay_birthday",
          sourcePlayerId: player.visitorId,
          targetPlayerId: targets[0].visitorId,
          amount: 2,
          cardDefId,
          data: { remainingTargets: targets.slice(1).map(t => t.visitorId) },
        };
      }
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "threw a Yule Ball — everyone pays 2G", def.image);
      return { success: true };
    }

    case "reducto": {
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      state.pendingAction = {
        type: "choose_reducto",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId, // Attacker picks
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "cast Reducto — choose what to destroy", def.image);
      return { success: true, needsTarget: true };
    }

    case "silencio": {
      // Silencio is paid during attacker's own turn (costs the action)
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      state.pendingAction = {
        type: "choose_silencio",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId, // Attacker picks target
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "cast Silencio — choose who to silence", def.image);
      return { success: true, needsTarget: true };
    }

    case "time_turner": {
      // Draw ANY card from discard pile, must play it immediately
      removeCard(player.hand, cardDefId);
      state.discardPile.push({ defId: cardDefId });
      state.actionsUsed++;
      
      if (state.discardPile.length <= 1) { // Only the Time-Turner itself
        addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
          "used Time-Turner but the discard pile is empty", def.image);
        return { success: true };
      }
      
      // Player chooses card from discard pile (excluding the Time-Turner just discarded)
      state.pendingAction = {
        type: "time_turner_play",
        sourcePlayerId: player.visitorId,
        targetPlayerId: player.visitorId,
        cardDefId,
      };
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "activated the Time-Turner — choose a card from the discard pile", def.image);
      return { success: true, needsTarget: true };
    }

    case "protego": {
      // Protego is typically played reactively, but can be banked
      // If played as an action on your turn, it goes to bank
      removeCard(player.hand, cardDefId);
      player.bank.push({ defId: cardDefId });
      state.actionsUsed++;
      addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
        "banked Protego for later use", def.image);
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown action type" };
  }
}

export function bankCard(state: GameState, visitorId: string, cardDefId: string): { success: boolean; error?: string } {
  if (!isCurrentTurn(state, visitorId)) return { success: false, error: "Not your turn" };
  if (!state.drawnThisTurn) return { success: false, error: "Must draw cards first" };
  if (state.pendingAction) return { success: false, error: "Must resolve pending action first" };
  if (state.actionsUsed >= state.maxActions) return { success: false, error: "No actions remaining" };

  const player = getPlayer(state, visitorId)!;
  const card = removeCard(player.hand, cardDefId);
  if (!card) return { success: false, error: "Card not in hand" };

  const def = CARD_DEF_MAP[cardDefId];
  if (!def || def.value === 0) return { success: false, error: "This card has no bank value" };

  player.bank.push(card);
  state.actionsUsed++;

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `banked ${def.name} (${def.value}G)`, def.image);

  return { success: true };
}

export function endTurn(state: GameState, visitorId: string): { success: boolean; error?: string } {
  if (!isCurrentTurn(state, visitorId)) return { success: false, error: "Not your turn" };
  if (state.pendingAction) return { success: false, error: "Must resolve pending action first" };

  const player = getPlayer(state, visitorId)!;

  // Check if player has Harry role and needs to protect a color
  if (player.role === "harry" && !player.isSilenced && !player.protectedColor) {
    // Harry can choose to protect or skip
    state.pendingAction = {
      type: "harry_protect",
      sourcePlayerId: visitorId,
      targetPlayerId: visitorId,
    };
    return { success: true };
  }

  return finalizeTurn(state, visitorId);
}

function finalizeTurn(state: GameState, visitorId: string): { success: boolean; error?: string } {
  const player = getPlayer(state, visitorId)!;

  // Discard down to 7 cards
  if (player.hand.length > 7) {
    state.pendingAction = {
      type: "discard_excess",
      sourcePlayerId: visitorId,
      targetPlayerId: visitorId,
      data: { mustDiscard: player.hand.length - 7 },
    };
    return { success: true };
  }

  // Advance turn
  advanceTurn(state);
  return { success: true };
}

function advanceTurn(state: GameState) {
  // Clear protected color from previous Harry turn (protection lasts until their next turn)
  const currentPlayer = getCurrentPlayer(state);
  if (currentPlayer) {
    addEvent(state, currentPlayer.animal.emoji, currentPlayer.animal.name, currentPlayer.animal.colorClass,
      "ended their turn");
  }

  // Move to next player
  state.currentTurnIndex = (state.currentTurnIndex + 1) % state.players.length;
  state.actionsUsed = 0;
  state.drawnThisTurn = false;
  state.pendingAction = null;

  const next = getCurrentPlayer(state)!;
  
  // Reset Harry's protection at start of their new turn
  if (next.role === "harry") {
    next.protectedColor = undefined;
  }

  // Set max actions
  state.maxActions = (next.role === "hermione" && !next.isSilenced) ? 4 : 3;

  // Reset turn timer
  state.turnTimer = state.gameSpeed;

  addEvent(state, next.animal.emoji, next.animal.name, next.animal.colorClass,
    "starts their turn");

  // Cedric choice at start of turn
  if (next.role === "cedric" && !next.isSilenced && state.discardPile.length >= 2) {
    state.pendingAction = {
      type: "cedric_draw_choice",
      sourcePlayerId: next.visitorId,
      targetPlayerId: next.visitorId,
    };
  }
}

// ========== FLIP WILD ==========

export function flipWild(state: GameState, visitorId: string, cardDefId: string, newColor: PropertyColor): { success: boolean; error?: string } {
  // Flipping a wild does NOT cost a turn
  const player = getPlayer(state, visitorId);
  if (!player) return { success: false, error: "Player not found" };

  const cardIdx = player.properties.findIndex(c => c.defId === cardDefId);
  if (cardIdx === -1) return { success: false, error: "Card not in properties" };

  const def = CARD_DEF_MAP[cardDefId];
  if (!def || def.type !== "wild") return { success: false, error: "Not a wild card" };

  // Validate color
  if (def.wildColors === "rainbow") {
    // Rainbow can be any color
    player.properties[cardIdx].assignedColor = newColor;
  } else if (Array.isArray(def.wildColors)) {
    if (!def.wildColors.includes(newColor)) {
      return { success: false, error: `Invalid color for this wild card. Choose ${def.wildColors.join(" or ")}` };
    }
    player.properties[cardIdx].assignedColor = newColor;
  }

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `flipped ${def.name} to ${newColor}`, def.image);

  checkWinCondition(state, visitorId);
  return { success: true };
}

// ========== PAYMENT SYSTEM ==========

export function payWithCards(state: GameState, visitorId: string, cardDefIds: string[]): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending) return { success: false, error: "No pending payment" };
  if (pending.targetPlayerId !== visitorId) return { success: false, error: "Not your payment to make" };

  const player = getPlayer(state, visitorId)!;
  const source = getPlayer(state, pending.sourcePlayerId)!;
  const amount = pending.amount ?? 0;

  // Collect payment cards from bank and properties
  const paymentCards: GameCard[] = [];
  let paymentValue = 0;

  for (const defId of cardDefIds) {
    // Try bank first, then properties
    let card = removeCard(player.bank, defId);
    if (!card) {
      card = removeCard(player.properties, defId);
    }
    if (!card) return { success: false, error: `Card ${defId} not found in bank or properties` };
    
    paymentCards.push(card);
    paymentValue += cardValue(card);
  }

  // "Pay what you can" rule — if player has no cards, they owe nothing
  const totalAvailable = totalValue([...player.bank, ...player.properties]);
  if (totalAvailable === 0 && paymentCards.length === 0) {
    // Player has nothing — debt forgiven
    addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
      "has nothing to pay with — debt forgiven");
    resolvePayment(state);
    return { success: true };
  }

  // Transfer payment cards to source player's bank
  for (const card of paymentCards) {
    source.bank.push(card);
  }

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `paid ${paymentValue}G`);

  resolvePayment(state);
  return { success: true };
}

function resolvePayment(state: GameState) {
  const pending = state.pendingAction;
  if (!pending) return;

  // Check if there are remaining targets (for rent/yule ball)
  if (pending.data?.remainingTargets?.length > 0) {
    const nextTarget = pending.data.remainingTargets.shift();
    const nextPlayer = getPlayer(state, nextTarget);
    
    if (nextPlayer) {
      // Check Harry protection
      if (pending.type === "pay_rent" && nextPlayer.protectedColor === pending.data?.rentColor) {
        addEvent(state, nextPlayer.animal.emoji, nextPlayer.animal.name, nextPlayer.animal.colorClass,
          "is protected by Harry's shield");
        resolvePayment(state);
        return;
      }

      state.pendingAction = {
        ...pending,
        targetPlayerId: nextTarget,
        data: { ...pending.data },
      };
      return;
    }
  }

  state.pendingAction = null;
}

// ========== PROTEGO (Just Say No) ==========

export function playProtego(state: GameState, visitorId: string): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending) return { success: false, error: "No pending action to counter" };
  if (pending.targetPlayerId !== visitorId) return { success: false, error: "Not targeted at you" };

  const player = getPlayer(state, visitorId)!;
  
  // Find protego in hand
  const protegoIdx = player.hand.findIndex(c => {
    const def = CARD_DEF_MAP[c.defId];
    return def?.actionType === "protego";
  });
  if (protegoIdx === -1) return { success: false, error: "No Protego in hand" };

  // Remove Protego and discard it
  const protego = player.hand.splice(protegoIdx, 1)[0];
  state.discardPile.push(protego);

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    "cast Protego — action blocked!", "action_protego.png");

  // The original attacker can counter with their own Protego (unlimited chain)
  const attacker = getPlayer(state, pending.sourcePlayerId);
  if (attacker && hasProtego(attacker)) {
    // Swap: now the attacker is being asked if they want to counter
    state.pendingAction = {
      type: "protego_response",
      sourcePlayerId: visitorId, // The one who just cast Protego
      targetPlayerId: pending.sourcePlayerId, // Original attacker can counter
      cardDefId: pending.cardDefId,
      data: { originalAction: pending },
    };
  } else {
    // Action fully blocked
    state.pendingAction = null;
  }

  return { success: true };
}

export function declineProtego(state: GameState, visitorId: string): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending) return { success: false, error: "No pending action" };
  if (pending.targetPlayerId !== visitorId) return { success: false, error: "Not your decision" };

  if (pending.type === "protego_response") {
    // Attacker declines to counter — original action is blocked
    state.pendingAction = null;
    addEvent(state, "🛡️", "System", "#888", "Protego stands — action cancelled");
  }

  return { success: true };
}

// ========== TARGET SELECTION ==========

export function chooseTarget(state: GameState, visitorId: string, targetPlayerId: string, targetCardDefId?: string, ownCardDefId?: string): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending) return { success: false, error: "No pending action" };
  if (pending.sourcePlayerId !== visitorId) return { success: false, error: "Not your action" };

  const attacker = getPlayer(state, visitorId)!;
  const target = getPlayer(state, targetPlayerId);
  if (!target) return { success: false, error: "Target player not found" };

  switch (pending.type) {
    case "choose_steal": {
      // Accio: steal a single property
      if (!targetCardDefId) return { success: false, error: "Must choose a property to steal" };
      const def = CARD_DEF_MAP[targetCardDefId];
      if (!def) return { success: false, error: "Invalid card" };
      
      const targetColor = getEffectiveColor(target.properties.find(c => c.defId === targetCardDefId)!);
      
      // Check if from complete set (only Draco can do this)
      if (targetColor && isSetComplete(target, targetColor) && attacker.role !== "draco") {
        return { success: false, error: "Cannot steal from a complete set (unless you're Draco)" };
      }

      // Check Harry protection
      if (target.protectedColor && targetColor === target.protectedColor) {
        return { success: false, error: "That color is protected by Harry's shield" };
      }

      // Set pending for target to potentially Protego
      state.pendingAction = {
        type: "protego_response",
        sourcePlayerId: visitorId,
        targetPlayerId: targetPlayerId,
        cardDefId: pending.cardDefId,
        data: {
          originalAction: {
            type: "choose_steal",
            sourcePlayerId: visitorId,
            targetPlayerId: targetPlayerId,
            data: { targetCardDefId },
          },
        },
      };

      // If target has no Protego, execute immediately
      if (!hasProtego(target)) {
        const card = removeCard(target.properties, targetCardDefId);
        if (card) {
          attacker.properties.push(card);
          addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
            `used Accio to steal ${def.name} from ${target.animal.name}`, def.image);
        }
        state.pendingAction = null;
        checkWinCondition(state, visitorId);
      }

      return { success: true };
    }

    case "choose_swap": {
      // Confundus: swap one of your properties with one of theirs
      if (!targetCardDefId || !ownCardDefId) return { success: false, error: "Must choose both cards to swap" };

      const theirColor = getEffectiveColor(target.properties.find(c => c.defId === targetCardDefId)!);
      
      if (theirColor && isSetComplete(target, theirColor) && attacker.role !== "draco") {
        return { success: false, error: "Cannot swap from a complete set (unless Draco)" };
      }

      if (target.protectedColor && theirColor === target.protectedColor) {
        return { success: false, error: "That color is protected" };
      }

      // If target has Protego, they can block
      if (hasProtego(target)) {
        state.pendingAction = {
          type: "protego_response",
          sourcePlayerId: visitorId,
          targetPlayerId: targetPlayerId,
          cardDefId: pending.cardDefId,
          data: {
            originalAction: {
              type: "choose_swap",
              sourcePlayerId: visitorId,
              targetPlayerId: targetPlayerId,
              data: { targetCardDefId, ownCardDefId },
            },
          },
        };
      } else {
        // Execute swap
        const theirCard = removeCard(target.properties, targetCardDefId);
        const ourCard = removeCard(attacker.properties, ownCardDefId);
        if (theirCard && ourCard) {
          attacker.properties.push(theirCard);
          target.properties.push(ourCard);
          const theirDef = CARD_DEF_MAP[targetCardDefId];
          const ourDef = CARD_DEF_MAP[ownCardDefId];
          addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
            `used Confundus to swap ${ourDef?.name} for ${theirDef?.name} from ${target.animal.name}`);
        }
        state.pendingAction = null;
        checkWinCondition(state, visitorId);
      }

      return { success: true };
    }

    case "choose_steal_set": {
      // Expelliarmus: steal a complete set
      if (!targetCardDefId) return { success: false, error: "Must choose a color" };
      const color = targetCardDefId as PropertyColor; // Reusing field for color
      
      if (!isSetComplete(target, color)) {
        return { success: false, error: "That's not a complete set" };
      }

      if (target.protectedColor === color) {
        return { success: false, error: "That color is protected" };
      }

      if (hasProtego(target)) {
        state.pendingAction = {
          type: "protego_response",
          sourcePlayerId: visitorId,
          targetPlayerId: targetPlayerId,
          cardDefId: pending.cardDefId,
          data: { originalAction: { type: "choose_steal_set", data: { color } } },
        };
      } else {
        // Steal all cards of that color
        const stolen = target.properties.filter(c => getEffectiveColor(c) === color);
        target.properties = target.properties.filter(c => getEffectiveColor(c) !== color);
        attacker.properties.push(...stolen);
        addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
          `used Expelliarmus to steal the ${color} set from ${target.animal.name}`);
        state.pendingAction = null;
        checkWinCondition(state, visitorId);
      }

      return { success: true };
    }

    case "pay_debt": {
      // Gringotts Goblin: target chosen
      state.pendingAction = {
        type: "pay_debt",
        sourcePlayerId: visitorId,
        targetPlayerId: targetPlayerId,
        amount: 5,
        cardDefId: pending.cardDefId,
      };

      if (hasProtego(target)) {
        state.pendingAction = {
          type: "protego_response",
          sourcePlayerId: visitorId,
          targetPlayerId: targetPlayerId,
          cardDefId: pending.cardDefId,
          data: { originalAction: state.pendingAction },
        };
      }

      addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
        `sent a Gringotts Goblin to ${target.animal.name} — owes 5G`);

      return { success: true };
    }

    case "choose_reducto": {
      // Reducto: attacker picks a card from target to discard
      if (!targetCardDefId) return { success: false, error: "Must choose a card to destroy" };

      const theirColor = getEffectiveColor(target.properties.find(c => c.defId === targetCardDefId) || { defId: targetCardDefId });
      
      // Can target complete sets if attacker is Draco
      if (theirColor && isSetComplete(target, theirColor) && attacker.role !== "draco") {
        return { success: false, error: "Cannot target complete sets (unless Draco)" };
      }

      if (target.protectedColor && theirColor === target.protectedColor) {
        return { success: false, error: "That color is protected" };
      }

      if (hasProtego(target)) {
        state.pendingAction = {
          type: "protego_response",
          sourcePlayerId: visitorId,
          targetPlayerId: targetPlayerId,
          cardDefId: pending.cardDefId,
          data: { originalAction: { type: "choose_reducto", data: { targetCardDefId } } },
        };
      } else {
        // Discard the targeted card
        let card = removeCard(target.properties, targetCardDefId);
        if (!card) card = removeCard(target.bank, targetCardDefId);
        if (card) {
          state.discardPile.push(card);
          const def = CARD_DEF_MAP[targetCardDefId];
          addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
            `used Reducto to destroy ${def?.name} from ${target.animal.name}`, def?.image);
        }
        state.pendingAction = null;
      }

      return { success: true };
    }

    case "choose_silencio": {
      // Silence a player's role
      if (hasProtego(target)) {
        state.pendingAction = {
          type: "protego_response",
          sourcePlayerId: visitorId,
          targetPlayerId: targetPlayerId,
          cardDefId: pending.cardDefId,
          data: { originalAction: { type: "choose_silencio" } },
        };
      } else {
        target.isSilenced = true;
        addEvent(state, attacker.animal.emoji, attacker.animal.name, attacker.animal.colorClass,
          `used Silencio on ${target.animal.name} — role power disabled`);
        state.pendingAction = null;
      }
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown pending action type" };
  }
}

// ========== SPECIAL ACTIONS ==========

export function harryProtectColor(state: GameState, visitorId: string, color?: PropertyColor): { success: boolean; error?: string } {
  const player = getPlayer(state, visitorId);
  if (!player || player.role !== "harry" || player.isSilenced) {
    return { success: false, error: "Only Harry can protect a color" };
  }

  player.protectedColor = color; // undefined means skip protection

  if (color) {
    addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
      `placed a protective charm on ${color} properties`);
  }

  state.pendingAction = null;
  return finalizeTurn(state, visitorId);
}

export function cedricChooseSource(state: GameState, visitorId: string, source: "deck" | "discard"): { success: boolean; error?: string } {
  const player = getPlayer(state, visitorId);
  if (!player) return { success: false, error: "Player not found" };
  
  state.pendingAction = null;

  if (source === "discard") {
    return cedricDrawFromDiscard(state, visitorId);
  }
  // "deck" — normal draw happens via drawCards
  return { success: true };
}

export function timeTurnerChoose(state: GameState, visitorId: string, cardDefId: string): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "time_turner_play") return { success: false, error: "No Time-Turner action pending" };

  const player = getPlayer(state, visitorId)!;
  
  // Find the card in discard pile
  const idx = state.discardPile.findIndex(c => c.defId === cardDefId);
  if (idx === -1) return { success: false, error: "Card not in discard pile" };

  // Remove from discard, add to hand
  const card = state.discardPile.splice(idx, 1)[0];
  player.hand.push(card);

  const def = CARD_DEF_MAP[cardDefId];
  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `retrieved ${def?.name} from the discard pile with Time-Turner`, def?.image);

  // Must play it immediately (it counts as the Time-Turner action already used)
  // For now, clear pending - the card is in hand and player must play it
  state.pendingAction = null;
  
  return { success: true };
}

export function paySilencio(state: GameState, visitorId: string, cardDefIds: string[]): { success: boolean; error?: string } {
  const player = getPlayer(state, visitorId);
  if (!player || !player.isSilenced) return { success: false, error: "Not silenced" };

  // Must pay 10G from bank/properties
  let totalPaid = 0;
  const paidCards: GameCard[] = [];

  for (const defId of cardDefIds) {
    let card = removeCard(player.bank, defId);
    if (!card) card = removeCard(player.properties, defId);
    if (!card) return { success: false, error: `Card ${defId} not found` };
    paidCards.push(card);
    totalPaid += cardValue(card);
  }

  if (totalPaid < 10) {
    // Return cards
    for (const card of paidCards) player.bank.push(card);
    return { success: false, error: "Must pay at least 10G to remove Silencio" };
  }

  // Discard payment
  for (const card of paidCards) {
    state.discardPile.push(card);
  }

  player.isSilenced = false;

  // Update max actions if it's their turn and they're Hermione
  const current = getCurrentPlayer(state);
  if (current?.visitorId === visitorId && player.role === "hermione") {
    state.maxActions = 4;
  }

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `paid ${totalPaid}G to remove Silencio`);

  return { success: true };
}

export function discardCards(state: GameState, visitorId: string, cardDefIds: string[]): { success: boolean; error?: string } {
  const pending = state.pendingAction;
  if (!pending || pending.type !== "discard_excess") return { success: false, error: "No discard required" };
  if (pending.targetPlayerId !== visitorId) return { success: false, error: "Not your discard" };

  const player = getPlayer(state, visitorId)!;
  const mustDiscard = pending.data?.mustDiscard ?? 0;

  if (cardDefIds.length !== mustDiscard) {
    return { success: false, error: `Must discard exactly ${mustDiscard} cards` };
  }

  for (const defId of cardDefIds) {
    const card = removeCard(player.hand, defId);
    if (!card) return { success: false, error: `Card ${defId} not in hand` };
    state.discardPile.push(card);
  }

  state.pendingAction = null;

  addEvent(state, player.animal.emoji, player.animal.name, player.animal.colorClass,
    `discarded ${mustDiscard} cards`);

  // Now advance turn
  advanceTurn(state);
  return { success: true };
}

// ========== WIN CONDITION ==========

function checkWinCondition(state: GameState, visitorId: string) {
  const player = getPlayer(state, visitorId);
  if (!player) return;

  const completeSets = countCompleteSets(player.properties, SET_SIZES);
  if (completeSets >= 3) {
    state.winnerId = visitorId;
    state.status = "finished";
    addEvent(state, "🏆", player.animal.name, player.animal.colorClass,
      `has won the game with ${completeSets} complete sets!`);
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
    drawPile: [{ defId: "__hidden__" }], // Just send count indicator
    players: state.players.map(p => ({
      ...p,
      hand: p.visitorId === visitorId ? p.hand : p.hand.map(() => ({ defId: "__hidden__" })),
    })),
  };
}
