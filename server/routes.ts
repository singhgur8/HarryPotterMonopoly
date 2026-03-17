import type { Express } from "express";
import type { Server } from "http";
import { createRoom, roomExists, setupWebSocket } from "./roomManager";

export async function registerRoutes(httpServer: Server, app: Express) {
  // Create a new room
  app.post("/api/rooms", (req, res) => {
    const visitorId = req.headers["x-visitor-id"] as string || "anonymous";
    const code = createRoom(visitorId);
    res.json({ code });
  });

  // Check if room exists
  app.get("/api/rooms/:code", (req, res) => {
    const { code } = req.params;
    if (roomExists(code.toUpperCase())) {
      res.json({ exists: true, code: code.toUpperCase() });
    } else {
      res.status(404).json({ exists: false });
    }
  });

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Setup WebSocket
  setupWebSocket(httpServer);
}
