import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, PropertyColor } from "@shared/schema";
import { SET_STYLE } from "@shared/schema";
import { useRoom } from "./context";

export type Entry = { id: string; ts: number; who: string; text: string; chat: boolean };

export function chatEntries(messages: ChatMessage[] | undefined): Entry[] {
  return (messages || []).map(m => ({ id: m.id, ts: m.timestamp, who: `${m.playerEmoji} ${m.playerName}`, text: m.message, chat: true }));
}

/** Event text with [[colour]] / [[colour|card name]] tokens drawn as small colour chips. */
function LogText({ text }: { text: string }) {
  const parts = text.split(/\[\[([a-z_]+)(?:\|([^\]]*))?\]\]/);
  return <>{parts.map((p, i) => {
    if (i % 3 === 0) return p;
    if (i % 3 === 2) return null;
    // A card taken from someone's hand that only those two players get to see
    if (p === "hidden") return <span key={i} className="hp-logchip hidden" title="Only the two players involved see which card">? card</span>;
    const st = SET_STYLE[p as PropertyColor];
    if (!st) return p;
    const name = parts[i + 1];
    return <span key={i} className="hp-logchip" style={{ background: st.fill, color: st.on }} title={name || undefined}>{st.label}</span>;
  })}</>;
}

// How close to the bottom (px) still counts as "at the bottom"
const STICK_SLACK = 24;

/**
 * A list that follows its newest line while you're at the bottom. Scrolling up
 * stops it so you can read back; scrolling down to the end again resumes it.
 */
export function Feed({ entries, empty, live }: { entries: Entry[]; empty: string; live?: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  const stick = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  // The last id, not the length: the server caps the log, so once full its length stops changing
  const lastId = entries[entries.length - 1]?.id;

  const toBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useLayoutEffect(() => {
    if (stick.current) toBottom();
    else if (lastId) setNewBelow(true);
  }, [lastId]);

  // Keep the newest line in view when the panel changes size (sheet opening, window resizing)
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) toBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK;
    stick.current = atBottom;
    if (atBottom) setNewBelow(false);
  };

  return (
    <div className="hp-feed">
      <ul className="hp-log" ref={listRef} onScroll={onScroll} aria-live={live ? "polite" : undefined}>
        {entries.map(e => <li key={e.id} className={e.chat ? "chat" : ""}><b>{e.who}</b> {e.chat ? e.text : <LogText text={e.text} />}</li>)}
        {entries.length === 0 && <li>{empty}</li>}
      </ul>
      {newBelow && (
        <button className="hp-jump" onClick={() => { stick.current = true; setNewBelow(false); toBottom(); }} data-testid="button-jump-latest">
          ↓ New
        </button>
      )}
    </div>
  );
}

/** Chat messages and the message box. Works for anyone in the room: lobby, players and spectators. */
export function ChatBody({ chat, placeholder = "Message the table" }: { chat: Entry[]; placeholder?: string }) {
  const { send } = useRoom();
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
        <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} maxLength={200} enterKeyHint="send" aria-label="Chat message" data-testid="input-chat" />
        <button type="submit" className="hp-btn gold" disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
}
