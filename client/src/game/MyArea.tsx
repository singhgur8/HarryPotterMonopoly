import type { CSSProperties } from "react";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import {
  groupSets, SET_SIZES, RENT_TABLE, label, fillOf, sumValue, valueOf, nameOf, otherColor, RAINBOW,
  completeSets, ROLE_INFO, shieldOf, type PaySelection,
} from "./helpers";

const STACK_STEP = 30;

/** Keyboard and pointer props for a card you can tap. */
function tappable(pressed: boolean, label: string, onTap: () => void) {
  return {
    role: "button", tabIndex: 0, "aria-pressed": pressed, "aria-label": label, onClick: onTap,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } },
  } as const;
}

export function MyArea({ flipId, onFlip, onPaySilencio, pay }: {
  flipId: string | null;
  onFlip: (defId: string | null) => void;
  onPaySilencio: () => void;
  pay: PaySelection;
}) {
  const { me, s, isMyTurn } = useGame();
  if (!me) return null;
  // Wilds only move on your own turn, and not while you're picking cards to pay
  const canFlip = isMyTurn && s.status === "playing" && !pay.active && !me.isSleeping;
  const sets = groupSets(me.properties);
  const coins = [...me.bank].sort((a, b) => valueOf(b) - valueOf(a));
  const role = me.role ? ROLE_INFO[me.role] : undefined;
  const shield = shieldOf(me);

  return (
    <div className={`hp-mine ${pay.active ? "paying" : ""}`}>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <div className="hp-label">My sets · {completeSets(me)} of 3 complete{pay.active && <span className="hp-chip solid" style={{ marginLeft: 8 }}>Tap cards to pay with them</span>}</div>
        <div className="hp-sets">
          {sets.map(({ color, cards }) => {
            const n = cards.length;
            const size = SET_SIZES[color];
            const full = n >= size;
            const ladder = RENT_TABLE[color];
            return (
              <div className="hp-set" key={color}>
                <div className="hp-set-head"><span className="hp-dot" style={{ background: fillOf(color) }} />{label(color)} {n}/{size}</div>
                <div className="hp-ladder" title="Rent at each set size">
                  {ladder.map((v, i) => <span key={i} className={i === Math.min(n, ladder.length) - 1 ? "on" : ""}>{v}</span>)}
                </div>
                <div className={`rent ${full ? "full" : ""}`}>{full ? "Locked · rent " : "Rent "}{ladder[Math.min(n, ladder.length) - 1]}M{shield === color ? " · Shielded" : ""}</div>
                <div className="worth">Worth {sumValue(cards)}M to pay with</div>
                <div className="hp-stack" style={{ height: 134 + (n - 1) * STACK_STEP }}>
                  {cards.map((c, i) => {
                    const other = otherColor(c);
                    const style: CSSProperties = { top: i * STACK_STEP, zIndex: i + 1 };
                    const card = <GameCard defId={c.defId} size="md" color={color} label={`${nameOf(c.defId)}, worth ${valueOf(c)}M`} />;
                    if (pay.active) {
                      const on = pay.picked.includes(c.defId);
                      return (
                        <div key={c.defId} style={style} className={`tap ${on ? "picked" : ""}`} {...tappable(on, `Pay with ${nameOf(c.defId)}, ${valueOf(c)}M`, () => pay.toggle(c.defId))}>
                          {card}
                          {on && <span className="hp-paytag" aria-hidden="true">✓</span>}
                        </div>
                      );
                    }
                    if (!other || !canFlip) return <div key={c.defId} style={style}>{card}</div>;
                    const sel = flipId === c.defId;
                    return (
                      <div
                        key={c.defId}
                        style={style}
                        className={`tap ${sel ? "sel" : ""}`}
                        {...tappable(sel, `${nameOf(c.defId)}, now ${label(color)}. Flip it`, () => onFlip(sel ? null : c.defId))}
                      >
                        {card}
                        <span className="hp-fliptag" style={{ background: other === "rainbow" ? RAINBOW : fillOf(other) }}>
                          ⇄ {other === "rainbow" ? "any" : label(other).split(" ")[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="hp-set">
            <div className="hp-set-head hp-muted">{sets.length ? "New set" : "No sets yet"}</div>
            <div className="hp-empty-set">Play a property to start a set</div>
          </div>
        </div>
      </div>

      <div className="hp-bankbox">
        <div className="hp-label">My bank</div>
        <div className="hp-bank-total">{sumValue(me.bank)}M</div>
        <div className="hp-coins">
          {coins.length ? coins.map(c => pay.active
            ? <button key={c.defId} className="hp-cn" aria-pressed={pay.picked.includes(c.defId)} aria-label={`Pay with ${valueOf(c)}M from the bank`} onClick={() => pay.toggle(c.defId)}>{valueOf(c)}</button>
            : <span key={c.defId} className="hp-cn" title={nameOf(c.defId)}>{valueOf(c)}</span>)
            : <span className="hp-muted" style={{ fontSize: 12.5 }}>Nothing banked yet</span>}
        </div>
        {role && (
          <div className="hp-myrole">
            <b style={me.isSilenced ? { textDecoration: "line-through" } : undefined}>{role.name}</b>
            <span>{role.power}</span>
            {me.isSilenced && (
              <>
                <span className="hp-chip late" style={{ justifySelf: "start" }}>Power Outage · power off</span>
                <button className="hp-btn ghost" onClick={onPaySilencio} disabled={s.status !== "playing"}>Pay 10M to end the Power Outage</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
