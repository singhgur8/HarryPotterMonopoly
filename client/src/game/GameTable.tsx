import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, EventLogEntry, PropertyColor } from "@shared/schema";
import { SET_STYLE, inDrawStep } from "@shared/schema";
import { variationOf } from "@shared/variations";
import { useGame } from "./context";
import { Opponents } from "./Opponents";
import { ActionPanel } from "./ActionPanel";
import { MyArea } from "./MyArea";
import { HandDock } from "./HandDock";
import { usePhone, useTableView } from "./useMedia";
import { isPayment, canEndOutage, roleNames, allRolesCut } from "./helpers";
import { useGameSounds } from "./sounds";
import { HomeButton } from "./Brand";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Entry = { id: string; ts: number; who: string; text: string; chat: boolean };

/** Event text with [[colour]] / [[colour|card name]] tokens drawn as small colour chips. */
function LogText({ text }: { text: string }) {
  const parts = text.split(/\[\[([a-z_]+)(?:\|([^\]]*))?\]\]/);
  return <>{parts.map((p, i) => {
    if (i % 3 === 0) return p;
    if (i % 3 === 2) return null;
    const st = SET_STYLE[p as PropertyColor];
    if (!st) return p;
    const name = parts[i + 1];
    return <span key={i} className="hp-logchip" style={{ background: st.fill, color: st.on }} title={name || undefined}>{st.label}</span>;
  })}</>;
}

/** Give up the game: your cards go back into the draw pile and you watch from then on. */
function ForfeitButton() {
  const { send } = useGame();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={() => setConfirm(true)} title="Forfeit the game" data-testid="button-forfeit">
        🏳️<span className="hp-desk-only"> Forfeit</span>
      </button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="hp-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Forfeit this game?</AlertDialogTitle>
            <AlertDialogDescription>
              Your hand, properties and money are shuffled back into the draw pile, so nobody gets them unless they draw them.
              You can't rejoin as a player, but you can stay and watch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction onClick={() => send("forfeit")} data-testid="button-confirm-forfeit">Forfeit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const RAIL_KEY = "hp-log-open";
function readRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) !== "0"; } catch { return true; }
}
function saveRail(open: boolean) {
  try { localStorage.setItem(RAIL_KEY, open ? "1" : "0"); } catch { /* storage blocked */ }
}

function useEntries(): { log: Entry[]; chat: Entry[] } {
  const { s } = useGame();
  return useMemo(() => ({
    log: (s.eventLog || []).map((e: EventLogEntry) => ({ id: e.id, ts: e.timestamp, who: `${e.playerEmoji} ${e.playerName}`, text: e.message, chat: false })),
    chat: (s.chatMessages || []).map((m: ChatMessage) => ({ id: m.id, ts: m.timestamp, who: `${m.playerEmoji} ${m.playerName}`, text: m.message, chat: true })),
  }), [s.eventLog, s.chatMessages]);
}

/** A list that stays pinned to its newest line. */
function Feed({ entries, empty, live }: { entries: Entry[]; empty: string; live?: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <ul className="hp-log" ref={listRef} aria-live={live ? "polite" : undefined}>
      {entries.map(e => <li key={e.id} className={e.chat ? "chat" : ""}><b>{e.who}</b> {e.chat ? e.text : <LogText text={e.text} />}</li>)}
      {entries.length === 0 && <li>{empty}</li>}
    </ul>
  );
}

