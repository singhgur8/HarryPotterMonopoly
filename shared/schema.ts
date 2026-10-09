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
export type VariationId = "deal" | "prime" | "classic" | "gg" | "vegas" | "custom";

// Rule switches that differ between versions of the game
export interface GameRules {
  wildRentOneTarget?: boolean; // Wild Rent charges one player you pick, not everyone (real Monopoly Deal)
  vegas?: boolean;             // Vegas: every turn starts with a gamble (dice, duel or coin-toss bet)
  setsToWin?: number;          // complete sets needed to win (missing = 3)
}

// Who takes the first turn: a random player, or whoever sits in the first seat
export type StartSeat = "random" | "first";

// Versions a Custom game can start from
export type TemplateId = Exclude<VariationId, "custom">;

// What the host sets up for a Custom game
export interface CustomRules {
  template: TemplateId;            // version it started from: its properties, wilds, rent cards and rule switches
  roles: RoleType[];               // roles in play
  roleMode: "random" | "choose";   // deal roles at random, or each player picks theirs
  rolesPerPlayer: number;          // how many roles each player gets
  counts: Record<string, number>;  // copies of each action card (by action) and money card (money_<value>)
  setsToWin: number;               // complete sets needed to win
}

// Card types
export type CardType = "money" | "property" | "wild" | "rent" | "action" | "role";

export type ActionType = 
  | "felix_felicis" | "accio" | "confundus_charm" | "expelliarmus" 
  | "protego" | "gringotts_goblin" | "yule_ball"
  | "reducto" | "silencio" | "time_turner" | "double_rent"
  // Prime edition
  | "hand_seven" | "hand_steal" | "chargeback" | "reverse" | "destroy" | "bank_robber"
  // Vegas
  | "guess_draw" | "all_in";

export type RoleType =
  // Classic Harry Potter
  | "harry" | "hermione" | "draco" | "cedric" | "luna"
  // GG
  | "ganda" | "lucha" | "gandu" | "tharki" | "kanjar";

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
  roles: RoleType[];     // A player can hold several roles in a Custom game
  hand: GameCard[];
  properties: GameCard[];  // Played on board
  bank: GameCard[];        // Money/action cards banked
  isReady: boolean;
  isSleeping: boolean;
  isBot?: boolean;       // A practice bot added in the lobby; always played by the bot
  isConnected: boolean;
  protectedColor?: PropertyColor;  // Harry's power
  isSilenced: boolean;             // Silencio debuff active
  silencedRole?: RoleType;         // Power Outage: the one role it cut (unset = every role, as in older games)
  borrowedRoles?: RoleType[];      // Lucha: the powers copied at the end of the last turn
  borrowedFrom?: string;           // Lucha: whose powers those are (can't pick them twice in a row)
  shortcutColor?: PropertyColor;   // Tharki: the colour that needs one fewer card for a full set
  friendId?: string;               // Kanjar: the player who can't charge him or act against him this round
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

// A turn starts with a short draw step; the turn length the host picked
// only starts counting once the cards are drawn. When the draw timer runs
// out the cards are drawn automatically. That only happens when drawing is
// the one thing the player can do: Cedric choosing between the deck and the
// discard pile has a real choice, so he gets the full turn time and no auto-draw.
export const DRAW_SECONDS = 10;

/** True while the current player's only move is to draw. */
export function inDrawStep(state: Pick<GameState, "status" | "drawnThisTurn" | "pendingAction">): boolean {
  return state.status === "playing" && !state.drawnThisTurn && !state.pendingAction;
}

// Once the current player has used up their plays, whatever they can still do
// (flip wilds, move Harry's shield, end the turn) gets at most this long.
// Nothing ends the turn at 0; the others can then hand it to the bot.
export const PLAYS_USED_UP_SECONDS = 20;

type TimerState = Pick<GameState, "status" | "drawnThisTurn" | "pendingAction" | "gameSpeed" | "actionsUsed" | "maxActions" | "freePlayCardId" | "players" | "currentTurnIndex">;

/** True once the current player has drawn and has no plays (or no cards) left. */
export function playsUsedUp(state: Omit<TimerState, "gameSpeed">): boolean {
  if (state.status !== "playing" || !state.drawnThisTurn || state.pendingAction || state.freePlayCardId) return false;
  return state.actionsUsed >= state.maxActions || (state.players[state.currentTurnIndex]?.hand.length ?? 0) === 0;
}

