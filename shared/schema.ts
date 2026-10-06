// ========== GAME TYPES (shared between client & server) ==========

// Card color groups
export const PROPERTY_COLORS = [
  "brown", "light_blue", "pink", "orange", "red", 
  "yellow", "green", "dark_blue", "transport", "utility"
] as const;
export type PropertyColor = typeof PROPERTY_COLORS[number];

// Set sizes for each color
export const SET_SIZES: Record<PropertyColor, number> = {
  brown: 2, light_blue: 3, pink: 3, orange: 3, red: 3,
  yellow: 3, green: 3, dark_blue: 2, transport: 4, utility: 2,
};

// Card colours for each set, matched to the Monopoly Deal deck. `fill` is the
// set colour, `on` is readable text on that fill, `tint` is the art background
// and `ink` the line-art colour.
export const SET_STYLE: Record<PropertyColor, { label: string; fill: string; on: string; tint: string; ink: string }> = {
  brown:      { label: "Brown",      fill: "#955436", on: "#ffffff", tint: "#efe2d8", ink: "#6e3c24" },
  light_blue: { label: "Light Blue", fill: "#aae0fa", on: "#10283a", tint: "#e6f5fd", ink: "#2b7aa6" },
  pink:       { label: "Pink",       fill: "#d93a96", on: "#ffffff", tint: "#f8dcec", ink: "#a8216f" },
  orange:     { label: "Orange",     fill: "#f7941d", on: "#2e1607", tint: "#fde9d1", ink: "#b0610a" },
  red:        { label: "Red",        fill: "#ed1b24", on: "#ffffff", tint: "#fcdcdd", ink: "#b3121a" },
  yellow:     { label: "Yellow",     fill: "#fef200", on: "#2d2a06", tint: "#fffbcc", ink: "#8a8000" },
  green:      { label: "Green",      fill: "#1fb25a", on: "#ffffff", tint: "#d6f1e1", ink: "#13803f" },
  dark_blue:  { label: "Dark Blue",  fill: "#0072bb", on: "#ffffff", tint: "#d4e7f5", ink: "#00578f" },
  transport:  { label: "Railroad",   fill: "#231f20", on: "#ffffff", tint: "#e2e1e1", ink: "#231f20" },
  utility:    { label: "Utility",    fill: "#c5e3a8", on: "#1d3310", tint: "#eef7e5", ink: "#4f7d2c" },
};

// Rent tables for each color
export const RENT_TABLE: Record<PropertyColor, number[]> = {
  brown:      [1, 2],
  light_blue: [1, 2, 3],
  pink:       [1, 2, 4],
  orange:     [1, 3, 5],
  red:        [2, 3, 6],
  yellow:     [2, 4, 6],
  green:      [2, 4, 7],
  dark_blue:  [3, 8],
  transport:  [1, 2, 3, 4],
  utility:    [1, 2],
};

// Versions of the game the host can pick in the lobby (see shared/variations.ts)
export type VariationId = "classic" | "gg";

// Card types
export type CardType = "money" | "property" | "wild" | "rent" | "action" | "role";

export type ActionType = 
  | "felix_felicis" | "accio" | "confundus_charm" | "expelliarmus" 
  | "protego" | "gringotts_goblin" | "yule_ball"
  | "reducto" | "silencio" | "time_turner";

export type RoleType =
  // Classic Harry Potter
  | "harry" | "hermione" | "draco" | "cedric" | "luna"
  // GG
  | "ganda" | "lucha";

// Rent card color pairs
export type RentColors = [PropertyColor, PropertyColor] | "rainbow";

// Card definition (static, from deck)
export interface CardDef {
  id: string;           // Unique card ID (e.g., "money_1g_1", "prop_brown_1")
  type: CardType;
  name: string;         // Display name
  value: number;        // Galleon value (for banking or payment)
  shortName?: string;   // Shown when the card is drawn small (board, bank)
  text?: string;        // Rules sentence printed on the card (actions, wilds, roles)
  target?: "self" | "one" | "all" | "reaction"; // Who an action affects, shown in the card footer
  
  // Property-specific
  color?: PropertyColor;
  
  // Wild-specific
  wildColors?: [PropertyColor, PropertyColor] | "rainbow";
  
  // Rent-specific
  rentColors?: RentColors;
  
  // Action-specific
  actionType?: ActionType;
  
  // Role-specific
  roleType?: RoleType;
  rolePower?: string;
}

// A card instance in the game (tracks which color a wild is assigned to)
export interface GameCard {
  defId: string;         // References CardDef.id
  assignedColor?: PropertyColor;  // For wilds: which color they're currently set to
}

// Player state
export interface PlayerState {
  visitorId: string;
  seatIndex: number;     // 0-4
  animal: AnimalProfile;
  role?: RoleType;
  hand: GameCard[];
  properties: GameCard[];  // Played on board
  bank: GameCard[];        // Money/action cards banked
  isReady: boolean;
  isSleeping: boolean;
  isBot?: boolean;       // A practice bot added in the lobby; always played by the bot
  isConnected: boolean;
  protectedColor?: PropertyColor;  // Harry's power
  isSilenced: boolean;             // Silencio debuff active
}

