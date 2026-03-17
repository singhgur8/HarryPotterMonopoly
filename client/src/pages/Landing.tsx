import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="min-h-screen flex items-center justify-center bg-background" data-testid="landing-page">
      <div className="w-full max-w-md p-8 space-y-8">
        {/* Logo area */}
        <div className="text-center space-y-3">
          <div className="text-5xl mb-2">⚡</div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Monopoly Deal
          </h1>
          <p className="text-sm text-muted-foreground">
            Wizarding World Edition
          </p>
        </div>

        {/* Create game */}
        <div className="space-y-4">
          <Button
            onClick={createRoom}
            disabled={creating}
            className="w-full h-12 text-base font-semibold"
            data-testid="button-create-game"
          >
            {creating ? "Creating..." : "Create Game"}
          </Button>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-border" />
            <span className="px-3 text-xs text-muted-foreground uppercase tracking-wider">or join</span>
            <div className="flex-grow border-t border-border" />
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Room code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              className="h-12 text-center text-lg font-mono tracking-widest uppercase"
              maxLength={5}
              data-testid="input-room-code"
            />
            <Button
              onClick={joinRoom}
              variant="secondary"
              className="h-12 px-6"
              disabled={!joinCode.trim()}
              data-testid="button-join-room"
            >
              Join
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive text-center" data-testid="text-error">
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-muted-foreground text-center">
          2-5 players — no login required
        </p>
      </div>
    </div>
  );
}
