import { useRoom } from "./context";
import { roleInfo } from "./helpers";
import { VARIATIONS, VARIATION_IDS, variationOf, DEFAULT_CUSTOM_RULES } from "@shared/variations";
import type { CustomRules } from "@shared/schema";
import { CustomSetup, PickRoles } from "./CustomSetup";
import { Crest, HomeButton } from "./Brand";

const SPEEDS = [
  { s: 30, label: "Fast" },
  { s: 60, label: "Normal" },
  { s: 90, label: "Relaxed" },
];

export function HowToWin() {
  return (
    <div className="hp-how">
      <span>Win with 3 complete sets</span>
      <span>Draw 2, play up to 3</span>
      <span>Max 7 cards in hand</span>
    </div>
  );
}

export function Lobby() {
  const { gameState, myVisitorId, myAnimal, connected, send } = useRoom();

  if (!gameState || !myVisitorId) {
    return (
      <div className="hp-page" style={{ alignItems: "center" }}>
        <div className="hp-lob" style={{ maxWidth: 360, justifyItems: "center", textAlign: "center" }}>
          <Crest />
          <p className="hp-muted">Connecting to the room…</p>
          <HomeButton />
        </div>
      </div>
    );
  }

  const seats: any[] = gameState.seats || [];
  const variation = variationOf(gameState.variation);
  const custom: CustomRules = gameState.custom ?? DEFAULT_CUSTOM_RULES;
  const isCustom = variation.id === "custom";
  const choosing = isCustom && custom.roleMode === "choose";
  const isHost = gameState.hostVisitorId === myVisitorId;
  const mySeat = seats.findIndex(s => s?.visitorId === myVisitorId);
  const seated = seats.filter(Boolean);
  const notReady = seated.filter(s => !s.isReady);
  const canStart = seated.length >= 2 && notReady.length === 0;
  const startHint = seated.length < 2
    ? "Need at least 2 players seated"
    : notReady.length
      ? `Waiting on ${notReady.map(s => s.animal.name).join(" and ")} to get ready`
      : "Everyone is ready";

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
  };

  return (
    <div className="hp-page">
      <div className="hp-lob" data-testid="lobby-page">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Crest />
          <span style={{ flex: 1 }} />
          <HomeButton />
        </div>

        <div className="hp-codebox">
          <div>
            <div className="hp-label">Room code</div>
            <div className="hp-codetiles" aria-label={`Room code ${gameState.roomCode}`}>
              {String(gameState.roomCode).split("").map((c: string, i: number) => <span key={i}>{c}</span>)}
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {!connected && <span className="hp-chip late">Reconnecting…</span>}
          <button className="hp-btn ghost" onClick={copyLink}>Copy invite link</button>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div className="hp-label">Players · {seated.length} of 5 seats · you are {myAnimal?.emoji} {myAnimal?.name}</div>
          <div className="hp-seats">
            {Array.from({ length: 5 }, (_, i) => {
              const s = seats[i];
              if (!s) {
                return (
                  <button key={i} className="hp-seat open" disabled={mySeat >= 0} onClick={() => send("sit_down", { seatIndex: i })} data-testid={`seat-${i}`}>
                    <span className="big">+</span>
                    <b>Seat {i + 1}</b>
                    <span style={{ fontSize: 12 }}>{mySeat >= 0 ? "Open" : "Tap to sit"}</span>
                  </button>
                );
              }
              const me = s.visitorId === myVisitorId;
              return (
                <div key={i} className={`hp-seat ${me ? "me" : ""}`} data-testid={`seat-${i}`}>
                  <span className="big">{s.animal.emoji}</span>
                  <b>{s.animal.name}{me ? " (you)" : ""}</b>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center" }}>
                    {s.isHost && <span className="hp-chip gold">Host</span>}
                    {s.isBot
                      ? <span className="hp-chip zz">🤖 Bot</span>
                      : <span className={`hp-chip ${s.isReady ? "ok" : "wait"}`}>{s.isReady ? "Ready" : "Not ready"}</span>}
                  </span>
                  {choosing && !s.isBot && (
                    <span className="hp-muted" style={{ fontSize: 12 }}>
                      {s.pickedRoles?.length ? s.pickedRoles.map((r: string) => roleInfo(r)?.name.split(" ")[0]).join(" + ") : "No roles picked"}
                    </span>
                  )}
                  {s.isBot && isHost && (
                    <button className="hp-linkbtn" style={{ fontSize: 12 }} onClick={() => send("remove_bot", { visitorId: s.visitorId })}>Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div className="hp-label">Game{isHost ? "" : " · picked by the host"}</div>
          <div className="hp-seg">
            {VARIATION_IDS.map(id => (
              <button key={id} aria-pressed={variation.id === id} disabled={!isHost} onClick={() => send("set_variation", { variation: id })} data-testid={`variation-${id}`}>
                {VARIATIONS[id].name}
              </button>
            ))}
          </div>
          <span className="hp-muted" style={{ fontSize: 13 }}>{variation.description}</span>
        </div>

        {isCustom ? (
          <>
            <CustomSetup rules={custom} isHost={isHost} send={send} />
            {choosing && mySeat >= 0 && <PickRoles rules={custom} picked={seats[mySeat]?.pickedRoles ?? []} send={send} />}
          </>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div className="hp-label">Roles · dealt at random when the game starts</div>
            <div className="hp-roles">
              {variation.roles.map(id => roleInfo(id)).map(r => r && (
                <div key={r.name} className="hp-rolec"><b>{r.name}</b>{r.power}</div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <div className="hp-label">Turn speed{isHost ? "" : " · set by the host"}</div>
          <div className="hp-seg">
            {SPEEDS.map(({ s, label }) => (
              <button key={s} aria-pressed={gameState.gameSpeed === s} disabled={!isHost} onClick={() => send("set_game_speed", { speed: s })}>
                {label} · {s}s
              </button>
            ))}
          </div>
        </div>

        <div className="hp-lobfoot">
          <HowToWin />
          <div className="hp-row">
            <span className="hp-muted" style={{ fontSize: 13 }}>{startHint}</span>
            {mySeat >= 0 && (
              <>
                <button className="hp-btn ghost" onClick={() => send("stand_up")}>Leave seat</button>
                <button className={`hp-btn ${seats[mySeat]?.isReady ? "ghost" : "gold"}`} onClick={() => send("toggle_ready")} data-testid="button-ready">
                  {seats[mySeat]?.isReady ? "Not ready" : "I'm ready"}
                </button>
              </>
            )}
            {isHost && seated.length < 5 && (
              <button className="hp-btn ghost" onClick={() => send("add_bot")} data-testid="button-add-bot">🤖 Add a bot</button>
            )}
            {isHost && (
              <button className="hp-btn gold" disabled={!canStart} onClick={() => send("start_game")} data-testid="button-start-game">Start game</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
