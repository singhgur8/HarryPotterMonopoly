import { useEffect } from "react";
import { useGameSocket } from "@/lib/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { RoomContext } from "@/game/context";
import { Crest, Lobby } from "@/game/Lobby";
import { GameTable } from "@/game/GameTable";
import "@/game/table.css";

export default function Room({ roomCode }: { roomCode: string }) {
  const socket = useGameSocket(roomCode);
  const { toast } = useToast();

  useEffect(() => {
    if (socket.lastError) toast({ title: "Not allowed", description: socket.lastError, variant: "destructive" });
  }, [socket.lastError, toast]);

  if (socket.roomClosed) {
    return (
      <div className="hp">
        <div className="hp-page" style={{ alignItems: "center" }}>
          <div className="hp-lob" style={{ maxWidth: 360, justifyItems: "center", textAlign: "center" }}>
            <Crest />
            <p className="hp-muted">This room has closed. Finished and idle games are cleared away after a while.</p>
            <a className="hp-btn gold" href="#/">Start a new game</a>
          </div>
        </div>
      </div>
    );
  }

  const inGame = !!socket.gameState?.players && !!socket.myVisitorId;
  return (
    <RoomContext.Provider value={socket}>
      <div className="hp">{inGame ? <GameTable /> : <Lobby />}</div>
    </RoomContext.Provider>
  );
}
