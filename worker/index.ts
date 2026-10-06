/**
 * Worker entry: room API and WebSocket routing. Everything else (the React
 * client) is served as static assets before this runs.
 */
import { GameRoom, type Env } from "./gameRoom";

export { GameRoom };

const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const PLAYER_TOKEN = /^[A-Za-z0-9-]{16,64}$/;

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 characters, so no modulo bias
  return [...crypto.getRandomValues(new Uint8Array(5))].map(b => chars[b % chars.length]).join("");
}

const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: API_HEADERS });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: API_HEADERS });
}

/** Per-IP limit on opening rooms and connections. Allows everything if the binding isn't configured. */
async function overLimit(request: Request, env: Env): Promise<boolean> {
  if (!env.ROOM_LIMITER) return false;
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.ROOM_LIMITER.limit({ key: ip });
  return !success;
}

/** Only pages served from this site may open game connections. */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // non-browser clients send none; they still need a token like anyone else
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

/**
 * A player's public id is a hash of the secret token their browser keeps, so
 * the ids other players see can't be used to take over someone's seat.
 */
async function visitorIdFor(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest).slice(0, 12)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return text("Expected WebSocket", 426);
      if (!sameOrigin(request, url)) return text("Forbidden", 403);
      const code = (url.searchParams.get("room") || "").toUpperCase();
      if (!ROOM_CODE.test(code)) return text("Bad room code", 400);
      if (await overLimit(request, env)) return text("Too many requests", 429);

      const token = url.searchParams.get("token") || "";
      const visitorId = await visitorIdFor(PLAYER_TOKEN.test(token) ? token : crypto.randomUUID());

      const forward = new URL(request.url);
      forward.search = new URLSearchParams({ room: code, visitor: visitorId }).toString();
      return roomStub(env, code).fetch(new Request(forward, request));
    }

    // Create a new room
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      if (await overLimit(request, env)) return json({ message: "Too many rooms opened. Try again in a minute" }, 429);
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateRoomCode();
        if (await roomStub(env, code).create(code)) return json({ code });
      }
      return json({ message: "Could not create room" }, 503);
    }

    // Check if room exists
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match && request.method === "GET") {
      if (await overLimit(request, env)) return json({ message: "Too many requests. Try again in a minute" }, 429);
      const code = match[1].toUpperCase();
      if (ROOM_CODE.test(code) && (await roomStub(env, code).exists())) {
        return json({ exists: true, code });
      }
      return json({ exists: false }, 404);
    }

    // Health check
    if (url.pathname === "/api/health") {
      return json({ status: "ok" });
    }

    return text("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
