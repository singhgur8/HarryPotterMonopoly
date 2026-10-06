import type { ReactNode } from "react";
import type { PropertyColor } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import { usePhone, useTall } from "./useMedia";
import {
  CARD_DEF_MAP, COLORS, label, fillOf, rentFor, rentStep, countOf, valueOf, nameOf, groupSets, getEffectiveColor,
} from "./helpers";

function Swatch({ color, onClick, children }: { color: PropertyColor; onClick: () => void; children?: ReactNode }) {
  return (
    <button className="hp-swatch-btn" onClick={onClick}>
      <span className="sq" style={{ background: fillOf(color) }} />
      {children ?? label(color)}
    </button>
  );
}

/** The moves a selected hand card allows, shown under the hand. */
function CardMoves({ defId, done }: { defId: string; done: () => void }) {
  const { me, send } = useGame();
  const def = CARD_DEF_MAP[defId];
  if (!me || !def) return null;
  const play = (targetColor?: PropertyColor) => { send("play_card", { cardDefId: defId, targetColor }); done(); };
  const bank = () => { send("bank_card", { cardDefId: defId }); done(); };
  const bankBtn = def.value > 0 && <button className="hp-btn ghost" onClick={bank}>Bank for {def.value}M</button>;

  switch (def.type) {
    case "money":
      return <><strong>{def.name}</strong><button className="hp-btn gold" onClick={() => play()}>Bank {def.value}M</button></>;
    case "property":
      return (
        <>
          <strong>{def.name}</strong>
          <button className="hp-btn gold" onClick={() => play()}>Add to {label(def.color!)} set</button>
          <span>{rentStep(me, def.color!)}</span>
        </>
      );
    case "wild": {
      const colors = def.wildColors === "rainbow" ? [...COLORS] : (def.wildColors as PropertyColor[]);
      return (
        <>
          <strong>{def.name}</strong>
          <span>{def.wildColors === "rainbow" ? "Pick the colour it joins. You can move it later." : "Pick a side. You can flip it any time."}</span>
          {colors.map(c => (
            <Swatch key={c} color={c} onClick={() => play(c)}>
              {label(c)}<small className="hp-muted" style={{ fontWeight: 500 }}>&nbsp;{rentStep(me, c).replace(`${label(c)} `, "")}</small>
            </Swatch>
          ))}
        </>
      );
    }
    case "rent": {
      const colors = def.rentColors === "rainbow" ? groupSets(me.properties).map(g => g.color) : (def.rentColors as PropertyColor[]);
      return (
        <>
          <strong>{def.name}</strong>
          <span>Everyone else pays:</span>
          {colors.length === 0 && <span>you have no properties to charge rent for yet.</span>}
          {colors.map(c => {
            const r = rentFor(me, c);
            return (
              <button key={c} className={`hp-btn opt ${r ? "gold" : "ghost"}`} disabled={!r} onClick={() => play(c)}>
                {label(c)} {r}M<small>{countOf(me, c) ? `${countOf(me, c)} card${countOf(me, c) > 1 ? "s" : ""}` : "no cards yet"}</small>
              </button>
            );
          })}
          {bankBtn}
        </>
      );
    }
    case "action":
      if (def.actionType === "protego") {
        return <><strong>Just Say No</strong><span>Keep it in your hand to block an attack, or</span>{bankBtn}</>;
      }
      return (
        <>
          <strong>{def.name}</strong>
          <span>{def.text}</span>
          <button className="hp-btn gold" onClick={() => play()}>Play</button>
          {bankBtn}
        </>
      );
    default:
      return null;
  }
}

