/**
 * GameRoom — one Durable Object per room code.
 * Holds the lobby, seats and game state, saves it to Durable Object storage
 * after every event so rooms survive restarts and deploys, and uses
 * WebSocket hibernation so idle rooms cost nothing.
 */
import { DurableObject } from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import type { GameState, WSMessage, AnimalProfile, VariationId } from "../shared/schema";
import { ANIMALS } from "../shared/schema";
import { DEFAULT_VARIATION, isVariationId } from "../shared/variations";
import {
  createInitialGameState, drawCards, playCard, bankCard, endTurn,
  flipWild, payWithCards, playProtego, declineProtego, chooseTarget,
  harryProtectColor, cedricChooseSource, timeTurnerChoose, paySilencio,
  discardCards, sanitizeStateForPlayer, putToSleep, wakeUp, botStep, getWaitingOn,
  cancelChoice, forfeit,
} from "./gameEngine";
import { parseMessage, MessageRateLimiter, MAX_SOCKETS_PER_ROOM, MAX_SOCKETS_PER_VISITOR } from "./security";

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  // Per-IP limit on creating and joining rooms (see wrangler.jsonc)
  ROOM_LIMITER?: RateLimit;
}

// Rooms with no moves, chat or new connections for this long are deleted,
// and a finished game is cleared away sooner. Each room's own alarm does
// this, so there's no sweep job to run or pay for.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const FINISHED_TTL_MS = 60 * 60 * 1000;

// Close code the client reads as "this room is gone, don't reconnect".
export const ROOM_CLOSED_CODE = 4000;

// ========== TYPES ==========

interface RoomClient {
  visitorId: string;
  animal: AnimalProfile;
  seatIndex: number | null; // null = spectator
  isReady: boolean;
}

interface Room {
  code: string;
  hostVisitorId: string;
  gameSpeed: number;
  variation: VariationId;
  clients: Map<string, RoomClient>;
  gameState: GameState | null;
  usedAnimals: number[];
  timerSetAt: number; // when gameState.turnTimer was last brought up to date
  lastActivity: number;
  // Not persisted: how to reach the room's open sockets.
  sockets: () => { ws: WebSocket; visitorId: string }[];
  lastWaitingOn: string | null; // whose move the game was last waiting on
  botDueAt: number | null; // when a sleeping player's next bot move is due
  moveBonuses: number; // extra-time bonuses given since the game last started waiting on someone new
  finishedAt: number | null; // when the game ended
}

type StoredRoom = Omit<Room, "clients" | "sockets"> & { clients: RoomClient[] };

// ========== HELPERS ==========

function getRandomAnimal(room: Room): AnimalProfile {
  const available = ANIMALS.map((_, i) => i).filter(i => !room.usedAnimals.includes(i));
  if (available.length === 0) {
    // All used, just pick random
    return ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  }
  const idx = available[Math.floor(Math.random() * available.length)];
  room.usedAnimals.push(idx);
  return ANIMALS[idx];
}

function send(ws: WebSocket, data: string) {
  try {
    ws.send(data);
  } catch {
    // Socket already closing
  }
}

function broadcastToRoom(room: Room, msg: WSMessage, exclude?: string) {
  const data = JSON.stringify(msg);
  for (const { ws, visitorId } of room.sockets()) {
    if (visitorId !== exclude) send(ws, data);
  }
}

function sendToClient(room: Room, client: RoomClient, msg: WSMessage) {
  const data = JSON.stringify(msg);
  for (const { ws, visitorId } of room.sockets()) {
    if (visitorId === client.visitorId) send(ws, data);
  }
}

function sendError(room: Room, client: RoomClient, error: string) {
  sendToClient(room, client, { type: "error", payload: { error } });
}

/** People in the room who aren't playing: they watch, and never see anyone's hand. */
function spectatorsOf(room: Room): AnimalProfile[] {
  const players = new Set(room.gameState?.players.map(p => p.visitorId));
  return [...room.clients.values()].filter(c => !players.has(c.visitorId)).map(c => c.animal);
}

function gameViewFor(room: Room, visitorId: string, spectators = spectatorsOf(room)): GameState {
  return sanitizeStateForPlayer({ ...room.gameState!, spectators }, visitorId);
}

