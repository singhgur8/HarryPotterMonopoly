import { useEffect, useMemo, useRef, useState } from "react";
import { useRoom } from "./context";
import { roleInfo } from "./helpers";
import { VARIATIONS, VARIATION_IDS, variationOf, DEFAULT_CUSTOM_RULES } from "@shared/variations";
import { ANIMALS, type CustomRules } from "@shared/schema";
import { CustomSetup, PickRoles } from "./CustomSetup";
import { Crest, HomeButton } from "./Brand";
import { ChatBody, chatEntries } from "./Chat";

const SPEEDS = [
  { s: 30, label: "Fast" },
  { s: 60, label: "Normal" },
  { s: 90, label: "Relaxed" },
];

export function HowToWin({ sets = 3 }: { sets?: number }) {
  return (
    <div className="hp-how">
      <span>Win with {sets} complete set{sets === 1 ? "" : "s"}</span>
      <span>Draw 2, play up to 3</span>
      <span>Max 7 cards in hand</span>
    </div>
  );
}

// The name this person last typed, so it comes with them to every room
const NAME_KEY = "hp-name";
const MAX_NAME = 16;
function savedName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
}
function saveName(name: string) {
  try { name ? localStorage.setItem(NAME_KEY, name) : localStorage.removeItem(NAME_KEY); } catch { /* storage blocked */ }
}

/** Your own name, shown with the icon you pick. */
function NameField() {
  const { myAnimal, send } = useRoom();
  const [draft, setDraft] = useState(savedName);
  const sentFor = useRef<string | null>(null);

  // Bring the saved name into this room once; a clash shows an error and isn't retried
  useEffect(() => {
    const name = savedName();
    if (!myAnimal || !name || myAnimal.name === name || sentFor.current === name) return;
    sentFor.current = name;
    send("set_name", { name });
  }, [myAnimal, send]);

  const commit = () => {
    const name = draft.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
    setDraft(name);
    saveName(name);
    // An empty box goes back to the icon's name; only tell the room once
    if (name ? name !== myAnimal?.name : sentFor.current !== "") {
      sentFor.current = name;
      send("set_name", { name });
    }
  };

  return (
    <form className="hp-namerow" onSubmit={e => { e.preventDefault(); commit(); (document.activeElement as HTMLElement | null)?.blur(); }}>
      <span className="big" aria-hidden>{myAnimal?.emoji}</span>
      <input
        className="hp-name"
        value={draft}
        maxLength={MAX_NAME}
        placeholder={myAnimal?.name ? `Your name (now ${myAnimal.name})` : "Your name"}
        aria-label="Your name"
        autoComplete="nickname"
        enterKeyHint="done"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        data-testid="input-name"
      />
    </form>
  );
}

export function Lobby() {
  const { gameState, myVisitorId, myAnimal, connected, send } = useRoom();
  const chatMessages = gameState?.chatMessages;
  const chat = useMemo(() => chatEntries(chatMessages), [chatMessages]);

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
  const setsToWin = isCustom ? custom.setsToWin : variation.rules?.setsToWin ?? 3;
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

  const taken = new Set<string>(gameState.takenAnimals ?? []);

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

        <section className="hp-lobchat" aria-label="Lobby chat" data-testid="lobby-chat">
          <div className="hp-label">💬 Room chat · everyone here can see it</div>
          <ChatBody chat={chat} placeholder="Say hi, or ask who wants to play" />
        </section>

        <div style={{ display: "grid", gap: 8 }}>
          <div className="hp-label">Your name and icon · tap an icon to change it</div>
          <NameField />
          <div className="hp-chars">
            {ANIMALS.map(a => {
              const mine = myAnimal?.emoji === a.emoji;
              const isTaken = !mine && taken.has(a.name);
              return (
                <button key={a.name} className="hp-char" aria-pressed={mine} disabled={isTaken} onClick={() => !mine && send("pick_animal", { name: a.name })} data-testid={`character-${a.name}`}>
                  <span className="big">{a.emoji}</span>
                  <b>{a.name}</b>
                  {isTaken && <span className="hp-muted" style={{ fontSize: 11 }}>Taken</span>}
                </button>
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
        ) : variation.roles.length === 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            <div className="hp-label">Roles</div>
            <span className="hp-muted" style={{ fontSize: 13 }}>No roles in this game. Every player is equal.</span>
          </div>
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

        <div style={{ display: "grid", gap: 8 }}>
          <div className="hp-label">Who goes first{isHost ? "" : " · set by the host"}</div>
          <div className="hp-seg">
            <button aria-pressed={gameState.startSeat !== "first"} disabled={!isHost} onClick={() => send("set_start_seat", { startSeat: "random" })} data-testid="start-random">Random player</button>
            <button aria-pressed={gameState.startSeat === "first"} disabled={!isHost} onClick={() => send("set_start_seat", { startSeat: "first" })} data-testid="start-first">Seat 1</button>
          </div>
        </div>

        <div className="hp-lobfoot">
          <HowToWin sets={setsToWin} />
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
