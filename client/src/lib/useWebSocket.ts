import { useCallback, useEffect, useRef, useState } from "react";
import type { WSMessage } from "@shared/schema";

// Secret token that identifies this browser to the server, so a dropped
// connection rejoins the same seat. Kept in localStorage across reloads.
const TOKEN_KEY = "hp-player-token";
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

export function useGameSocket(roomCode: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<any>(null);
  const [myVisitorId, setMyVisitorId] = useState<string | null>(null);
  const [myAnimal, setMyAnimal] = useState<any>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (!roomCode) return;
    
    const url = buildWsUrl(roomCode);

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setLastError(null);
    };

    ws.onmessage = (event) => {
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

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2 seconds
      reconnectTimer.current = window.setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [roomCode]);

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
    send,
  };
}
