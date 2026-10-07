import { useState } from "react";
import { useLocation } from "wouter";
import { SET_STYLE, type PropertyColor } from "@shared/schema";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FAN: PropertyColor[] = ["red", "dark_blue", "green"];

/** Code-drawn mark: three fanned property cards behind a gold M coin, in the deck's own colours. */
export function Logo({ size = 48 }: { size?: number }) {
  return (
    <svg className="hp-logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Monopoly Deal With a Twist">
      {FAN.map((c, i) => (
        <g key={c} transform={`rotate(${(i - 1) * 18} 32 60)`}>
          <rect x="20" y="6" width="24" height="34" rx="3.5" fill="#f6f1e4" stroke="#23202f" strokeOpacity=".3" strokeWidth="1" />
          <rect x="22.5" y="8.5" width="19" height="8" rx="1.5" fill={SET_STYLE[c].fill} />
        </g>
      ))}
      <circle cx="32" cy="42" r="15" fill="#f6f1e4" />
      <circle cx="32" cy="42" r="12.5" fill="url(#hp-coin)" />
      <text x="32" y="47.5" textAnchor="middle" fontFamily="Alegreya, Georgia, serif" fontWeight="800" fontSize="16" fill="#1d2331">M</text>
      <defs>
        <radialGradient id="hp-coin" cx=".35" cy=".3" r=".75">
          <stop offset="0" stopColor="#e4c071" />
          <stop offset=".7" stopColor="#b8892e" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** Thin strip of every set colour, used under the wordmark. */
export function SetStripe() {
  return (
    <div className="hp-stripe" aria-hidden="true">
      {(Object.keys(SET_STYLE) as PropertyColor[]).map(c => <span key={c} style={{ background: SET_STYLE[c].fill }} />)}
    </div>
  );
}

export function Crest({ big = false }: { big?: boolean }) {
  return (
    <div className={`hp-crest ${big ? "big" : ""}`} aria-label="Monopoly Deal With a Twist">
      <Logo size={big ? 84 : 52} />
      <div>
        <h1>Monopoly Deal</h1>
        <p>WITH A TWIST</p>
      </div>
    </div>
  );
}

/**
 * Back to the start screen. Leaving closes this tab's connection, which in the
 * lobby frees the seat. Mid-game the seat is kept, so we check first.
 */
export function HomeButton({ inGame = false, roomCode }: { inGame?: boolean; roomCode?: string }) {
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState(false);
  const goHome = () => navigate("/");
  return (
    <>
      <button
        className="hp-btn ghost hp-home"
        onClick={() => (inGame ? setConfirm(true) : goHome())}
        aria-label="Home"
        title="Back to the start screen"
        data-testid="button-home"
      >
        <Logo size={26} />
        <span className="hp-desk-only">Home</span>
      </button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="hp-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this game?</AlertDialogTitle>
            <AlertDialogDescription>
              Your seat and cards are kept. Come back any time with room code <b>{roomCode}</b>.
              If your turn comes round while you're away, the others can put you to sleep and a bot plays for you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={goHome} data-testid="button-confirm-home">Go home</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const LAST_ROOM_KEY = "hp-last-room";
export function rememberRoom(code: string) {
  try { localStorage.setItem(LAST_ROOM_KEY, code); } catch { /* storage blocked */ }
}
export function lastRoom(): string | null {
  try { return localStorage.getItem(LAST_ROOM_KEY); } catch { return null; }
}
export function forgetRoom(code: string) {
  try { if (localStorage.getItem(LAST_ROOM_KEY) === code) localStorage.removeItem(LAST_ROOM_KEY); } catch { /* storage blocked */ }
}