// Animal profiles
export interface AnimalProfile {
  name: string;
  emoji: string;
  colorClass: string;
}

export const ANIMALS: AnimalProfile[] = [
  { name: "Fox", emoji: "🦊", colorClass: "animal-fox" },
  { name: "Owl", emoji: "🦉", colorClass: "animal-owl" },
  { name: "Cat", emoji: "🐱", colorClass: "animal-cat" },
  { name: "Panda", emoji: "🐼", colorClass: "animal-panda" },
  { name: "Wolf", emoji: "🐺", colorClass: "animal-wolf" },
  { name: "Dragon", emoji: "🐉", colorClass: "animal-dragon" },
  { name: "Phoenix", emoji: "🔥", colorClass: "animal-phoenix" },
  { name: "Badger", emoji: "🦡", colorClass: "animal-badger" },
  { name: "Raven", emoji: "🐦‍⬛", colorClass: "animal-raven" },
  { name: "Stag", emoji: "🦌", colorClass: "animal-stag" },
];

// Game speed options
export const GAME_SPEEDS = {
  fast: 30,
  normal: 60,
  relaxed: 90,
} as const;

// Pending action types (things that require a response from another player)
export type PendingActionType = 
  | "pay_rent"           // Player must pay rent
  | "pay_debt"           // Gringotts Goblin debt
  | "pay_birthday"       // Yule Ball payment
  | "choose_steal"       // Accio: attacker picks property to steal
  | "choose_swap"        // Confundus: attacker picks properties to swap  
  | "choose_steal_set"   // Expelliarmus: attacker picks set to steal
  | "choose_reducto"     // Reducto: attacker picks card to discard
  | "choose_silencio"    // Silencio: attacker picks player to silence
  | "choose_goblin"      // Gringotts Goblin: attacker picks who owes 5M
  | "protego_response"   // Player can respond with Protego
  | "harry_protect"      // Harry chooses color to protect at end of turn
  | "cedric_draw_choice" // Cedric chooses deck or discard
  | "time_turner_play"   // Must play the Time-Turner drawn card immediately
  | "discard_excess";    // Must discard down to 7 cards

export interface PendingAction {
  type: PendingActionType;
  sourcePlayerId: string;     // Who initiated
  targetPlayerId: string;     // Who must respond
  amount?: number;            // For payments
  cardDefId?: string;         // Related card
  data?: any;                 // Extra data
}

// How each player's part of a multi-player payment ended (shown in the tracker)
export interface PaymentResult {
  playerId: string;
  outcome: "paid" | "nothing" | "blocked" | "shielded";
  amount: number;
}

// Event log entry
export interface EventLogEntry {
  id: string;
  timestamp: number;
  playerEmoji: string;
  playerName: string;
  playerColor: string;
  message: string;
  cardDefId?: string;
}

// Chat message
export interface ChatMessage {
  id: string;
  timestamp: number;
  playerEmoji: string;
  playerName: string;
  playerColor: string;
  message: string;
}

// Full game state (server-authoritative)
export interface GameState {
  roomCode: string;
  status: "lobby" | "playing" | "finished";
  players: PlayerState[];
  spectators: AnimalProfile[];
  currentTurnIndex: number;    // Index into players array
  actionsUsed: number;         // 0-3 (or 0-4 for Hermione)
  maxActions: number;          // 3 default, 4 for Hermione
  drawnThisTurn: boolean;      // Whether current player has drawn cards this turn
  drawPile: GameCard[];
  discardPile: GameCard[];
  pendingAction: PendingAction | null;
  turnTimer: number;           // Seconds remaining
  gameSpeed: number;           // 30, 60, or 90
  eventLog: EventLogEntry[];
  chatMessages: ChatMessage[];
  winnerId: string | null;
  variation?: VariationId;     // Which version of the game this is (missing on older saves = classic)
  roleCards: RoleType[];       // Available role cards (for assignment)
  freePlayCardId?: string | null; // Card taken with the Time-Turner, played next for free
  // Sent to clients only
  drawPileCount?: number;
  waitingOn?: string | null;   // Player the game needs input from next
}

// WebSocket message types
export type WSMessageType =
  // Client -> Server
  | "join_room"
  | "sit_down"
  | "stand_up"
  | "toggle_ready"
  | "set_game_speed"
  | "set_variation"
  | "start_game"
  | "add_bot"
  | "remove_bot"
  | "draw_cards"
  | "play_card"
  | "bank_card"
  | "end_turn"
  | "flip_wild"
  | "assign_rainbow"
  | "pay_with_cards"
  | "play_protego"
  | "decline_protego"
  | "choose_target"
  | "harry_protect_color"
  | "cedric_choose_source"
  | "discard_cards"
  | "pay_silencio"
  | "put_to_sleep"
  | "wake_up"
  | "send_chat"
  | "time_turner_choose"
  | "cancel_action"
  // Server -> Client
  | "game_state"
  | "error"
  | "player_joined"
  | "player_left"
  | "chat_message"
  | "event_log";

export interface WSMessage {
  type: WSMessageType;
  payload?: any;
}
