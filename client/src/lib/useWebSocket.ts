import { useCallback, useEffect, useRef, useState } from "react";
import type { WSMessage } from "@shared/schema";

const WS_BASE = `${location.origin}${location.pathname.replace(/\/[^/]*$/, '')}/__PORT_5000__/ws`;

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
    
    // Build WS URL
    let url: string;
    const portPlaceholder = "__PORT_5000__";
    if (WS_BASE.includes(portPlaceholder)) {
      // Local dev
      url = `ws://localhost:5000/ws?room=${roomCode}`;
    } else {
      // Deployed — use origin-relative ws
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const base = WS_BASE.replace(/^https?:/, proto);
      url = `${base}?room=${roomCode}`;
    }

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