/** Most seconds the clock may show right now. */
export function turnTimeLimit(state: TimerState): number {
  return playsUsedUp(state) ? Math.min(PLAYS_USED_UP_SECONDS, state.gameSpeed) : state.gameSpeed;
}

/** Seconds on the clock when the game starts waiting on the next step. */
export function freshTurnTimer(state: TimerState): number {
  return inDrawStep(state) ? DRAW_SECONDS : turnTimeLimit(state);
}

// Pending action types (things that require a response from another player)
export type PendingActionType = 
  | "pay_rent"           // Player must pay rent
  | "pay_debt"           // Gringotts Goblin debt
  | "pay_birthday"       // Yule Ball payment
  | "pay_poker"          // All In: each player stakes the poorest player's worth into the pot
  | "choose_steal"       // Accio: attacker picks property to steal
  | "choose_swap"        // Confundus: attacker picks properties to swap  
  | "choose_steal_set"   // Expelliarmus: attacker picks set to steal
  | "choose_reducto"     // Reducto: attacker picks card to discard
  | "choose_silencio"    // Silencio: attacker picks player to silence
  | "choose_goblin"      // Gringotts Goblin: attacker picks who owes 5M
  | "choose_rent_target" // Wild Rent (Monopoly Deal rules): attacker picks who pays
  | "choose_hand_steal"  // Hand Steal: attacker picks whose hand to take a random card from
  | "choose_destroy"     // Destroy: attacker picks a property to discard (complete sets too)
  | "choose_bank_robber" // Bank Robber: attacker picks whose whole bank to take
  | "choose_chargeback"  // Chargeback: the player who cancelled a charge picks who pays it instead
  | "protego_response"   // Player can respond with Protego
  | "harry_protect"      // Harry chooses color to protect at end of turn
  | "cedric_draw_choice" // Start-of-turn draw choice: deck, discard (Cedric) or an opponent's hand (Ganda)
  | "lucha_choose"       // Lucha picks whose power to copy for next turn
  | "tharki_shortcut"    // Tharki keeps, moves or drops his Shortcut at end of turn
  | "kanjar_friend"      // Kanjar picks his friend for the next round at end of turn
  | "time_turner_play"   // Must play the Time-Turner drawn card immediately
  | "discard_excess"     // Must discard down to 7 cards
  | "vegas_gamble"       // Vegas: the current player picks their start-of-turn gamble
  | "vegas_duel"         // Vegas: a dice duel aimed at another player (waits on their Just Say No answer)
  | "guess_draw";        // Guess and Draw: guess the top card's kind until a guess is wrong

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
  outcome: "paid" | "nothing" | "blocked" | "shielded" | "friend";
  amount: number;
}

// Vegas: the last dice roll, coin toss or card guess, so every screen can animate it
export type GuessKind = "property" | "cash" | "action";
export interface GambleRoll {
  id: string;                                   // new for every roll, so screens animate each one once
  kind: "dice" | "duel" | "coin" | "guess" | "poker";
  playerId: string;                             // who gambled
  rolls?: { playerId: string; dice: number[] }[];
  coin?: "heads" | "tails";
  defId?: string;                               // Guess and Draw: the card turned over
  guess?: GuessKind;
  result: string;                               // one sentence on what happened
  secret?: { to: string[]; result: string };    // server only: what these players see instead (the card that changed hands)
}

// Vegas All In: the pot while everyone stakes
export interface PokerPot {
  stake: number;
  pot: GameCard[];
  players: string[];   // who has staked something so far
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
  secret?: { to: string[]; message: string }; // server only: what these players see instead (the card stolen from one and taken by the other)
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
  rules?: GameRules;           // Rule switches for this version (missing = Harry Potter rules)
  rentMultiplier?: number;     // Double the Rent played this turn: the next rent is multiplied by this
  gamble?: GambleRoll | null;  // Vegas: the latest roll, toss or guess
  poker?: PokerPot | null;     // Vegas: an All In in progress
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
  | "set_custom_rules"
  | "set_start_seat"
  | "pick_roles"
  | "pick_animal"
  | "set_name"
  | "new_game"
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
  | "play_chargeback"
  | "play_reverse"
  | "decline_protego"
  | "choose_target"
  | "harry_protect_color"
  | "cedric_choose_source"
  | "lucha_choose"
  | "tharki_shortcut_color"
  | "kanjar_choose_friend"
  | "discard_cards"
  | "pay_silencio"
  | "put_to_sleep"
  | "wake_up"
  | "send_chat"
  | "time_turner_choose"
  | "cancel_action"
  | "forfeit"
  | "vegas_gamble"
  | "guess_card"
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
