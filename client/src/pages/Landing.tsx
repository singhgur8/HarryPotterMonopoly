import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { HowToWin } from "@/game/Lobby";
import { Crest, SetStripe, forgetRoom, lastRoom } from "@/game/Brand";
import { ThemeToggle } from "@/game/ThemeToggle";
import "@/game/table.css";
import { apiRequest } from "@/lib/queryClient";

export default function Landing() {
  const [, navigate] = useLocation();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [rejoin, setRejoin] = useState<string | null>(null);

  // Offer the room this browser was last in, if it is still open
  useEffect(() => {
    const code = lastRoom();
    if (!code) return;
    let live = true;
    apiRequest("GET", `/api/rooms/${code}`)
      .then(r => r.json())
      .then(d => { if (live && d.exists) setRejoin(code); })
      .catch(() => forgetRoom(code));
    return () => { live = false; };
  }, []);

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
      <div className="hp-page hp-home-page" data-testid="landing-page">
        <div className="hp-lob hp-hero">
          <ThemeToggle className="hp-theme-corner" />
          <Crest big />
          <SetStripe />
          <p className="hp-tag">Collect three full property sets before anyone else. Charge rent, steal deals and say no.</p>
          {rejoin && (
            <button className="hp-rejoin" onClick={() => navigate(`/room/${rejoin}`)} data-testid="button-rejoin">
              <span>
                <span className="hp-label">Your last room</span>
                <b>{rejoin}</b>
              </span>
              <span className="hp-btn gold">Rejoin</span>
            </button>
          )}
          <button className="hp-btn gold big" onClick={createRoom} disabled={creating} data-testid="button-create-game">
            {creating ? "Creating…" : "Create a game"}
          </button>
          <div className="hp-or"><span>or join with a room code</span></div>
          <form style={{ display: "flex", gap: 8 }} onSubmit={e => { e.preventDefault(); joinRoom(); }}>
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
          <p className="hp-muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>2 to 5 players. No login needed. Share the link, or add bots and play solo.</p>
        </div>
      </div>
    </div>
  );
}