/** Chat messages and the message box. */
function ChatBody({ chat }: { chat: Entry[] }) {
  const { send } = useGame();
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send("send_chat", { message: t });
    setText("");
  };
  return (
    <>
      <Feed entries={chat} empty="No messages yet. Say hi." live />
      <form className="hp-chatin" onSubmit={e => { e.preventDefault(); submit(); }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Message the table" maxLength={200} aria-label="Chat message" data-testid="input-chat" />
        <button type="submit" className="hp-btn gold" disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
}

export function GameTable() {
  const { s, me, connected, isMyTurn } = useGame();
  const mobile = usePhone();
  const [view, setView] = useTableView();
  // Full view needs the room of a desktop screen; phones always get the compact table
  const full = !mobile && view === "full";
  const entries = useEntries();
  const { muted, toggleMute } = useGameSounds();

  const [sel, setSel] = useState<string | null>(null);
  const [flipId, setFlipId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [silencioOpen, setSilencioOpen] = useState(false);

  const [railOpen, setRailOpen] = useState(readRail);
  const [sheet, setSheet] = useState<null | "log" | "chat">(null);
  const logOpen = mobile ? sheet === "log" : railOpen;
  const chatOpen = mobile ? sheet === "chat" : railOpen;

  // Unread: lines that arrived while their panel was hidden
  const logCount = entries.log.length;
  const chatCount = entries.chat.length;
  const [seenLog, setSeenLog] = useState(logCount);
  const [seenChat, setSeenChat] = useState(chatCount);
  useEffect(() => { if (logOpen) setSeenLog(logCount); }, [logOpen, logCount]);
  useEffect(() => { if (chatOpen) setSeenChat(chatCount); }, [chatOpen, chatCount]);
  const unreadLog = Math.max(0, logCount - seenLog);
  const unreadChat = Math.max(0, chatCount - seenChat);

  // Peek bubble for a new chat line while the chat is hidden
  const [peek, setPeek] = useState<Entry | null>(null);
  const lastChat = useRef(chatCount);
  useEffect(() => {
    if (chatCount > lastChat.current && !chatOpen) {
      const latest = entries.chat[entries.chat.length - 1] ?? null;
      if (latest && latest.who !== `${me?.animal.emoji} ${me?.animal.name}`) {
        setPeek(latest);
        const t = setTimeout(() => setPeek(null), 5000);
        lastChat.current = chatCount;
        return () => clearTimeout(t);
      }
    }
    lastChat.current = chatCount;
  }, [chatCount, chatOpen, entries, me]);
  useEffect(() => { if (chatOpen) setPeek(null); }, [chatOpen]);

  // Selections go stale when the table changes under them
  const handKey = me?.hand.map(c => c.defId).join(",") ?? "";
  useEffect(() => { if (sel && !me?.hand.some(c => c.defId === sel)) setSel(null); }, [handKey, sel, me]);
  useEffect(() => { if (flipId && !me?.properties.some(c => c.defId === flipId)) setFlipId(null); }, [flipId, me]);

  const discardActive = s.pendingAction?.type === "discard_excess" && s.pendingAction.targetPlayerId === me?.visitorId;
  useEffect(() => { if (!discardActive) setPicked([]); }, [discardActive]);
  const outageOpen = !!me && canEndOutage(s, me);
  useEffect(() => { if (!outageOpen) setSilencioOpen(false); }, [outageOpen]);

  // Paying: the picker in the panel and the cards on my table share one selection
  const pend = s.pendingAction;
  const payDue = !!me && !me.isSleeping && !!pend && isPayment(pend) && s.waitingOn === me.visitorId;
  const payKey = silencioOpen && me?.isSilenced ? "silencio"
    : payDue ? `${pend!.type}-${pend!.sourcePlayerId}-${pend!.cardDefId}-${pend!.targetPlayerId}` : "";
  const [payPicked, setPayPicked] = useState<string[]>([]);
  useEffect(() => setPayPicked([]), [payKey]);
  useEffect(() => { if (!isMyTurn) setFlipId(null); }, [isMyTurn]);
  const togglePay = (id: string) => setPayPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const pay = { active: !!payKey, picked: payPicked, toggle: togglePay, set: setPayPicked };

  const togglePick = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  // Phone: one header button; it opens chat when there's something new to read there
  const lastSheet = useRef<"log" | "chat">("chat");
  useEffect(() => { if (sheet) lastSheet.current = sheet; }, [sheet]);
  const openPanel = (p: "log" | "chat") => {
    if (mobile) setSheet(p);
    else { setRailOpen(true); saveRail(true); }
  };
  const setRail = (open: boolean) => { setRailOpen(open); saveRail(open); };

  const watchers = s.spectators?.length ?? 0;
  const t = Math.max(0, s.turnTimer);
  const timer = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  const drawStep = inDrawStep(s);

  return (
    <div className="hp-game" data-testid="game-board">
      <header className="hp-top">
        <HomeButton inGame={!!me && s.status === "playing"} roomCode={s.roomCode} />
        <span className="room hp-desk-only">Monopoly Deal · {variationOf(s.variation).name}</span>
        <span className="hp-muted" style={{ fontSize: 13 }}>Room <b style={{ letterSpacing: ".1em" }}>{s.roomCode}</b></span>
        {!connected && <span className="hp-chip late">Reconnecting…</span>}
        <span style={{ flex: 1 }} />
        {me
          ? <span className="hp-muted hp-desk-only" style={{ fontSize: 13 }}>You are {me.animal.emoji} {me.animal.name}{me.roles.length > 0 && <> <span className={`hp-role ${allRolesCut(me) ? "off" : ""}`}>{roleNames(me)}</span></>}</span>
          : <span className="hp-chip solid" data-testid="chip-spectating">👀 Watching</span>}
        {watchers > (me ? 0 : 1) && (
          <span className="hp-muted" style={{ fontSize: 13 }} title={(s.spectators || []).map(a => `${a.emoji} ${a.name}`).join(", ")}>
            👀 {watchers} watching
          </span>
        )}
        <div className="hp-tabs hp-desk-only" role="group" aria-label="Table view">
          <button aria-pressed={view === "compact"} onClick={() => setView("compact")} title="Opponents as small summaries" data-testid="button-view-compact">Compact</button>
          <button aria-pressed={view === "full"} onClick={() => setView("full")} title="Everyone's cards laid out in their own row" data-testid="button-view-full">Full view</button>
        </div>
        {me && s.status === "playing" && <ForfeitButton />}
        <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Turn sounds on" : "Mute sounds"} title={muted ? "Sounds off" : "Sounds on"}>
          {muted ? "🔇" : "🔊"}
        </button>
        {s.status === "playing" && (
          <span className={`hp-timer hp-mobile-only ${s.turnTimer <= (drawStep ? 3 : 10) ? "low" : ""}`}>
            {drawStep && <small className="hp-timer-label">Draw</small>}{timer}
          </span>
        )}
        <button className="hp-btn ghost hp-mobile-only" onClick={() => openPanel(unreadChat > 0 ? "chat" : lastSheet.current)} aria-label="Open game log and chat" title="Game log and chat" data-testid="button-open-chat">
          💬{unreadChat > 0 && <span className="hp-badge">{unreadChat}</span>}
        </button>
      </header>

      <div className="hp-main">
        <div className="hp-table">
          <div className="hp-scroll">
            <Opponents full={full} />
            <ActionPanel discardPicked={picked} silencioOpen={silencioOpen} setSilencioOpen={setSilencioOpen} pay={pay} />
            <MyArea full={full} flipId={flipId} onFlip={id => { setSel(null); setFlipId(id); }} onPaySilencio={() => setSilencioOpen(true)} pay={pay} />
          </div>
          <HandDock sel={sel} setSel={setSel} flipId={flipId} setFlip={setFlipId} discard={{ active: discardActive, picked, toggle: togglePick }} />
          {!me && (
            <div className="hp-hand">
              <span className="hp-muted" style={{ padding: "12px 0" }}>
                You're watching this game. Everyone's hand stays hidden; you'll see each card as it's played.
              </span>
            </div>
          )}
        </div>

        {railOpen ? (
          <aside className="hp-rail" aria-label="Game log and chat">
            <section className="hp-panel log" aria-label="Game log">
              <div className="hp-panel-head">
                <span className="hp-label" style={{ flex: 1 }}>📜 Game log</span>
                <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={() => setRail(false)} aria-label="Hide log and chat">Hide</button>
              </div>
              <Feed entries={entries.log} empty="Nothing has happened yet." />
            </section>
            <section className="hp-panel chat" aria-label="Chat">
              <div className="hp-panel-head">
                <span className="hp-label" style={{ flex: 1 }}>💬 Chat</span>
              </div>
              <ChatBody chat={entries.chat} />
            </section>
          </aside>
        ) : (
          <aside className="hp-rail closed" aria-label="Game log and chat, hidden">
            <button className="hp-btn ghost" style={{ padding: "6px 8px", flexDirection: "column" }} onClick={() => setRail(true)} aria-label="Show game log" title="Game log">
              📜{unreadLog > 0 && <span className="hp-badge soft">{unreadLog}</span>}
            </button>
            <button className="hp-btn ghost" style={{ padding: "6px 8px", flexDirection: "column" }} onClick={() => setRail(true)} aria-label="Show chat" title="Chat">
              💬{unreadChat > 0 && <span className="hp-badge">{unreadChat}</span>}
            </button>
            <span className="vert">LOG &amp; CHAT</span>
            {peek && !mobile && (
              <div className="hp-peek" onClick={() => openPanel("chat")} role="button" tabIndex={0}>
                <b>{peek.who}</b> {peek.text}
              </div>
            )}
          </aside>
        )}
      </div>

      {mobile && peek && !sheet && (
        <div className="hp-mpeek" onClick={() => openPanel("chat")} role="button" tabIndex={0}>
          <b>{peek.who}</b> {peek.text}
        </div>
      )}
      {mobile && sheet && (
        <>
          <div className="hp-sheet-back" onClick={() => setSheet(null)} />
          <div className="hp-sheet" role="dialog" aria-label={sheet === "chat" ? "Chat" : "Game log"}>
            <div className="hp-grab" />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="hp-tabs" style={{ flex: 1 }}>
                <button aria-pressed={sheet === "log"} onClick={() => setSheet("log")}>📜 Game log{unreadLog > 0 && <span className="hp-badge soft">{unreadLog}</span>}</button>
                <button aria-pressed={sheet === "chat"} onClick={() => setSheet("chat")}>💬 Chat{unreadChat > 0 && <span className="hp-badge">{unreadChat}</span>}</button>
              </div>
              <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={() => setSheet(null)}>Close</button>
            </div>
            {sheet === "chat"
              ? <ChatBody chat={entries.chat} />
              : <Feed entries={entries.log} empty="Nothing has happened yet." />}
          </div>
        </>
      )}
    </div>
  );
}
