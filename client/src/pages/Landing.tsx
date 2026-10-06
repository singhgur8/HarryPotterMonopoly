import { useState } from "react";
import { useLocation } from "wouter";
import { Crest, HowToWin } from "@/game/Lobby";
import "@/game/table.css";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [, navigate] = useLocation();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function createRoom() {
    setCreating(true);
    setError("");
    try {
      const res = await apiRequest("POST", "/api/rooms");
      const data = await res.json();
      navigate(`/room/${data.code}`);
    } catch {
      setError("Failed to create room");
    } finally {
      setCreating(false);
    }
  }

  async function joinRoom() {
    if (!joinCode.trim()) return;
    setError("");
    try {
      const res = await apiRequest("GET", `/api/rooms/${joinCode.trim().toUpperCase()}`);
      const data = await res.json();
      if (data.exists) {
        navigate(`/room/${data.code}`);
      } else {
        setError("Room not found");
      }
    } catch {
      setError("Room not found");
    }
  }

  return (
    <div className="hp">
      <div className="hp-page" style={{ alignItems: "center" }} data-testid="landing-page">
        <div className="hp-lob" style={{ maxWidth: 420 }}>
          <Crest />
          <button className="hp-btn gold big" onClick={createRoom} disabled={creating} data-testid="button-create-game">
            {creating ? "Creating…" : "Create a game"}
          </button>
          <div className="hp-label" style={{ textAlign: "center" }}>or join with a room code</div>
          <form className="hp-row" style={{ display: "flex", gap: 8 }} onSubmit={e => { e.preventDefault(); joinRoom(); }}>
            <input
              className="hp-input"
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={5}
              aria-label="Room code"
              data-testid="input-room-code"
            />
            <button type="submit" className="hp-btn ghost big" disabled={!joinCode.trim()} data-testid="button-join-room">Join</button>
          </form>
          {error && <p style={{ color: "var(--alert)", margin: 0, textAlign: "center" }} data-testid="text-error">{error}</p>}
          <HowToWin />
          <p className="hp-muted" style={{ margin: 0, fontSize: 13 }}>2 to 5 players. No login needed. Share the link and everyone picks a seat.</p>
        </div>
      </div>
    </div>
  );
}
