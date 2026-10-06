/**
 * Guards for everything a browser sends a room: message shape and size, how
 * fast one player can send, and how many connections a room accepts. The game
 * engine checks the rules; this keeps junk and floods from reaching it.
 */
import type { WSMessage } from "../shared/schema";

export const MAX_SOCKETS_PER_ROOM = 30;
export const MAX_SOCKETS_PER_VISITOR = 4;

const MAX_MESSAGE_BYTES = 4096;
const MAX_TYPE_LENGTH = 40;
const MAX_STRING_LENGTH = 64;
const MAX_CHAT_LENGTH = 400; // the chat handler trims further
const MAX_ARRAY_LENGTH = 40;

/**
 * Parse a socket message into { type, payload } where the payload is a flat
 * object of strings, finite numbers, booleans and short string arrays.
 * Returns an error string for anything else.
 */
export function parseMessage(data: string | ArrayBuffer): WSMessage | string {
  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  if (text.length > MAX_MESSAGE_BYTES) return "Message too large";

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "Invalid message format";
  }
  if (!isPlainObject(raw)) return "Invalid message format";

  const { type, payload } = raw;
  if (typeof type !== "string" || type.length === 0 || type.length > MAX_TYPE_LENGTH) {
    return "Invalid message type";
  }
  if (payload === undefined || payload === null) return { type, payload: undefined } as WSMessage;
  if (!isPlainObject(payload)) return "Invalid message payload";

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const limit = key === "message" ? MAX_CHAT_LENGTH : MAX_STRING_LENGTH;
    if (typeof value === "string") {
      if (value.length > limit) return "Invalid message payload";
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) return "Invalid message payload";
    } else if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) return "Invalid message payload";
      if (!value.every(v => typeof v === "string" && v.length <= MAX_STRING_LENGTH)) {
        return "Invalid message payload";
      }
    } else if (typeof value !== "boolean" && value !== null) {
      return "Invalid message payload";
    }
    clean[key] = value;
  }
  return { type, payload: clean } as WSMessage;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---- Per-player message rate ----
// Counted in memory per room; a hibernated room starts counting afresh,
// which is fine since a flood keeps the room awake.

const WINDOW_MS = 5000;
const MAX_MESSAGES_PER_WINDOW = 40;
const MAX_CHATS_PER_WINDOW = 5;

interface Window { start: number; messages: number; chats: number; warned: boolean }

export class MessageRateLimiter {
  private windows = new Map<string, Window>();

  /**
   * Count one message from this visitor. "ok" lets it through; "warn" (once per
   * window) and "drop" mean they are sending too fast and it is ignored.
   */
  check(visitorId: string, type: string, now = Date.now()): "ok" | "warn" | "drop" {
    let w = this.windows.get(visitorId);
    if (!w || now - w.start >= WINDOW_MS) {
      w = { start: now, messages: 0, chats: 0, warned: false };
      this.windows.set(visitorId, w);
      if (this.windows.size > 200) this.prune(now);
    }
    w.messages++;
    if (type === "send_chat") w.chats++;
    const tooFast = w.messages > MAX_MESSAGES_PER_WINDOW || (type === "send_chat" && w.chats > MAX_CHATS_PER_WINDOW);
    if (!tooFast) return "ok";
    if (w.warned) return "drop";
    w.warned = true;
    return "warn";
  }

  private prune(now: number) {
    for (const [id, w] of this.windows) {
      if (now - w.start >= WINDOW_MS) this.windows.delete(id);
    }
  }
}
