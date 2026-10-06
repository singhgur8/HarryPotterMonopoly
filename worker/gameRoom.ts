/**
 * GameRoom — one Durable Object per room code.
 * Holds the lobby, seats and game state, saves it to Durable Object storage
 * after every event so rooms survive restarts and deploys, and uses
 * WebSocket hibernation so idle rooms cost nothing.
 */
import { DurableObject } from "cloudflare:workers";
import { v4 as uuidv4 } from "uuid";
import type { GameState, WSMessage, AnimalProfile } from "../shared/schema";
import { ANIMALS } from "../shared/schema";
import {
  createInitialGameState, drawCards, playCard, bankCard, endTurn,
  flipWild, payWithCards, playProtego, declineProtego, chooseTarget,
  harryProtectColor, cedricChooseSource, timeTurnerChoose, paySilencio,
  discardCards, sanitizeStateForPlayer, putToSleep, wakeUp, botStep, getWaitingOn,
  cancelChoice,
} from "./gameEngine";

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
}

// Rooms nobody has connected to for this long are deleted.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

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
  clients: Map<string, RoomClient>;
  gameState: GameState | null;
  usedAnimals: number[];
  timerSetAt: number; // when gameState.turnTimer was last brought up to date
  lastActivity: number;
  // Not persisted: how to reach the room's open sockets.
  sockets: () => { ws: WebSocket; visitorId: string }[];
  lastWaitingOn: string | null; // whose move the game was last waiting on
  botDueAt: number | null; // when a sleeping player's next bot move is due
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

function broadcastGameState(room: Room) {
  if (!room.gameState) return;
  for (const { ws, visitorId } of room.sockets()) {
    const sanitized = sanitizeStateForPlayer(room.gameState, visitorId);
    send(ws, JSON.stringify({ type: "game_state", payload: sanitized }));
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
      };
    } else {
      spectators.push(client.animal);
    }
  }

  return {
    roomCode: room.code,
    hostVisitorId: room.hostVisitorId,
    gameSpeed: room.gameSpeed,
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

// ========== MESSAGE HANDLERS ==========

function handleJoinRoom(room: Room, client: RoomClient, payload: any) {
  // Client is already added — just send current state
  if (room.gameState && room.gameState.status === "playing") {
    // Reconnection during game
    const existingPlayer = room.gameState.players.find(p => p.visitorId === client.visitorId);
    if (existingPlayer) {
      existingPlayer.isConnected = true;
      client.seatIndex = existingPlayer.seatIndex;
      broadcastGameState(room);
    } else {
      // New spectator during game
      sendToClient(room, client, { type: "game_state", payload: sanitizeStateForPlayer(room.gameState, client.visitorId) });
    }
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

function handleStartGame(room: Room, client: RoomClient) {
  if (client.visitorId !== room.hostVisitorId) return sendError(room, client, "Only host can start");
  if (room.gameState) return sendError(room, client, "Game already started");

  // Collect seated & ready players
  const seatedPlayers: { visitorId: string; seatIndex: number; animal: AnimalProfile }[] = [];
  for (const [vid, c] of room.clients) {
    if (c.seatIndex !== null && c.isReady) {
      seatedPlayers.push({ visitorId: vid, seatIndex: c.seatIndex, animal: c.animal });
    }
  }

  if (seatedPlayers.length < 2) return sendError(room, client, "Need at least 2 ready players");
  if (seatedPlayers.length > 5) return sendError(room, client, "Max 5 players");

  // Sort by seat index
  seatedPlayers.sort((a, b) => a.seatIndex - b.seatIndex);

  room.gameState = createInitialGameState(room.code, seatedPlayers, room.gameSpeed);
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
  const result = payWithCards(room.gameState, client.visitorId, cardDefIds || []);
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
  const result = paySilencio(room.gameState, client.visitorId, cardDefIds || []);
  if (!result.success) return sendError(room, client, result.error!);
  broadcastGameState(room);
}

function handleDiscardCards(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = discardCards(room.gameState, client.visitorId, cardDefIds || []);
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

// ========== AFTER EVERY GAME CHANGE ==========
// The turn timer restarts whenever the game starts waiting on someone new,
// and a sleeping player's moves are made by the bot, one step at a time.

const BOT_STEP_MS = 900;

function afterGameChange(room: Room) {
  const state = room.gameState;
  if (!state || state.status !== "playing") {
    room.botDueAt = null;
    return;
  }
  const waitingOn = getWaitingOn(state);
  if (waitingOn !== room.lastWaitingOn) {
    room.lastWaitingOn = waitingOn;
    state.turnTimer = state.gameSpeed;
    room.timerSetAt = Date.now();
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
  routeMessage(room, client, msg);
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
    case "start_game": return handleStartGame(room, client);
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
    case "pay_silencio": return handlePaySilencio(room, client, payload);
    case "discard_cards": return handleDiscardCards(room, client, payload);
    case "cancel_action": {
      if (!room.gameState) return;
      const result = cancelChoice(room.gameState, client.visitorId);
      if (!result.success) return sendError(room, client, result.error!);
      return broadcastGameState(room);
    }
    default:
      sendError(room, client, `Unknown message type: ${type}`);
  }
}

// ========== DURABLE OBJECT ==========

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;

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
      clients: [],
      gameState: null,
      usedAnimals: [],
      lastWaitingOn: null,
      botDueAt: null,
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

    const due = [turnDeadline(room), room.botDueAt, room.lastActivity + ROOM_TTL_MS];
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
    if (room.gameState && room.gameState.status === "playing") {
      sendToClient(room, client, {
        type: "game_state",
        payload: sanitizeStateForPlayer(room.gameState, visitorId),
      });
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

    let msg: WSMessage;
    try {
      msg = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return sendError(room, client, "Invalid message format");
    }

    tickTurnTimer(room);
    handleMessage(room, client, msg);
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
      // Mid-game the seat is kept: they can rejoin, or be put to sleep and played by the bot
      const player = room.gameState.players.find(p => p.visitorId === visitorId);
      if (player) {
        player.isConnected = false;
        tickTurnTimer(room);
        broadcastGameState(room);
        await this.save(room);
      }
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

    if (this.ctx.getWebSockets().length === 0 && Date.now() - room.lastActivity >= ROOM_TTL_MS) {
      // Abandoned room — delete it
      this.room = null;
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
