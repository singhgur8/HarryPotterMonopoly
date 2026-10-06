/**
 * Worker entry: room API and WebSocket routing. Everything else (the React
 * client) is served as static assets before this runs.
 */
import { GameRoom, type Env } from "./gameRoom";

export { GameRoom };

const ROOM_CODE = /^[A-Z0-9]{4,8}$/;
const PLAYER_TOKEN = /^[A-Za-z0-9-]{16,64}$/;

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const code = (url.searchParams.get("room") || "").toUpperCase();
      if (!ROOM_CODE.test(code)) return new Response("Bad room code", { status: 400 });

      const token = url.searchParams.get("token") || "";
      const visitorId = await visitorIdFor(PLAYER_TOKEN.test(token) ? token : crypto.randomUUID());

      const forward = new URL(request.url);
      forward.search = new URLSearchParams({ room: code, visitor: visitorId }).toString();
      return roomStub(env, code).fetch(new Request(forward, request));
    }

    // Create a new room
    if (url.pathname === "/api/rooms" && request.method === "POST") {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = generateRoomCode();
        if (await roomStub(env, code).create(code)) return Response.json({ code });
      }
      return Response.json({ message: "Could not create room" }, { status: 503 });
    }

    // Check if room exists
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
    if (match && request.method === "GET") {
      const code = decodeURIComponent(match[1]).toUpperCase();
      if (ROOM_CODE.test(code) && (await roomStub(env, code).exists())) {
        return Response.json({ exists: true, code });
      }
      return Response.json({ exists: false }, { status: 404 });
    }

    // Health check
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
