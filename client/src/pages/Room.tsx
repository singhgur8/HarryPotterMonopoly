import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useGameSocket } from "@/lib/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { RoomContext } from "@/game/context";
import { RulesContext } from "@/components/GameCard";
import { Lobby } from "@/game/Lobby";
import { GameTable } from "@/game/GameTable";
import { Crest, forgetRoom, rememberRoom } from "@/game/Brand";
import "@/game/table.css";

type Check = "checking" | "open" | "gone";

/** Ask the server whether the room is still there before connecting, so an old link doesn't open an empty room. */
function useRoomCheck(roomCode: string): Check {
  const [check, setCheck] = useState<Check>("checking");
  useEffect(() => {
    let live = true;
    setCheck("checking");
    fetch(`/api/rooms/${encodeURIComponent(roomCode)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => live && setCheck(ok && d.exists ? "open" : "gone"))
      .catch(() => live && setCheck("open")); // network trouble: let the socket keep retrying
    return () => { live = false; };
  }, [roomCode]);
  return check;
}

export default function Room({ roomCode }: { roomCode: string }) {
  const check = useRoomCheck(roomCode);
  const socket = useGameSocket(check === "open" ? roomCode : null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (socket.lastError) toast({ title: "Not allowed", description: socket.lastError, variant: "destructive" });
  }, [socket.lastError, toast]);

  useEffect(() => {
    if (check === "open") rememberRoom(roomCode);
    if (check === "gone" || socket.roomClosed) forgetRoom(roomCode);
  }, [check, roomCode, socket.roomClosed]);

  if (check === "gone" || socket.roomClosed) {
    return (
      <div className="hp">
        <div className="hp-page" style={{ alignItems: "center" }}>
          <div className="hp-lob" style={{ maxWidth: 380, justifyItems: "center", textAlign: "center" }} data-testid="room-gone">
            <Crest />
            <p style={{ margin: 0 }}>Room <b style={{ letterSpacing: ".1em" }}>{roomCode}</b> has closed. Finished and idle games are cleared away after a while.</p>
            <button className="hp-btn gold big" onClick={() => navigate("/")} data-testid="button-home">Back to the start</button>
          </div>
        </div>
      </div>
    );
  }

  const inGame = !!socket.gameState?.players && !!socket.myVisitorId;
  return (
    <RoomContext.Provider value={socket}>
      <RulesContext.Provider value={socket.gameState?.rules ?? {}}>
        <div className="hp">{inGame ? <GameTable /> : <Lobby />}</div>
      </RulesContext.Provider>
    </RoomContext.Provider>
  );
}
