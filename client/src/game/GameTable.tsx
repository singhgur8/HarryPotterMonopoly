import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, EventLogEntry, PropertyColor } from "@shared/schema";
import { SET_STYLE } from "@shared/schema";
import { useGame } from "./context";
import { Opponents } from "./Opponents";
import { ActionPanel } from "./ActionPanel";
import { MyArea } from "./MyArea";
import { HandDock } from "./HandDock";
import { usePhone } from "./useMedia";
import { isPayment } from "./helpers";
import { useGameSounds } from "./sounds";

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

const RAIL_KEY = "hp-log-open";
function readRail(): boolean {
  try { return localStorage.getItem(RAIL_KEY) !== "0"; } catch { return true; }
}
function saveRail(open: boolean) {
  try { localStorage.setItem(RAIL_KEY, open ? "1" : "0"); } catch { /* storage blocked */ }
}

function useEntries(): Entry[] {
  const { s } = useGame();
  return useMemo(() => {
    const ev = (s.eventLog || []).map((e: EventLogEntry) => ({ id: e.id, ts: e.timestamp, who: `${e.playerEmoji} ${e.playerName}`, text: e.message, chat: false }));
    const ch = (s.chatMessages || []).map((m: ChatMessage) => ({ id: m.id, ts: m.timestamp, who: `${m.playerEmoji} ${m.playerName}`, text: m.message, chat: true }));
    return [...ev, ...ch].sort((a, b) => a.ts - b.ts);
  }, [s.eventLog, s.chatMessages]);
}

