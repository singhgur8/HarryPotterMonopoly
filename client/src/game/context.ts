import { createContext, useContext } from "react";
import type { AnimalProfile, GameState, PlayerState } from "@shared/schema";

export interface RoomContextType {
  gameState: any;
  myVisitorId: string | null;
  myAnimal: AnimalProfile | null;
  connected: boolean;
  send: (type: string, payload?: any) => void;
}

export const RoomContext = createContext<RoomContextType>({
  gameState: null,
  myVisitorId: null,
  myAnimal: null,
  connected: false,
  send: () => {},
});

export const useRoom = () => useContext(RoomContext);

/** Game-only view of the room: state, me, and whether it's my move. */
export function useGame() {
  const room = useRoom();
  const s = room.gameState as GameState;
  const me = s.players.find((p: PlayerState) => p.visitorId === room.myVisitorId);
  const current = s.players[s.currentTurnIndex];
  const isMyTurn = !!me && current?.visitorId === me.visitorId;
  return { ...room, s, me, current, isMyTurn };
}
