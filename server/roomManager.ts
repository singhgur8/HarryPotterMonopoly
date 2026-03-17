/**
 * Room Manager — WebSocket-based room management for HP Monopoly Deal.
 * Handles room creation, joining, lobby, and message routing.
 */
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { Server } from "http";
import type {
  GameState, PlayerState, WSMessage, AnimalProfile, RoleType, PropertyColor,
} from "../shared/schema";
import { ANIMALS } from "../shared/schema";
import {
  createInitialGameState, drawCards, playCard, bankCard, endTurn,
  flipWild, payWithCards, playProtego, declineProtego, chooseTarget,
  harryProtectColor, cedricChooseSource, timeTurnerChoose, paySilencio,
  discardCards, sanitizeStateForPlayer, cedricDrawFromDiscard,
} from "./gameEngine";

// ========== TYPES ==========

interface RoomClient {
  ws: WebSocket;
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
  turnTimerInterval: NodeJS.Timeout | null;
}

// ========== STATE ==========

const rooms = new Map<string, Room>();
const usedAnimals = new Map<string, Set<number>>(); // roomCode -> Set<animalIndex>

// ========== HELPERS ==========

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRandomAnimal(roomCode: string): AnimalProfile {
  if (!usedAnimals.has(roomCode)) {
    usedAnimals.set(roomCode, new Set());
  }
  const used = usedAnimals.get(roomCode)!;
  const available = ANIMALS.filter((_, i) => !used.has(i));
  if (available.length === 0) {
    // All used, just pick random
    return ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  }
  const idx = ANIMALS.indexOf(available[Math.floor(Math.random() * available.length)]);
  used.add(idx);
  return ANIMALS[idx];
}

