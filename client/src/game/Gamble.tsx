// Vegas (Beta): the start-of-turn gamble, the Guess and Draw question and the
// dice / coin / card animation everyone sees when someone gambles.
import { useEffect, useRef, useState } from "react";
import type { GambleRoll, GuessKind } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import { nameOf, playerName, sparedBy, sumValue, valueOf } from "./helpers";

const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const face = (n: number) => FACES[Math.min(6, Math.max(1, n)) - 1];

/** The current player's gamble: roll the dice, duel someone, or bet bank money on a coin toss. */
export function GamblePrompt() {
  const { s, me, send } = useGame();
  const [bet, setBet] = useState<string[]>([]);
  if (!me) return null;
  const rivals = s.players.filter(o => o.visitorId !== me.visitorId && !sparedBy(me, o));
  const total = bet.reduce((n, id) => n + valueOf(id), 0);
  const toggle = (id: string) => setBet(b => b.includes(id) ? b.filter(x => x !== id) : [...b, id]);

  return (
    <div className="hp-prompt wait" data-testid="gamble-prompt">
      <div className="head"><p><b>Place your bet.</b> Every turn in Vegas starts with a gamble. Pick one, then draw.</p></div>
      <div className="hp-gambles">
        <div className="hp-gamble">
          <b>🎲 Roll the dice</b>
          <span className="hp-muted">3 keeps your turn. 1 or 2 loses it. 4, 5 or 6 gives you an extra turn after this one.</span>
          <div className="hp-row"><button className="hp-btn gold" onClick={() => send("vegas_gamble", { choice: "dice" })} data-testid="gamble-dice">Roll</button></div>
        </div>
        <div className="hp-gamble">
          <b>⚔️ Dice duel</b>
          <span className="hp-muted">You and another player each roll a die. The higher roll takes a random card from the other's hand. A tie does nothing. They can Just Say No.</span>
          <div className="hp-row">
            {rivals.map(o => (
              <button key={o.visitorId} className="hp-btn ghost" onClick={() => send("vegas_gamble", { choice: "duel", targetPlayerId: o.visitorId })} data-testid={`gamble-duel-${o.seatIndex}`}>
                {o.animal.emoji} {o.animal.name} ({o.hand.length} in hand)
              </button>
            ))}
          </div>
        </div>
        <div className="hp-gamble">
          <b>🪙 Coin toss bet</b>
          <span className="hp-muted">Bet money from your bank. Heads, the house pays you the same again. Tails, you lose it.</span>
          <div className="hp-row">
            {me.bank.length
              ? [...me.bank].sort((a, b) => valueOf(a) - valueOf(b)).map(c => (
                <button key={c.defId} className="hp-pick" aria-pressed={bet.includes(c.defId)} onClick={() => toggle(c.defId)}>
                  <span className="hp-coin">{valueOf(c)}</span>{nameOf(c.defId)}
                </button>
              ))
              : <span className="hp-muted">Your bank is empty, so there's nothing to bet.</span>}
          </div>
          {me.bank.length > 0 && (
            <div className="hp-row">
              <button className="hp-btn gold" disabled={total === 0} onClick={() => { send("vegas_gamble", { choice: "bet", cardDefIds: bet }); setBet([]); }} data-testid="gamble-bet">
                {total ? `Bet ${total}M` : "Pick money to bet"}
              </button>
              {total > 0 && total < sumValue(me.bank) && <button className="hp-btn ghost" onClick={() => setBet(me.bank.map(c => c.defId))}>Bet it all</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const KINDS: { kind: GuessKind; label: string; hint: string }[] = [
  { kind: "property", label: "🏠 Property", hint: "properties and wilds" },
  { kind: "cash", label: "💰 Cash", hint: "money" },
  { kind: "action", label: "⚡ Action", hint: "actions and rent" },
];

/** Guess and Draw: guess the top card's kind until a guess is wrong. */
export function GuessPrompt() {
  const { s, send } = useGame();
  const history: { defId: string; right: boolean }[] = s.pendingAction?.data?.history ?? [];
  const kept = history.filter(h => h.right).length;
  return (
    <div className="hp-prompt wait" data-testid="guess-prompt">
      <div className="head"><p><b>Guess and Draw.</b> What's the top card of the deck? Right, you keep it and guess again. Wrong, it's discarded and you stop.{kept ? ` You've kept ${kept} so far.` : ""}</p></div>
      <div className="hp-row">
        {KINDS.map(k => (
          <button key={k.kind} className="hp-btn gold opt" onClick={() => send("guess_card", { guess: k.kind })} data-testid={`guess-${k.kind}`}>
            {k.label}<small>{k.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

const ROLL_MS = 1100;
const SHOW_MS = 3600;

/**
 * Shows each new dice roll, duel, coin toss, card guess or All In roll-off to
 * everyone at the table: a short tumble, then the result. Tap to close it.
 * Rolls that happened before the page loaded aren't replayed.
 */
export function GambleOverlay() {
  const { s } = useGame();
  const g = s.gamble;
  const seen = useRef<string | null | undefined>(g?.id);
  const [shown, setShown] = useState<GambleRoll | null>(null);
  const [rolling, setRolling] = useState(false);
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    if (!g || g.id === seen.current) return;
    seen.current = g.id;
    setShown(g);
    setRolling(true);
    const tumble = window.setInterval(() => setSpin(n => n + 1), 90);
    const stop = window.setTimeout(() => { setRolling(false); clearInterval(tumble); }, ROLL_MS);
    const hide = window.setTimeout(() => setShown(null), SHOW_MS);
    return () => { clearInterval(tumble); clearTimeout(stop); clearTimeout(hide); };
  }, [g?.id]);

  if (!shown) return null;
  const who = (id: string) => (s.players.find(p => p.visitorId === id)?.animal.emoji ?? "") + " " + playerName(s, id);
  const title = shown.kind === "dice" ? "Dice roll" : shown.kind === "duel" ? "Dice duel" : shown.kind === "coin" ? "Coin toss" : shown.kind === "guess" ? "Guess and Draw" : "All In";

  return (
    <div className="hp-gamble-back" onClick={() => setShown(null)} role="dialog" aria-label={title} data-testid="gamble-overlay">
      <div className="hp-gamble-box">
        <span className="hp-label">{title}</span>
        {shown.rolls && shown.rolls.length > 0 && (
          <div className="hp-dice-rows">
            {shown.rolls.map((r, i) => (
              <div key={r.playerId} className="hp-dice-row">
                {shown.rolls!.length > 1 && <span className="who">{who(r.playerId)}</span>}
                <span className={`hp-dice ${rolling ? "rolling" : ""}`} aria-label={rolling ? "Rolling" : `Rolled ${r.dice.join(" and ")}`}>
                  {r.dice.map((d, j) => <span key={j}>{rolling ? face(((spin + i * 2 + j * 3) % 6) + 1) : face(d)}</span>)}
                </span>
                {!rolling && r.dice.length > 1 && <b className="sum">{r.dice.reduce((a, b) => a + b, 0)}</b>}
              </div>
            ))}
          </div>
        )}
        {shown.kind === "coin" && (
          <div className={`hp-flipcoin ${rolling ? "flipping" : ""}`} aria-label={rolling ? "Tossing" : shown.coin}>
            {rolling ? "" : shown.coin === "heads" ? "H" : "T"}
          </div>
        )}
        {shown.kind === "guess" && shown.defId && (
          <div className={`hp-guess-card ${rolling ? "flipping" : ""}`}>
            {rolling ? <div className="back">?</div> : <GameCard defId={shown.defId} size="sm" />}
          </div>
        )}
        <p className={rolling ? "hp-muted" : ""}>
          {rolling ? (shown.kind === "coin" ? "Tossing…" : shown.kind === "guess" ? "Turning it over…" : "Rolling…") : <><b>{who(shown.playerId)}</b> {plain(shown.result)}</>}
        </p>
        {!rolling && <span className="hp-muted" style={{ fontSize: 12 }}>Tap to close</span>}
      </div>
    </div>
  );
}

// Log text marks card names as [[colour|name]]; show just the name here
const plain = (text: string) => text.replace(/\[\[[a-z_]+\|([^\]]+)\]\]/g, "$1").replace(/\[\[([a-z_]+)\]\]/g, "$1");
