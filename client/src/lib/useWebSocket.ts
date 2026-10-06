import { useCallback, useEffect, useRef, useState } from "react";
import type { WSMessage } from "@shared/schema";

// Secret token that identifies this browser to the server, so a dropped
// connection rejoins the same seat. Kept in localStorage across reloads.
const TOKEN_KEY = "hp-player-token";
// Matches ROOM_CLOSED_CODE in worker/gameRoom.ts
const ROOM_CLOSED_CODE = 4000;
let fallbackToken: string | null = null;

function getPlayerToken(): string {
  try {
    let token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(TOKEN_KEY, token);
    }
    return token;
  } catch {
    // Storage blocked (private mode): keep one token for this page load
    fallbackToken ??= crypto.randomUUID();
    return fallbackToken;
  }
}

function buildWsUrl(roomCode: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ room: roomCode, token: getPlayerToken() });
  return `${proto}//${location.host}/ws?${params}`;
}

const HEARTBEAT_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;

export function useGameSocket(roomCode: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<any>(null);
  const [myVisitorId, setMyVisitorId] = useState<string | null>(null);
  const [myAnimal, setMyAnimal] = useState<any>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [roomClosed, setRoomClosed] = useState(false);
  const reconnectTimer = useRef<number | null>(null);
  const lastHeard = useRef(Date.now());

  const connect = useCallback(() => {
    if (!roomCode) return;
    
    const url = buildWsUrl(roomCode);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      lastHeard.current = Date.now();
      setConnected(true);
      setLastError(null);
    };

    ws.onmessage = (event) => {
      lastHeard.current = Date.now();
      if (event.data === "pong") return;
      try {
        const msg: WSMessage = JSON.parse(event.data);
        switch (msg.type) {
          case "game_state":
            setGameState(msg.payload);
            break;
          case "player_joined":
            setMyVisitorId(msg.payload.visitorId);
            setMyAnimal(msg.payload.animal);
            break;
          case "error":
            setLastError(msg.payload.error);
            setTimeout(() => setLastError(null), 4000);
            break;
          case "chat_message":
            // Chat messages come separately for real-time updates
            setGameState((prev: any) => {
              if (!prev) return prev;
              return {
                ...prev,
                chatMessages: [...(prev.chatMessages || []), msg.payload],
              };
            });
            break;
        }
      } catch (e) {
        console.error("Failed to parse WS message", e);
      }
    };

    ws.onclose = (event) => {
      setConnected(false);
      // The server cleared the room away (finished or idle for a long time)
      if (event.code === ROOM_CLOSED_CODE) {
        setRoomClosed(true);
        return;
      }
      // Auto-reconnect after 2 seconds
      reconnectTimer.current = window.setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [roomCode]);

  // Heartbeat: the server answers "ping" with "pong", so it can tell a dropped player
  // from a quiet one. If we hear nothing back, the connection is dead even though the
  // browser hasn't noticed; drop it and reconnect.
  useEffect(() => {
    const reconnectNow = () => {
      const ws = wsRef.current;
      if (!ws || (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING)) return;
      ws.onclose = null;
      ws.close();
      setConnected(false);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      connect();
    };
    const id = window.setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastHeard.current > HEARTBEAT_TIMEOUT_MS) reconnectNow();
        else ws.send("ping");
      }
    }, HEARTBEAT_MS);
    // Coming back to the tab (or unlocking the phone): check the line straight away
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        connect();
      } else if (Date.now() - lastHeard.current > HEARTBEAT_MS * 2) {
        reconnectNow();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connect]);

  // The server only sends the turn timer with state updates; count down locally in between.
  useEffect(() => {
    const id = window.setInterval(() => {
      setGameState((prev: any) =>
        prev?.status === "playing" && prev.turnTimer > 0 ? { ...prev, turnTimer: prev.turnTimer - 1 } : prev,
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((type: string, payload?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    }
  }, []);

  return {
    connected,
    gameState,
    myVisitorId,
    myAnimal,
    lastError,
    roomClosed,
    send,
  };
}