/** Moving a wild that's already on the table. */
function FlipMoves({ defId, done }: { defId: string; done: () => void }) {
  const { me, send } = useGame();
  const card = me?.properties.find(c => c.defId === defId);
  const def = CARD_DEF_MAP[defId];
  if (!me || !card || !def) return null;
  const now = getEffectiveColor(card)!;
  const options = def.wildColors === "rainbow" ? COLORS.filter(c => c !== now) : (def.wildColors as PropertyColor[]).filter(c => c !== now);
  const flip = (c: PropertyColor) => { send("flip_wild", { cardDefId: defId, newColor: c }); done(); };
  return (
    <>
      <strong>{def.name}</strong>
      <span>Now in {label(now)}. Flipping is free and works any time.</span>
      {options.map(c => (
        <Swatch key={c} color={c} onClick={() => flip(c)}>
          Move to {label(c)}<small className="hp-muted" style={{ fontWeight: 500 }}>&nbsp;{rentStep(me, c).replace(`${label(c)} `, "")}</small>
        </Swatch>
      ))}
      <button className="hp-btn ghost" onClick={done}>Cancel</button>
    </>
  );
}

export function HandDock({ sel, setSel, flipId, setFlip, discard }: {
  sel: string | null;
  setSel: (id: string | null) => void;
  flipId: string | null;
  setFlip: (id: string | null) => void;
  discard: { active: boolean; picked: string[]; toggle: (id: string) => void };
}) {
  const { me, s, isMyTurn } = useGame();
  const mobile = usePhone();
  const tall = useTall();
  if (!me) return null;

  const free = s.freePlayCardId;
  const canPlay = isMyTurn && !s.pendingAction && s.drawnThisTurn && s.status === "playing" && (s.actionsUsed < s.maxActions || !!free);
  const handFull = me.hand.length > 7;

  let ctx: ReactNode;
  if (flipId) ctx = <FlipMoves defId={flipId} done={() => setFlip(null)} />;
  else if (discard.active) ctx = <span>Pick {s.pendingAction?.data?.mustDiscard} card(s) to discard, then confirm above.</span>;
  else if (sel && canPlay && (!free || free === sel)) ctx = <CardMoves defId={sel} done={() => setSel(null)} />;
  else if (free && isMyTurn) ctx = <span><strong>{nameOf(free)}</strong> came back with Rewind. Play it now, for free.</span>;
  else if (canPlay) ctx = <span>Pick a card to play or bank it. The gold coin is what it's worth.{handFull ? " You'll need to discard down to 7 at the end of your turn." : ""}</span>;
  else if (isMyTurn && !s.drawnThisTurn && !s.pendingAction) ctx = <span>Draw your cards to start your turn.</span>;
  else if (isMyTurn && s.actionsUsed >= s.maxActions && !s.pendingAction) ctx = <span>No actions left. End your turn when you're ready. You can still move wilds.</span>;
  else ctx = <span>You can move your wilds while you wait. Just Say No is played from the panel above when someone targets you.</span>;

  return (
    <div className="hp-hand">
      <div className="hp-label">My hand · {me.hand.length} card{me.hand.length === 1 ? "" : "s"}{handFull ? " · over the limit of 7" : " · max 7 at end of turn"}</div>
      <div className="hp-hand-row">
        {me.hand.map(c => {
          const picked = discard.active ? discard.picked.includes(c.defId) : sel === c.defId;
          const locked = !discard.active && !!free && free !== c.defId;
          return (
            <button
              key={c.defId}
              className={`hp-cardpick ${free === c.defId ? "hp-free" : ""}`}
              aria-pressed={picked}
              aria-disabled={locked}
              aria-label={`${nameOf(c.defId)}, worth ${valueOf(c)}M`}
              onClick={() => {
                if (discard.active) return discard.toggle(c.defId);
                setFlip(null);
                setSel(picked ? null : c.defId);
              }}
              data-testid="hand-card"
            >
              <GameCard defId={c.defId} size={mobile || !tall ? "md" : "lg"} />
            </button>
          );
        })}
        {me.hand.length === 0 && <span className="hp-muted" style={{ padding: "24px 0" }}>Your hand is empty. You'll draw 5 next turn.</span>}
      </div>
      <div className="hp-ctx">{ctx}</div>
    </div>
  );
}