/** Log + chat list with the tab switch and the chat box. */
function LogBody({ entries, tab, setTab, unreadChat }: { entries: Entry[]; tab: "all" | "chat"; setTab: (t: "all" | "chat") => void; unreadChat: number }) {
  const { send } = useGame();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const shown = tab === "chat" ? entries.filter(e => e.chat) : entries;
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, tab]);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    send("send_chat", { message: t });
    setText("");
  };
  return (
    <>
      <div className="hp-tabs">
        <button aria-pressed={tab === "all"} onClick={() => setTab("all")}>Everything</button>
        <button aria-pressed={tab === "chat"} onClick={() => setTab("chat")}>Chat{unreadChat > 0 && <span className="hp-badge">{unreadChat}</span>}</button>
      </div>
      <ul className="hp-log" ref={listRef} aria-live="polite">
        {shown.map(e => <li key={e.id} className={e.chat ? "chat" : ""}><b>{e.who}</b> {e.chat ? e.text : <LogText text={e.text} />}</li>)}
        {shown.length === 0 && <li>{tab === "chat" ? "No messages yet. Say hi." : "Nothing has happened yet."}</li>}
      </ul>
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
  const entries = useEntries();
  const { muted, toggleMute } = useGameSounds();

  const [sel, setSel] = useState<string | null>(null);
  const [flipId, setFlipId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [silencioOpen, setSilencioOpen] = useState(false);

  const [railOpen, setRailOpen] = useState(readRail);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "chat">("all");
  const logOpen = mobile ? sheetOpen : railOpen;

  // Unread: anything that arrived while the log was hidden
  const [seen, setSeen] = useState(entries.length);
  const [seenChat, setSeenChat] = useState(entries.filter(e => e.chat).length);
  const chatCount = entries.filter(e => e.chat).length;
  useEffect(() => {
    if (logOpen) { setSeen(entries.length); if (tab === "chat" || !mobile) setSeenChat(chatCount); }
  }, [logOpen, entries.length, chatCount, tab, mobile]);
  const unread = Math.max(0, entries.length - seen);
  const unreadChat = Math.max(0, chatCount - seenChat);

  // Peek bubble for a new chat line while the log is hidden
  const [peek, setPeek] = useState<Entry | null>(null);
  const lastChat = useRef(chatCount);
  useEffect(() => {
    if (chatCount > lastChat.current && !logOpen) {
      const latest = [...entries].reverse().find(e => e.chat) ?? null;
      if (latest && latest.who !== `${me?.animal.emoji} ${me?.animal.name}`) {
        setPeek(latest);
        const t = setTimeout(() => setPeek(null), 5000);
        lastChat.current = chatCount;
        return () => clearTimeout(t);
      }
    }
    lastChat.current = chatCount;
  }, [chatCount, logOpen, entries, me]);

  // Selections go stale when the table changes under them
  const handKey = me?.hand.map(c => c.defId).join(",") ?? "";
  useEffect(() => { if (sel && !me?.hand.some(c => c.defId === sel)) setSel(null); }, [handKey, sel, me]);
  useEffect(() => { if (flipId && !me?.properties.some(c => c.defId === flipId)) setFlipId(null); }, [flipId, me]);

  const discardActive = s.pendingAction?.type === "discard_excess" && s.pendingAction.targetPlayerId === me?.visitorId;
  useEffect(() => { if (!discardActive) setPicked([]); }, [discardActive]);
  useEffect(() => { if (!me?.isSilenced) setSilencioOpen(false); }, [me?.isSilenced]);

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
  const openLog = (t: "all" | "chat" = tab) => {
    setTab(t);
    setPeek(null);
    if (mobile) setSheetOpen(true);
    else { setRailOpen(true); saveRail(true); }
  };
  const setRail = (open: boolean) => { setRailOpen(open); saveRail(open); };

  const t = Math.max(0, s.turnTimer);
  const timer = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

  return (
    <div className="hp-game" data-testid="game-board">
      <header className="hp-top">
        <span className="room">Monopoly Deal</span>
        <span className="hp-muted" style={{ fontSize: 13 }}>Room <b style={{ letterSpacing: ".1em" }}>{s.roomCode}</b></span>
        {!connected && <span className="hp-chip late">Reconnecting…</span>}
        <span style={{ flex: 1 }} />
        {me && <span className="hp-muted hp-desk-only" style={{ fontSize: 13 }}>You are {me.animal.emoji} {me.animal.name}</span>}
        <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Turn sounds on" : "Mute sounds"} title={muted ? "Sounds off" : "Sounds on"}>
          {muted ? "🔇" : "🔊"}
        </button>
        {s.status === "playing" && <span className={`hp-timer hp-mobile-only ${s.turnTimer <= 10 ? "low" : ""}`}>{timer}</span>}
        <button className="hp-btn ghost hp-mobile-only" onClick={() => openLog()} aria-label="Open log and chat">
          💬{unread > 0 && <span className="hp-badge">{unread}</span>}
        </button>
      </header>

      <div className="hp-main">
        <div className="hp-table">
          <div className="hp-scroll">
            <Opponents />
            <ActionPanel discardPicked={picked} silencioOpen={silencioOpen} setSilencioOpen={setSilencioOpen} pay={pay} />
            <MyArea flipId={flipId} onFlip={id => { setSel(null); setFlipId(id); }} onPaySilencio={() => setSilencioOpen(true)} pay={pay} />
          </div>
          <HandDock sel={sel} setSel={setSel} flipId={flipId} setFlip={setFlipId} discard={{ active: discardActive, picked, toggle: togglePick }} />
        </div>

        {railOpen ? (
          <aside className="hp-rail" aria-label="Game log and chat">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="hp-label" style={{ flex: 1 }}>Log and chat</span>
              <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={() => setRail(false)} aria-label="Hide log">Hide</button>
            </div>
            <LogBody entries={entries} tab={tab} setTab={setTab} unreadChat={unreadChat} />
          </aside>
        ) : (
          <aside className="hp-rail closed" aria-label="Game log and chat, hidden">
            <button className="hp-btn ghost" style={{ padding: "6px 8px", flexDirection: "column" }} onClick={() => setRail(true)} aria-label="Show log and chat">
              💬{unread > 0 && <span className="hp-badge">{unread}</span>}
            </button>
            <span className="vert">LOG &amp; CHAT</span>
            {peek && !mobile && (
              <div className="hp-peek" onClick={() => openLog("chat")} role="button" tabIndex={0}>
                <b>{peek.who}</b> {peek.text}
              </div>
            )}
          </aside>
        )}
      </div>

      {mobile && peek && !sheetOpen && (
        <div className="hp-mpeek" onClick={() => openLog("chat")} role="button" tabIndex={0}>
          <b>{peek.who}</b> {peek.text}
        </div>
      )}
      {mobile && sheetOpen && (
        <>
          <div className="hp-sheet-back" onClick={() => setSheetOpen(false)} />
          <div className="hp-sheet" role="dialog" aria-label="Game log and chat">
            <div className="hp-grab" />
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="hp-label" style={{ flex: 1 }}>Log and chat</span>
              <button className="hp-btn ghost" style={{ padding: "2px 10px" }} onClick={() => setSheetOpen(false)}>Close</button>
            </div>
            <LogBody entries={entries} tab={tab} setTab={setTab} unreadChat={unreadChat} />
          </div>
        </>
      )}
    </div>
  );
}
