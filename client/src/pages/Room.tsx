import { useEffect } from "react";
import { useGameSocket } from "@/lib/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { RoomContext } from "@/game/context";
import { Lobby } from "@/game/Lobby";
import { GameTable } from "@/game/GameTable";
import "@/game/table.css";

export default function Room({ roomCode }: { roomCode: string }) {
  const socket = useGameSocket(roomCode);
  const { toast } = useToast();

  useEffect(() => {
    if (socket.lastError) toast({ title: "Not allowed", description: socket.lastError, variant: "destructive" });
  }, [socket.lastError, toast]);

  const inGame = !!socket.gameState?.players && !!socket.myVisitorId;
  return (
    <RoomContext.Provider value={socket}>
      <div className="hp">{inGame ? <GameTable /> : <Lobby />}</div>
    </RoomContext.Provider>
  );
}