function broadcastToRoom(room: Room, msg: WSMessage, exclude?: string) {
  const data = JSON.stringify(msg);
  for (const [vid, client] of room.clients) {
    if (vid !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function sendToClient(client: RoomClient, msg: WSMessage) {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(msg));
  }
}

function sendError(client: RoomClient, error: string) {
  sendToClient(client, { type: "error", payload: { error } });
}

function broadcastGameState(room: Room) {
  if (!room.gameState) return;
  for (const [vid, client] of room.clients) {
    const sanitized = sanitizeStateForPlayer(room.gameState, vid);
    sendToClient(client, { type: "game_state", payload: sanitized });
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

function startTurnTimer(room: Room) {
  if (room.turnTimerInterval) clearInterval(room.turnTimerInterval);
  
  room.turnTimerInterval = setInterval(() => {
    if (!room.gameState || room.gameState.status !== "playing") {
      if (room.turnTimerInterval) clearInterval(room.turnTimerInterval);
      return;
    }

    room.gameState.turnTimer--;
    
    if (room.gameState.turnTimer <= 0) {
      room.gameState.turnTimer = 0;
      // Timer expired — don't auto-sleep, just notify
      broadcastGameState(room);
    }

    // Broadcast timer update every 5 seconds (or at 0)
    if (room.gameState.turnTimer % 5 === 0 || room.gameState.turnTimer <= 10) {
      broadcastGameState(room);
    }
  }, 1000);
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
      sendToClient(client, { type: "game_state", payload: sanitizeStateForPlayer(room.gameState, client.visitorId) });
    }
  } else {
    broadcastLobbyState(room);
  }
}

function handleSitDown(room: Room, client: RoomClient, payload: any) {
  if (room.gameState) return sendError(client, "Game already in progress");
  
  const seatIndex = payload?.seatIndex;
  if (typeof seatIndex !== "number" || seatIndex < 0 || seatIndex > 4) {
    return sendError(client, "Invalid seat");
  }

  // Check if seat is taken
  for (const [_, c] of room.clients) {
    if (c.seatIndex === seatIndex && c.visitorId !== client.visitorId) {
      return sendError(client, "Seat already taken");
    }
  }

  client.seatIndex = seatIndex;
  client.isReady = false;
  broadcastLobbyState(room);
}

function handleStandUp(room: Room, client: RoomClient) {
  if (room.gameState) return sendError(client, "Game in progress");
  client.seatIndex = null;
  client.isReady = false;
  broadcastLobbyState(room);
}

function handleToggleReady(room: Room, client: RoomClient) {
  if (room.gameState) return;
  if (client.seatIndex === null) return sendError(client, "Must be seated");
  client.isReady = !client.isReady;
  broadcastLobbyState(room);
}

function handleSetGameSpeed(room: Room, client: RoomClient, payload: any) {
  if (client.visitorId !== room.hostVisitorId) return sendError(client, "Only host can change speed");
  if (room.gameState) return sendError(client, "Game in progress");
  
  const speed = payload?.speed;
  if (![30, 60, 90].includes(speed)) return sendError(client, "Invalid speed");
  
  room.gameSpeed = speed;
  broadcastLobbyState(room);
}

function handleStartGame(room: Room, client: RoomClient) {
  if (client.visitorId !== room.hostVisitorId) return sendError(client, "Only host can start");
  if (room.gameState) return sendError(client, "Game already started");

  // Collect seated & ready players
  const seatedPlayers: { visitorId: string; seatIndex: number; animal: AnimalProfile }[] = [];
  for (const [vid, c] of room.clients) {
    if (c.seatIndex !== null && c.isReady) {
      seatedPlayers.push({ visitorId: vid, seatIndex: c.seatIndex, animal: c.animal });
    }
  }

  if (seatedPlayers.length < 2) return sendError(client, "Need at least 2 ready players");
  if (seatedPlayers.length > 5) return sendError(client, "Max 5 players");

  // Sort by seat index
  seatedPlayers.sort((a, b) => a.seatIndex - b.seatIndex);

  room.gameState = createInitialGameState(room.code, seatedPlayers, room.gameSpeed);
  startTurnTimer(room);
  broadcastGameState(room);
}

function handleDrawCards(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = drawCards(room.gameState, client.visitorId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handlePlayCard(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId, asProperty, targetColor } = payload || {};
  const result = playCard(room.gameState, client.visitorId, cardDefId, asProperty, targetColor);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleBankCard(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId } = payload || {};
  const result = bankCard(room.gameState, client.visitorId, cardDefId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleEndTurn(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = endTurn(room.gameState, client.visitorId);
  if (!result.success) return sendError(client, result.error!);
  
  // Reset timer
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

function handleFlipWild(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId, newColor } = payload || {};
  const result = flipWild(room.gameState, client.visitorId, cardDefId, newColor);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handlePayWithCards(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = payWithCards(room.gameState, client.visitorId, cardDefIds || []);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handlePlayProtego(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = playProtego(room.gameState, client.visitorId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleDeclineProtego(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const result = declineProtego(room.gameState, client.visitorId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleChooseTarget(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { targetPlayerId, targetCardDefId, ownCardDefId } = payload || {};
  const result = chooseTarget(room.gameState, client.visitorId, targetPlayerId, targetCardDefId, ownCardDefId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleHarryProtectColor(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { color } = payload || {};
  const result = harryProtectColor(room.gameState, client.visitorId, color);
  if (!result.success) return sendError(client, result.error!);
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

function handleCedricChooseSource(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { source } = payload || {};
  const result = cedricChooseSource(room.gameState, client.visitorId, source);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleTimeTurnerChoose(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefId } = payload || {};
  const result = timeTurnerChoose(room.gameState, client.visitorId, cardDefId);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handlePaySilencio(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = paySilencio(room.gameState, client.visitorId, cardDefIds || []);
  if (!result.success) return sendError(client, result.error!);
  broadcastGameState(room);
}

function handleDiscardCards(room: Room, client: RoomClient, payload: any) {
  if (!room.gameState) return;
  const { cardDefIds } = payload || {};
  const result = discardCards(room.gameState, client.visitorId, cardDefIds || []);
  if (!result.success) return sendError(client, result.error!);
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
  const { targetPlayerId } = payload || {};
  const target = room.gameState.players.find(p => p.visitorId === targetPlayerId);
  if (!target) return;
  
  // Can only put to sleep if their timer is at 0
  if (room.gameState.turnTimer > 0) return sendError(client, "Timer hasn't expired yet");
  
  const currentPlayer = room.gameState.players[room.gameState.currentTurnIndex];
  if (currentPlayer?.visitorId !== targetPlayerId) return sendError(client, "Can only sleep the current player");

  target.isSleeping = true;
  broadcastGameState(room);
}

function handleWakeUp(room: Room, client: RoomClient) {
  if (!room.gameState) return;
  const player = room.gameState.players.find(p => p.visitorId === client.visitorId);
  if (!player) return;
  player.isSleeping = false;
  room.gameState.turnTimer = room.gameState.gameSpeed;
  broadcastGameState(room);
}

// ========== MAIN ROUTER ==========

function handleMessage(room: Room, client: RoomClient, msg: WSMessage) {
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
    case "send_chat": return handleSendChat(room, client, payload);
    case "put_to_sleep": return handlePutToSleep(room, client, payload);
    case "wake_up": return handleWakeUp(room, client);
    case "pay_silencio": return handlePaySilencio(room, client, payload);
    case "discard_cards": return handleDiscardCards(room, client, payload);
    default:
      sendError(client, `Unknown message type: ${type}`);
  }
}

// ========== SETUP ==========

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req) => {
    // Extract visitor ID from header (injected by proxy)
    const visitorId = req.headers["x-visitor-id"] as string || uuidv4();
    
    // Extract room code from URL query
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const roomCode = url.searchParams.get("room");

    if (!roomCode) {
      ws.send(JSON.stringify({ type: "error", payload: { error: "No room code" } }));
      ws.close();
      return;
    }

    let room = rooms.get(roomCode);
    
    if (!room) {
      // Create room (first person is host)
      room = {
        code: roomCode,
        hostVisitorId: visitorId,
        gameSpeed: 60,
        clients: new Map(),
        gameState: null,
        turnTimerInterval: null,
      };
      rooms.set(roomCode, room);
    } else if (room.clients.size === 0) {
      // First WS connection to an empty room — adopt as host
      room.hostVisitorId = visitorId;
    }

    // Get or create client for this visitor
    let client = room.clients.get(visitorId);
    if (client) {
      // Reconnection
      client.ws = ws;
    } else {
      // New client
      const animal = getRandomAnimal(roomCode);
      client = {
        ws,
        visitorId,
        animal,
        seatIndex: null,
        isReady: false,
      };
      room.clients.set(visitorId, client);
    }

    // Send initial state
    if (room.gameState && room.gameState.status === "playing") {
      sendToClient(client, {
        type: "game_state",
        payload: sanitizeStateForPlayer(room.gameState, visitorId),
      });
    } else {
      sendToClient(client, {
        type: "game_state",
        payload: getLobbyState(room),
      });
    }

    // Also send the client their identity
    sendToClient(client, {
      type: "player_joined",
      payload: { visitorId, animal: client.animal },
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WSMessage;
        handleMessage(room!, client!, msg);
      } catch (err) {
        sendError(client!, "Invalid message format");
      }
    });

    ws.on("close", () => {
      if (room && room.gameState) {
        const player = room.gameState.players.find(p => p.visitorId === visitorId);
        if (player) {
          player.isConnected = false;
          broadcastGameState(room);
        }
      }

      // Clean up empty rooms after delay
      setTimeout(() => {
        if (room && room.clients.size === 0) {
          if (room.turnTimerInterval) clearInterval(room.turnTimerInterval);
          rooms.delete(roomCode!);
          usedAnimals.delete(roomCode!);
        }
      }, 60000);
    });

    ws.on("error", () => {
      // Silently handle
    });
  });

  return wss;
}

// ========== REST API HELPERS ==========

export function createRoom(hostVisitorId: string): string {
  let code: string;
  do {
    code = generateRoomCode();
  } while (rooms.has(code));
  
  const room: Room = {
    code,
    hostVisitorId,
    gameSpeed: 60,
    clients: new Map(),
    gameState: null,
    turnTimerInterval: null,
  };
  rooms.set(code, room);
  return code;
}

export function roomExists(code: string): boolean {
  return rooms.has(code);
}