function broadcastGameState(room: Room) {
  if (!room.gameState) return;
  const spectators = spectatorsOf(room);
  for (const { ws, visitorId } of room.sockets()) {
    send(ws, JSON.stringify({ type: "game_state", payload: gameViewFor(room, visitorId, spectators) }));
  }
}

function getLobbyState(room: Room): any {
  const seats: (any | null)[] = Array(5).fill(null);
  const spectators: AnimalProfile[] = [];

  for (const [vid, client] of room.clients) {
    if (client.seatIndex !== null) {
      seats[client.seatIndex] = {
        visitorId: vid,
        animal: client.animal,
        isReady: client.isReady,
        isHost: vid === room.hostVisitorId,
        isBot: isBotId(vid),
      };
    } else {
      spectators.push(client.animal);
    }
  }

  return {
    roomCode: room.code,
    hostVisitorId: room.hostVisitorId,
    gameSpeed: room.gameSpeed,
    variation: room.variation,
    seats,
    spectators,
    status: room.gameState ? "playing" : "lobby",
  };
}

function broadcastLobbyState(room: Room) {
  const lobbyState = getLobbyState(room);
  broadcastToRoom(room, { type: "game_state", payload: lobbyState });
}

// ========== TURN TIMER ==========
// The timer is counted down lazily from timerSetAt instead of ticking every
// second, so a sleeping room does no work. Clients count down locally.

function tickTurnTimer(room: Room) {
  const state = room.gameState;
  if (!state || state.status !== "playing") return;
  const elapsed = Math.floor((Date.now() - room.timerSetAt) / 1000);
  if (elapsed <= 0) return;
  state.turnTimer = Math.max(0, state.turnTimer - elapsed);
  room.timerSetAt += elapsed * 1000;
}

function turnDeadline(room: Room): number | null {
  const state = room.gameState;
  if (!state || state.status !== "playing" || state.turnTimer <= 0) return null;
  return room.timerSetAt + state.turnTimer * 1000;
}

// Each move a player makes while the game waits on them adds a little time,
// so someone actively playing isn't rushed. Capped per stretch so taking a
// card back and replaying it can't stall the table forever.
const MOVE_BONUS_SECONDS = 10;
const MAX_MOVE_BONUSES = 5;
const TIMED_MOVES = new Set([
  "draw_cards", "play_card", "bank_card", "choose_target", "cedric_choose_source", "time_turner_choose",
]);

// ========== MESSAGE HANDLERS ==========

function handleJoinRoom(room: Room, client: RoomClient, payload: any) {
  // Client is already added — tell everyone (players see who is watching)
  if (room.gameState) {
    const existingPlayer = room.gameState.players.find(p => p.visitorId === client.visitorId);
    if (existingPlayer) {
      // Reconnection during game
      existingPlayer.isConnected = true;
      client.seatIndex = existingPlayer.seatIndex;
    }
    broadcastGameState(room);
  } else {
    broadcastLobbyState(room);
  }
}

function handleSitDown(room: Room, client: RoomClient, payload: any) {
  if (room.gameState) return sendError(room, client, "Game already in progress");
  
  const seatIndex = payload?.seatIndex;
  if (typeof seatIndex !== "number" || seatIndex < 0 || seatIndex > 4) {
    return sendError(room, client, "Invalid seat");
  }

  // Check if seat is taken
  for (const [_, c] of room.clients) {
    if (c.seatIndex === seatIndex && c.visitorId !== client.visitorId) {
      return sendError(room, client, "Seat already taken");
    }
  }

  client.seatIndex = seatIndex;
  client.isReady = false;
  broadcastLobbyState(room);
}

function handleStandUp(room: Room, client: RoomClient) {
  if (room.gameState) return sendError(room, client, "Game in progress");
  client.seatIndex = null;
  client.isReady = false;
  broadcastLobbyState(room);
}

function handleToggleReady(room: Room, client: RoomClient) {
  if (room.gameState) return;
  if (client.seatIndex === null) return sendError(room, client, "Must be seated");
  client.isReady = !client.isReady;
  broadcastLobbyState(room);
}

function handleSetGameSpeed(room: Room, client: RoomClient, payload: any) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only host can change speed");
  if (room.gameState) return sendError(room, client, "Game in progress");
  
  const speed = payload?.speed;
  if (![30, 60, 90].includes(speed)) return sendError(room, client, "Invalid speed");
  
  room.gameSpeed = speed;
  broadcastLobbyState(room);
}

