// Small synthesized sounds for the table, so no audio files are downloaded.
// A clear chime when it becomes your turn, a softer ping when someone needs
// your answer (paying, Protego), a quiet tick for other players' moves and
// a countdown tick in your last seconds. Muting is remembered per browser.
import { useEffect, useRef, useState } from "react";
import { useGame } from "./context";

const MUTE_KEY = "hp-muted";

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only allow sound after the page has been touched once.
if (typeof window !== "undefined") {
  const unlock = () => { audio(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** One soft sine note: frequency in Hz, start offset and length in seconds. */
function note(freq: number, at: number, len: number, gain: number) {
  const a = audio();
  if (!a || a.state !== "running") return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const vol = a.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(0, t);
  vol.gain.linearRampToValueAtTime(gain, t + 0.015);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(vol).connect(a.destination);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

function buzz(ms: number | number[]) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

export const SOUNDS = {
  yourTurn() { note(660, 0, 0.35, 0.18); note(880, 0.12, 0.35, 0.18); note(1320, 0.24, 0.5, 0.14); buzz([40, 60, 40]); },
  needsYou() { note(740, 0, 0.3, 0.16); note(740, 0.16, 0.3, 0.12); buzz(40); },
  move() { note(520, 0, 0.12, 0.06); },
  tick() { note(1000, 0, 0.08, 0.08); },
};

/** Marks the browser tab while the page is in the background, until it's looked at. */
function flagTab() {
  if (typeof document === "undefined" || !document.hidden || document.title.startsWith("Your turn")) return;
  const title = document.title;
  document.title = `Your turn · ${title}`;
  const back = () => { if (!document.hidden) { document.title = title; document.removeEventListener("visibilitychange", back); } };
  document.addEventListener("visibilitychange", back);
}

/** Plays the table's sounds and returns the mute switch for the header. */
export function useGameSounds() {
  const { s, me } = useGame();
  const [muted, setMuted] = useState(readMuted);
  const toggleMute = () => setMuted(m => {
    try { localStorage.setItem(MUTE_KEY, m ? "0" : "1"); } catch { /* storage blocked */ }
    if (m) audio();
    return !m;
  });

  const meId = me?.visitorId;
  const current = s.players[s.currentTurnIndex]?.visitorId;
  const myTurn = s.status === "playing" && !!meId && current === meId;
  const needsMe = s.status === "playing" && !!meId && s.waitingOn === meId;
  const lastEvent = s.eventLog?.at(-1);

  const prev = useRef({ myTurn, needsMe, event: lastEvent?.id, timer: s.turnTimer });
  useEffect(() => {
    const was = prev.current;
    prev.current = { myTurn, needsMe, event: lastEvent?.id, timer: s.turnTimer };
    if (myTurn && !was.myTurn) flagTab();
    if (muted) return;
    if (myTurn && !was.myTurn) return SOUNDS.yourTurn();
    if (needsMe && !was.needsMe) return SOUNDS.needsYou();
    // Other players' moves get a quiet tick; your own clicks don't need one
    if (lastEvent && lastEvent.id !== was.event && lastEvent.playerName !== me?.animal.name) SOUNDS.move();
    // Countdown while the table waits on you
    if (needsMe && s.turnTimer !== was.timer && (s.turnTimer === 10 || (s.turnTimer > 0 && s.turnTimer <= 3))) SOUNDS.tick();
  }, [myTurn, needsMe, lastEvent, s.turnTimer, muted, me]);

  return { muted, toggleMute };
}
