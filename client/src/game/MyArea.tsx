import type { CSSProperties } from "react";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import { SET_STYLE } from "@shared/schema";
import {
  groupSets, SET_SIZES, RENT_TABLE, label, fillOf, sumValue, valueOf, nameOf, otherColor, RAINBOW,
  completeSets, roleInfo, roleNames, borrowedText, setSizeFor, shortcutOf, friendName, rentFor, canEndOutage, shieldOf, roleCut, allRolesCut, outageLabel, STACK_STEP, looseWilds, movableWilds, type PaySelection,
} from "./helpers";
import { TimerAvatar } from "./Opponents";

/** Keyboard and pointer props for a card you can tap. */
function tappable(pressed: boolean, label: string, onTap: () => void) {
  return {
    role: "button", tabIndex: 0, "aria-pressed": pressed, "aria-label": label, onClick: onTap,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } },
  } as const;
}

export function MyArea({ full, flipId, onFlip, onPaySilencio, pay }: {
  full: boolean;
  flipId: string | null;
  onFlip: (defId: string | null) => void;
  onPaySilencio: () => void;
  pay: PaySelection;
}) {
  const { me, s, isMyTurn, send } = useGame();
  if (!me) return null;
  // Wilds only move on your own turn, and not while you're picking cards to pay
  const canFlip = isMyTurn && s.status === "playing" && !pay.active && !me.isSleeping;
  const sets = groupSets(me.properties);
  const loose = looseWilds(me.properties);
  const movable = movableWilds(me);
  const coins = [...me.bank].sort((a, b) => valueOf(b) - valueOf(a));
  const roles = (me.roles ?? []).map(r => roleInfo(r) && { ...roleInfo(r)!, cut: roleCut(me, r) }).filter(Boolean) as { name: string; power: string; cut: boolean }[];
  const shield = shieldOf(me);

  const area = (
    <div className={`hp-mine ${pay.active ? "paying" : ""}`}>
      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <div className="hp-label">My sets · {completeSets(me)} of 3 complete{pay.active && <span className="hp-chip solid" style={{ marginLeft: 8 }}>Tap cards to pay with them</span>}</div>
        <div className="hp-sets">
          {sets.map(({ color, cards }) => {
            const n = cards.length;
            const size = setSizeFor(me, color);
            const full = n >= size;
            const ladder = RENT_TABLE[color];
            const rentNow = rentFor(me, color);
            return (
              <div className="hp-set" key={color}>
                <div className="hp-set-head"><span className="hp-dot" style={{ background: fillOf(color) }} />{label(color)} {n}/{size}</div>
                <div className="hp-ladder" title="Rent at each set size">
                  {ladder.map((v, i) => <span key={i} className={i === (full ? ladder.length : Math.min(n, ladder.length)) - 1 ? "on" : ""}>{v}</span>)}
                </div>
                <div className={`rent ${full ? "full" : ""}`}>{full ? "Locked · rent " : "Rent "}{rentNow}M{shield === color ? " · Shielded" : ""}{shortcutOf(me) === color ? " · Shortcut" : ""}</div>
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
                    if (!other || !canFlip || !movable.includes(c)) return <div key={c.defId} style={style}>{card}</div>;
                    const sel = flipId === c.defId;
                    return (
                      <div
                        key={c.defId}
                        style={style}
                        className={`tap ${sel ? "sel" : ""}`}
                        {...tappable(sel, `${nameOf(c.defId)}, now ${label(color)}. Flip it`, () => onFlip(sel ? null : c.defId))}
                      >
                        {card}
                        {/* The flip tag is its own button: a two-colour wild flips straight away; the any-colour wild opens the colour picker */}
                        <button
                          type="button"
                          className="hp-fliptag"
                          // Two-colour wilds invert the card: the button is the other colour, the text the one on top now
                          style={other === "rainbow" ? { background: RAINBOW } : {
                            background: fillOf(other), color: fillOf(color), borderColor: fillOf(color),
                            ["--halo" as string]: SET_STYLE[color].on,
                          }}
                          aria-label={other === "rainbow" ? `Move ${nameOf(c.defId)} to another colour` : `Flip ${nameOf(c.defId)} to ${label(other)}`}
                          onClick={e => {
                            e.stopPropagation();
                            if (other === "rainbow") return onFlip(c.defId);
                            onFlip(null);
                            send("flip_wild", { cardDefId: c.defId, newColor: other });
                          }}
                          onKeyDown={e => e.stopPropagation()}
                        >
                          ⇄ {other === "rainbow" ? "any" : label(other).split(" ")[0]}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {loose.length > 0 && (
            <div className="hp-set">
              <div className="hp-set-head"><span className="hp-dot" style={{ background: RAINBOW }} />No colour yet</div>
              <div className="rent">No rent</div>
              <div className="worth">{movable.some(c => loose.includes(c)) ? "Tap to add it to a set" : "Joins a colour once you have one"}</div>
              <div className="hp-stack" style={{ height: 134 + (loose.length - 1) * STACK_STEP }}>
                {loose.map((c, i) => {
                  const style: CSSProperties = { top: i * STACK_STEP, zIndex: i + 1 };
                  const card = <GameCard defId={c.defId} size="md" label={`${nameOf(c.defId)}, no colour yet, worth ${valueOf(c)}M`} />;
                  if (pay.active) {
                    const on = pay.picked.includes(c.defId);
                    return (
                      <div key={c.defId} style={style} className={`tap ${on ? "picked" : ""}`} {...tappable(on, `Pay with ${nameOf(c.defId)}, ${valueOf(c)}M`, () => pay.toggle(c.defId))}>
                        {card}
                        {on && <span className="hp-paytag" aria-hidden="true">✓</span>}
                      </div>
                    );
                  }
                  if (!canFlip || !movable.includes(c)) return <div key={c.defId} style={style}>{card}</div>;
                  const sel = flipId === c.defId;
                  return (
                    <div key={c.defId} style={style} className={`tap ${sel ? "sel" : ""}`} {...tappable(sel, `${nameOf(c.defId)}, no colour yet. Add it to a set`, () => onFlip(sel ? null : c.defId))}>
                      {card}
                      <button
                        type="button"
                        className="hp-fliptag"
                        style={{ background: RAINBOW }}
                        aria-label={`Add ${nameOf(c.defId)} to a set`}
                        onClick={e => { e.stopPropagation(); onFlip(c.defId); }}
                        onKeyDown={e => e.stopPropagation()}
                      >
                        ⇄ join
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="hp-set">
            <div className="hp-set-head hp-muted">{sets.length || loose.length ? "New set" : "No sets yet"}</div>
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
        {roles.length > 0 && (
          <div className="hp-myrole">
            {roles.map(role => (
              <div key={role.name} style={{ display: "grid", gap: 2 }}>
                <b style={role.cut ? { textDecoration: "line-through" } : undefined}>{role.name}</b>
                <span>{role.power}</span>
              </div>
            ))}
            {borrowedText(s, me) && <span className="hp-chip gold" style={{ justifySelf: "start", whiteSpace: "normal" }}>{borrowedText(s, me)}</span>}
            {shortcutOf(me) && <span className="hp-chip gold" style={{ justifySelf: "start", whiteSpace: "normal" }}>✂ Shortcut on {label(shortcutOf(me)!)}: {setSizeFor(me, shortcutOf(me)!)} cards make a full set</span>}
            {friendName(s, me) && <span className="hp-chip gold" style={{ justifySelf: "start", whiteSpace: "normal" }}>🤝 Friends with {friendName(s, me)}: they can't act against you</span>}
            {me.isSilenced && (
              <>
                <span className="hp-chip late" style={{ justifySelf: "start" }}>Power Outage · {outageLabel(me).toLowerCase()}</span>
                {canEndOutage(s, me)
                  ? <button className="hp-btn ghost" onClick={onPaySilencio}>Pay 10M to end the Power Outage</button>
                  : <span className="hp-muted" style={{ fontSize: 12.5 }}>{isMyTurn && !s.drawnThisTurn ? "Draw first, then you can pay 10M to end it." : "You can pay 10M to end it on your turn, after you draw."}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
  if (!full) return (
    <>
      <div className="hp-mehead" data-testid="my-name">
        <span aria-hidden>{me.animal.emoji}</span>
        <span className="nm">{me.animal.name} (you)</span>
        {me.roles.length > 0 && <span className={`hp-role ${allRolesCut(me) ? "off" : ""}`}>{roleNames(me)}</span>}
      </div>
      {area}
    </>
  );
  // Full view: my cards get the same bordered row as everyone else's
  const waited = s.waitingOn === me.visitorId && !isMyTurn;
  return (
    <section className={`hp-zone me ${isMyTurn ? "turn" : waited ? "waited" : ""}`} aria-label={`Your table${isMyTurn ? ", your turn" : ""}`} data-testid="my-row">
      <div className="hp-zone-head">
        <TimerAvatar p={me} />
        <span className="nm">{me.animal.name} (you)</span>
        {me.roles.length > 0 && <span className={`hp-role ${allRolesCut(me) ? "off" : ""}`}>{roleNames(me)}</span>}
        {isMyTurn && <span className="hp-chip solid">Your turn</span>}
        {waited && <span className="hp-chip gold">Your move</span>}
        {me.isSleeping && <span className="hp-chip zz">💤 Bot playing</span>}
      </div>
      {area}
    </section>
  );
}