function handleSetVariation(room: Room, client: RoomClient, payload: any) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only the host can change the game");
  if (room.gameState) return sendError(room, client, "Game in progress");
  if (!isVariationId(payload?.variation)) return sendError(room, client, "Unknown game version");

  room.variation = payload.variation;
  broadcastLobbyState(room);
}

// ----- Practice bots: seats with no person behind them, played by botStep -----

const BOT_PREFIX = "bot_";
const isBotId = (visitorId: string) => visitorId.startsWith(BOT_PREFIX);

function handleAddBot(room: Room, client: RoomClient) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only the host can add bots");
  if (room.gameState) return sendError(room, client, "Game already in progress");
  const taken = new Set([...room.clients.values()].map(c => c.seatIndex));
  const seatIndex = [0, 1, 2, 3, 4].find(i => !taken.has(i));
  if (seatIndex === undefined) return sendError(room, client, "No open seats");
  const visitorId = BOT_PREFIX + crypto.randomUUID();
  room.clients.set(visitorId, { visitorId, animal: getRandomAnimal(room), seatIndex, isReady: true });
  broadcastLobbyState(room);
}

function handleRemoveBot(room: Room, client: RoomClient, payload: any) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only the host can remove bots");
  if (room.gameState) return sendError(room, client, "Game already in progress");
  const id = payload?.visitorId;
  if (typeof id !== "string" || !isBotId(id)) return sendError(room, client, "That isn't a bot");
  room.clients.delete(id);
  broadcastLobbyState(room);
}

function handleStartGame(room: Room, client: RoomClient) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only host can start");
  if (room.gameState) return sendError(room, client, "Game already started");

  // Collect seated & ready players
  const seatedPlayers: { visitorId: string; seatIndex: number; animal: AnimalProfile; isBot: boolean }[] = [];
  for (const [vid, c] of room.clients) {
    if (c.seatIndex !== null && c.isReady) {
      seatedPlayers.push({ visitorId: vid, seatIndex: c.seatIndex, animal: c.animal, isBot: isBotId(vid) });
    }
  }

  if (seatedPlayers.length < 2) return sendError(room, client, "Need at least 2 ready players");
  if (seatedPlayers.length > 5) return sendError(room, client, "Max 5 players");

  // Sort by seat index
  seatedPlayers.sort((a, b) => a.seatIndex - b.seatIndex);

  room.gameState = createInitialGameState(room.code, seatedPlayers, room.gameSpeed, room.variation);
  room.timerSetAt = Date.now();
  broadcastGameState(room);
}

