import { useCallback, useEffect, useRef, useState } from "react";
import type { WSMessage } from "@shared/schema";

// Build the WebSocket base URL.
// __PORT_5000__ is replaced at deploy time with "port/5000" on Perplexity.
// On Render (or any direct host), we connect straight to the same origin.
function buildWsUrl(roomCode: string): string {
  const portToken = "__PORT_5000__";
  const isLocal = portToken.startsWith("__");
  
  if (isLocal) {
    // Local dev or direct hosting (e.g. Render): connect to same origin
    if (typeof location !== "undefined" && location.hostname !== "localhost") {
      // Deployed on a direct host (Render, Railway, etc.)
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${location.host}/ws?room=${roomCode}`;
    }
    // Local dev: connect directly to the Express server
    return `ws://localhost:5000/ws?room=${roomCode}`;
  }
  
  // Perplexity deploy: construct URL through the proxy
  // Strip trailing filename (e.g. /index.html) from pathname
  const base = location.pathname.replace(/\/[^/]*\.[^/]*$/, '').replace(/\/$/, '');
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${base}/${portToken}/ws?room=${roomCode}`;
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