function handleDrawCards(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = drawCards(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handlePlayCard(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId, asProperty, targetColor } = payload || {};
  const result = playCard(room.gameState, client.visitorId, cardDefId, asProperty, targetColor);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleBankCard(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId } = payload || {};
  const result = bankCard(room.gameState, client.visitorId, cardDefId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleEndTurn(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = endTurn(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  
  // Reset timer
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

function handleFlipWild(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId, newColor } = payload || {};
  const result = flipWild(room.gameState, client.visitorId, cardDefId, newColor);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handlePayWithCards(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = payWithCards(room.gameState, client.visitorId, Array.isArray(cardDefIds) ? cardDefIds : []);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handlePlayProtego(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = playProtego(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleDeclineProtego(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = declineProtego(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleChooseTarget(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { targetPlayerId, targetCardDefId, ownCardDefId } = payload || {};
  const result = chooseTarget(room.gameState, client.visitorId, targetPlayerId, targetCardDefId, ownCardDefId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleHarryProtectColor(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { color } = payload || {};
  const result = harryProtectColor(room.gameState, client.visitorId, color);
  if (!result.success) return sendError(room, client, result.error!);
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

function handleCedricChooseSource(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { source } = payload || {};
  const result = cedricChooseSource(room.gameState, client.visitorId, source);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleTimeTurnerChoose(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId } = payload || {};
  const result = timeTurnerChoose(room.gameState, client.visitorId, cardDefId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handlePaySilencio(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = paySilencio(room.gameState, client.visitorId, Array.isArray(cardDefIds) ? cardDefIds : []);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleDiscardCards(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = discardCards(room.gameState, client.visitorId, Array.isArray(cardDefIds) ? cardDefIds : []);
  if (!result.success) return sendError(room, client, result.error!);
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

function handleSendChat(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { message } = payload || {};
  if (!message || typeof message !== "string") return;

  const chatMsg = {
    id: uuidv4(),
    timestamp: Date.now(),
    playerEmoji: client.animal.emoji,
    playerName: client.animal.name,
    playerColor: client.animal.colorClass,
    message: message.slice(0, 200), // Limit length
  };

  room.gameState.chatMessages.push(chatMsg);
  if (room.gameState.chatMessages.length > 50) {
    room.gameState.chatMessages = room.gameState.chatMessages.slice(-50);
  }

  broadcastToRoom(room, { type: "chat_message", payload: chatMsg });
}

function handlePutToSleep(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const result = putToSleep(room.gameState, client.visitorId, payload?.targetPlayerId);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleWakeUp(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = wakeUp(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

// A player who forfeits leaves the table for good and watches from then on
function handleForfeit(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = forfeit(room.gameState, client.visitorId);
  if (!result.success) return sendError(room, client, result.error!);
  client.seatIndex = null;
  client.isReady = false;
  broadcastGameState(room);
}

// ========== AFTER EVERY GAME CHANGE ==========
// The turn timer restarts whenever the game starts waiting on someone new,
// and a sleeping player's moves are made by the bot, one step at a time.

const BOT_STEP_MS = 900;

function afterGameChange(room: Room) {
  const state = room.gameState;
  if (!state || state.status !== "playing") {
    room.botDueAt = null;
    if (state?.status === "finished") room.finishedAt ??= Date.now();
    return;
  }
  const waitingOn = getWaitingOn(state);
  if (waitingOn !== room.lastWaitingOn) {
    room.lastWaitingOn = waitingOn;
    state.turnTimer = state.gameSpeed;
    room.timerSetAt = Date.now();
    room.moveBonuses = 0;
    broadcastGameState(room);
  }
  // The bot step itself runs from the Durable Object alarm (see GameRoom.alarm)
  const waiting = state.players.find(p => p.visitorId === waitingOn);
  if (waiting?.isSleeping) {
    room.botDueAt ??= Date.now() + BOT_STEP_MS;
  } else {
    room.botDueAt = null;
  }
}

function runBotStep(room: Room) {
  room.botDueAt = null;
  if (!room.gameState) return;
  if (botStep(room.gameState)) broadcastGameState(room);
  afterGameChange(room);
}

// Messages that count as a player taking part in the game (and wake them up)
const GAME_ACTIONS = new Set([
  "draw_cards", "play_card", "bank_card", "end_turn", "flip_wild", "pay_with_cards",
  "play_protego", "decline_protego", "choose_target", "harry_protect_color",
  "cedric_choose_source", "time_turner_choose", "pay_silencio", "discard_cards", "cancel_action",
]);

// ========== MAIN ROUTER ==========

function handleMessage(room: Room, client: RoomClient, msg: WSMessage) {
  const { type } = msg;
  if (room.gameState && GAME_ACTIONS.has(type)) {
    const me = room.gameState.players.find(p => p.visitorId === client.visitorId);
    if (me?.isSleeping) wakeUp(room.gameState, client.visitorId);
  }
  // Add the move bonus up front so the broadcast after the move carries it;
  // take it back if the move was refused (nothing new in the log).
  const state = room.gameState;
  const bonus = !!state && state.status === "playing" && TIMED_MOVES.has(type) &&
    room.moveBonuses < MAX_MOVE_BONUSES && getWaitingOn(state) === client.visitorId;
  const lastEvent = state?.eventLog.at(-1)?.id;
  if (bonus && state) state.turnTimer += MOVE_BONUS_SECONDS;
  routeMessage(room, client, msg);
  if (bonus && state) {
    if (state.eventLog.at(-1)?.id === lastEvent) state.turnTimer -= MOVE_BONUS_SECONDS;
    else room.moveBonuses++;
  }
  afterGameChange(room);
}

function routeMessage(room: Room, client: RoomClient, msg: WSMessage) {
  const { type, payload } = msg;

  switch (type) {
    case "join_room": return handleJoinRoom(room, client, payload);
    case "sit_down": return handleSitDown(room, client, payload);
    case "stand_up": return handleStandUp(room, client);
    case "toggle_ready": return handleToggleReady(room, client);
    case "set_game_speed": return handleSetGameSpeed(room, client, payload);
    case "set_variation": return handleSetVariation(room, client, payload);
    case "start_game": return handleStartGame(room, client);
    case "add_bot": return handleAddBot(room, client);
    case "remove_bot": return handleRemoveBot(room, client, payload);
    case "draw_cards": return handleDrawCards(room, client);
    case "play_card": return handlePlayCard(room, client, payload);
    case "bank_card": return handleBankCard(room, client, payload);
    case "end_turn": return handleEndTurn(room, client);
    case "flip_wild": return handleFlipWild(room, client, payload);
    case "pay_with_cards": return handlePayWithCards(room, client, payload);
    case "play_protego": return handlePlayProtego(room, client);
    case "decline_protego": return handleDeclineProtego(room, client);
    case "choose_target": return handleChooseTarget(room, client, payload);
    case "harry_protect_color": return handleHarryProtectColor(room, client, payload);
    case "cedric_choose_source": return handleCedricChooseSource(room, client, payload);
    case "time_turner_choose": return handleTimeTurnerChoose(room, client, payload);
    case "send_chat": return handleSendChat(room, client, payload);
    case "put_to_sleep": return handlePutToSleep(room, client, payload);
    case "wake_up": return handleWakeUp(room, client);
    case "forfeit": return handleForfeit(room, client);
    case "pay_silencio": return handlePaySilencio(room, client, payload);
    case "discard_cards": return handleDiscardCards(room, client, payload);
    case "cancel_action": {
      if (!room.gameState) return;
      const result = cancelChoice(room.gameState, client.visitorId);
      if (!result.success) return sendError(room, client, result.error!);
      return broadcastGameState(room);
    }
    default:
      sendError(room, client, "Unknown message type");
  }
}

// ========== CLEANUP ==========

function expiresAt(room: Room): number {
  const idle = room.lastActivity + ROOM_TTL_MS;
  if (room.finishedAt === null) return idle;
  return Math.min(idle, Math.max(room.lastActivity, room.finishedAt) + FINISHED_TTL_MS);
}

// ========== DURABLE OBJECT ==========

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private rateLimiter = new MessageRateLimiter();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<StoredRoom>("room");
      if (stored) this.room = this.hydrate(stored);
    });
  }

  private hydrate(stored: StoredRoom): Room {
    return {
      ...stored,
      clients: new Map(stored.clients.map(c => [c.visitorId, c])),
      lastWaitingOn: stored.lastWaitingOn ?? null,
      botDueAt: stored.botDueAt ?? null,
      moveBonuses: stored.moveBonuses ?? 0,
      variation: isVariationId(stored.variation) ? stored.variation : DEFAULT_VARIATION,
      finishedAt: stored.finishedAt ?? null,
      sockets: () => this.ctx.getWebSockets().map(ws => ({
        ws,
        visitorId: (ws.deserializeAttachment() as { visitorId: string }).visitorId,
      })),
    };
  }

  private newRoom(code: string, hostVisitorId: string): Room {
    return this.hydrate({
      code,
      hostVisitorId,
      gameSpeed: 60,
      variation: DEFAULT_VARIATION,
      clients: [],
      gameState: null,
      usedAnimals: [],
      lastWaitingOn: null,
      botDueAt: null,
      moveBonuses: 0,
      finishedAt: null,
      timerSetAt: Date.now(),
      lastActivity: Date.now(),
    });
  }

  /** Save the room and schedule the next alarm (turn timer expiry or room expiry). */
  private async save(room: Room, isActivity = true) {
    if (isActivity) room.lastActivity = Date.now();
    const { sockets, ...rest } = room;
    const stored: StoredRoom = { ...rest, clients: [...room.clients.values()] };
    await this.ctx.storage.put("room", stored);

    const due = [turnDeadline(room), room.botDueAt, expiresAt(room)];
    await this.ctx.storage.setAlarm(Math.min(...due.filter((t): t is number => t !== null)));
  }

  // ----- RPC from the Worker -----

  /** Reserve this room code. Returns false if it is already in use. */
  async create(code: string): Promise<boolean> {
    if (this.room) return false;
    this.room = this.newRoom(code, "");
    await this.save(this.room);
    return true;
  }

  async exists(): Promise<boolean> {
    return this.room !== null;
  }

  // ----- WebSockets -----

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = url.searchParams.get("room")!;
    const visitorId = url.searchParams.get("visitor")!;

    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_SOCKETS_PER_ROOM || this.ctx.getWebSockets(visitorId).length >= MAX_SOCKETS_PER_VISITOR) {
      return new Response("Room is full", { status: 429 });
    }

    const pair = new WebSocketPair();
    const [clientWs, serverWs] = Object.values(pair);
    this.ctx.acceptWebSocket(serverWs, [visitorId]);
    serverWs.serializeAttachment({ visitorId });

    let room = this.room;
    if (!room) {
      // Create room (first person is host)
      room = this.room = this.newRoom(roomCode, visitorId);
    } else if (room.clients.size === 0 || !room.hostVisitorId) {
      // First connection to an empty room — adopt as host
      room.hostVisitorId = visitorId;
    }
    tickTurnTimer(room);

    // Get or create client for this visitor
    let client = room.clients.get(visitorId);
    if (!client) {
      client = {
        visitorId,
        animal: getRandomAnimal(room),
        seatIndex: null,
        isReady: false,
      };
      room.clients.set(visitorId, client);
    }

    // Send initial state
    if (room.gameState) {
      sendToClient(room, client, { type: "game_state", payload: gameViewFor(room, visitorId) });
    } else {
      sendToClient(room, client, { type: "game_state", payload: getLobbyState(room) });
    }

    // Also send the client their identity
    sendToClient(room, client, {
      type: "player_joined",
      payload: { visitorId, animal: client.animal },
    });

    // Mark a returning player connected again and tell everyone
    handleJoinRoom(room, client, null);

    await this.save(room);
    return new Response(null, { status: 101, webSocket: clientWs });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const room = this.room;
    if (!room) return ws.close(1011, "Room closed");
    const { visitorId } = ws.deserializeAttachment() as { visitorId: string };
    const client = room.clients.get(visitorId);
    if (!client) return;

    const msg = parseMessage(data);
    if (typeof msg === "string") return sendError(room, client, msg);

    const rate = this.rateLimiter.check(visitorId, msg.type);
    if (rate !== "ok") {
      if (rate === "warn") sendError(room, client, "You're sending moves too fast. Slow down a little");
      return;
    }

    tickTurnTimer(room);
    try {
      handleMessage(room, client, msg);
    } catch (err) {
      // A bad move must not take the room down; keep whatever state it left
      console.error("Message handler failed", msg.type, err);
      sendError(room, client, "Something went wrong with that move");
    }
    await this.save(room);
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // Already closed
    }
    const room = this.room;
    if (!room) return;
    const { visitorId } = ws.deserializeAttachment() as { visitorId: string };
    const stillOpen = room.sockets().some(s => s.ws !== ws && s.visitorId === visitorId);
    if (stillOpen) return;

    if (room.gameState) {
      // Mid-game the seat is kept: they can rejoin, or be put to sleep and played by the bot.
      // Someone who was only watching just leaves.
      const player = room.gameState.players.find(p => p.visitorId === visitorId);
      if (player) player.isConnected = false;
      // A spectator leaving is forgotten, so drive-by visitors can't pile up in storage
      else room.clients.delete(visitorId);
      tickTurnTimer(room);
      broadcastGameState(room);
      await this.save(room);
      return;
    }

    // In the lobby, someone who leaves gives up their seat, and the host role
    // passes to someone still here so the game can still be started.
    room.clients.delete(visitorId);
    if (room.hostVisitorId === visitorId) {
      room.hostVisitorId = room.sockets().find(s => s.ws !== ws)?.visitorId ?? "";
    }
    broadcastLobbyState(room);
    await this.save(room);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const room = this.room;
    if (!room) return;

    if (Date.now() >= expiresAt(room)) {
      // Abandoned or long-finished room: send anyone still here home, then delete it
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(ROOM_CLOSED_CODE, "Room closed");
        } catch {
          // Already closed
        }
      }
      this.room = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }

    tickTurnTimer(room);
    if (room.botDueAt !== null && Date.now() >= room.botDueAt) {
      // A sleeping player's move
      runBotStep(room);
    } else {
      // Turn timer ran out — show everyone the expired timer
      broadcastGameState(room);
    }
    await this.save(room, false);
  }
}
