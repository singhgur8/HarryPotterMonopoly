import { useState } from "react";
import type { PlayerState, PropertyColor } from "@shared/schema";
import { inDrawStep, freshTurnTimer } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import {
  groupSets, SET_SIZES, tileFill, valueOf, sumValue, label, fillOf, roleName, roleInfo, shieldOf, nameOf, otherColor, completeSets,
  CARD_DEF_MAP, canTake, isComplete,
} from "./helpers";

/** Avatar with a ring that empties as the player the game waits on runs out of time. */
function TimerAvatar({ p }: { p: PlayerState }) {
  const { s } = useGame();
  if (s.status !== "playing" || s.waitingOn !== p.visitorId || p.isSleeping) return <span className="hp-ava">{p.animal.emoji}</span>;
  const total = inDrawStep(s) ? freshTurnTimer(s) : s.gameSpeed;
  const frac = Math.max(0, Math.min(1, s.turnTimer / total));
  const low = s.turnTimer <= 10;
  return (
    <span className={`hp-ava hp-ava-ring ${low ? "low" : ""}`} style={{ ["--frac" as string]: `${frac * 360}deg` }} title={`${Math.max(0, s.turnTimer)}s left`}>
      <span>{p.animal.emoji}</span>
    </span>
  );
}

const ATTACKS = { accio: "Sly Deal", confundus_charm: "Forced Deal", reducto: "Demolish", expelliarmus: "Deal Breaker" } as const;
type Attack = keyof typeof ATTACKS;

const PICKS: Record<string, Attack> = {
  choose_steal: "accio", choose_swap: "confundus_charm", choose_reducto: "reducto", choose_steal_set: "expelliarmus",
};
/** Marks an attack that's already played and waiting for its target. */
const AIMING = "aiming";

/**
 * The attack cards I could use on someone's table right now, by action type:
 * one card of that kind in my hand, or AIMING when I've already played it and
 * am picking what to hit.
 */
function useAttacks(): Partial<Record<Attack, string>> {
  const { s, me, isMyTurn } = useGame();
  if (!me || !isMyTurn || s.status !== "playing" || !s.drawnThisTurn || me.isSleeping) return {};
  const p = s.pendingAction;
  if (p) {
    const kind = PICKS[p.type];
    return kind && p.sourcePlayerId === me.visitorId && p.targetPlayerId === me.visitorId ? { [kind]: AIMING } : {};
  }
  const free = s.freePlayCardId;
  if (!free && s.actionsUsed >= s.maxActions) return {};
  const found: Partial<Record<Attack, string>> = {};
  for (const c of me.hand) {
    if (free && c.defId !== free) continue;
    const t = CARD_DEF_MAP[c.defId]?.actionType as Attack | undefined;
    if (t && t in ATTACKS && !found[t]) found[t] = c.defId;
  }
  if (found.confundus_charm && me.properties.length === 0) delete found.confundus_charm;
  return found;
}

function SetLines({ p }: { p: PlayerState }) {
  const sets = groupSets(p.properties);
  if (!sets.length) return <div className="none">No properties yet</div>;
  const shield = shieldOf(p);
  return (
    <div className="hp-opp-sets">
      {sets.map(({ color, cards }) => {
        const size = SET_SIZES[color];
        const wilds = cards.filter(c => otherColor(c)).length;
        return (
          <div className="hp-setline" key={color}>
            <span className="hp-dot" style={{ background: fillOf(color) }} />
            <span className="nm">{label(color)}</span>
            <span className="hp-tiles">
              {cards.map(c => {
                const other = otherColor(c);
                const title = other === "rainbow" ? "Any-colour wild" : other ? `${label(color)} / ${label(other)} wild` : label(color);
                return (
                  <i key={c.defId} className="hp-tile" style={{ background: tileFill(c, color) }} title={`${title}, worth ${valueOf(c)}M`}>
                    <b>{valueOf(c)}</b>
                  </i>
                );
              })}
              {Array.from({ length: Math.max(0, size - cards.length) }, (_, i) => <i key={`e${i}`} className="hp-tile empty" />)}
            </span>
            <span>{cards.length}/{size}</span>
            {cards.length >= size && <span className="hp-lock">Locked</span>}
            {shield === color && <span className="hp-lock">🛡 Shield</span>}
            {wilds > 0 && cards.length < size && <span className="hp-muted" style={{ fontSize: 11 }}>{wilds} wild</span>}
          </div>
        );
      })}
    </div>
  );
}

export function OpponentSeat({ p, onOpen }: { p: PlayerState; onOpen: () => void }) {
  const { s, me } = useGame();
  const attacks = useAttacks();
  // Something here my attack cards could hit: say so, since tapping opens their table
  const target = !!me && (
    ((attacks.accio || attacks.confundus_charm || attacks.reducto) && p.properties.some(c => canTake(me, p, c))) ||
    (attacks.expelliarmus && groupSets(p.properties).some(({ color }) => isComplete(p, color) && shieldOf(p) !== color))
  );
  const turn = s.players[s.currentTurnIndex]?.visitorId === p.visitorId;
  const waited = s.waitingOn === p.visitorId && !turn;
  const coins = [...p.bank].sort((a, b) => valueOf(b) - valueOf(a));
  const late = s.waitingOn === p.visitorId && s.turnTimer <= 0 && !p.isSleeping;
  return (
    <button className={`hp-opp ${turn ? "turn" : ""} ${!p.isConnected ? "away" : ""}`} onClick={onOpen} data-testid={`player-panel-${p.seatIndex}`} aria-label={`${p.animal.name}: open their table`}>
      <div className="hp-opp-top">
        <TimerAvatar p={p} />
        <span className="nm">{p.animal.name}</span>
        {p.role && <span className={`hp-role ${p.isSilenced ? "off" : ""}`} title={`${roleInfo(p.role)?.power ?? ""}${p.isSilenced ? " (power off)" : ""}`}>{roleName(p.role).split(" ")[0]}</span>}
        {p.isSilenced && <span className="hp-chip late">Power off</span>}
        {shieldOf(p) && <span className="hp-chip gold" title={`${label(shieldOf(p)!)} is shielded by Harry's charm`}>🛡 {label(shieldOf(p)!)}</span>}
        {turn && <span className="hp-chip solid">Turn</span>}
        {waited && <span className="hp-chip gold">Deciding</span>}
        {late && <span className="hp-chip late">Out of time</span>}
        {target && <span className="hp-chip gold">🎯 Tap to steal</span>}
        {p.isBot ? <span className="hp-chip zz">🤖 Bot</span> : p.isSleeping && <span className="hp-chip zz">💤 Bot playing</span>}
        {!p.isConnected && !p.isSleeping && <span className="hp-chip wait">Offline</span>}
        <span className="hand">Hand <b>{p.hand.length}</b></span>
      </div>
      <SetLines p={p} />
      <div className="hp-opp-bank">
        <span>Bank <b>{sumValue(p.bank)}M</b></span>
        <span className="hp-coins">{coins.map(c => <span key={c.defId} className="hp-cn">{valueOf(c)}</span>)}</span>
        <span className="worth">Sets {completeSets(p)}/3 · Property {sumValue(p.properties)}M</span>
      </div>
    </button>
  );
}

export function Opponents() {
  const { s, me } = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const others = s.players.filter(p => p.visitorId !== me?.visitorId);
  const shown = s.players.find(p => p.visitorId === open);
  return (
    <>
      <div className="hp-opps">
        {others.map(p => <OpponentSeat key={p.visitorId} p={p} onOpen={() => setOpen(p.visitorId)} />)}
      </div>
      <Dialog open={!!shown} onOpenChange={o => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl hp-dialog">
          {shown && (
            <>
              <DialogHeader>
                <DialogTitle>{shown.animal.emoji} {shown.animal.name}'s table</DialogTitle>
              </DialogHeader>
              <div className="hp-inspect">
                <div className="hp-muted" style={{ fontSize: 13 }}>{shown.hand.length} cards in hand</div>
                {shown.role && (
                  <div className="hp-rolec">
                    <b style={shown.isSilenced ? { textDecoration: "line-through" } : undefined}>{roleName(shown.role)}</b>
                    <span>{roleInfo(shown.role)?.power}</span>
                    {shown.isSilenced && <span>Their power is switched off right now.</span>}
                    {shieldOf(shown) && <span>Shield is on {label(shieldOf(shown)!)}.</span>}
                  </div>
                )}
                <StealableSets target={shown} done={() => setOpen(null)} />
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="hp-label">Bank · {sumValue(shown.bank)}M</div>
                  <div className="cards">
                    {shown.bank.length ? shown.bank.map(c => <GameCard key={c.defId} defId={c.defId} size="sm" />) : <span className="hp-muted">Empty</span>}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The opponent's sets in their table view. On your turn, tapping one of their
 * properties (or a complete set) offers the attack cards you hold that can hit it.
 */
function StealableSets({ target, done }: { target: PlayerState; done: () => void }) {
  const { me, send } = useGame();
  const attacks = useAttacks();
  const [picked, setPicked] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  if (!me) return null;

  const play = (kind: Attack, targetCardDefId: string, ownCardDefId?: string) => {
    if (attacks[kind] === AIMING) send("choose_target", { targetPlayerId: target.visitorId, targetCardDefId, ownCardDefId });
    else send("play_card", { cardDefId: attacks[kind], targetPlayerId: target.visitorId, targetCardDefId, ownCardDefId });
    done();
  };
  const cardKinds = (["accio", "confundus_charm", "reducto"] as const).filter(k => attacks[k]);
  const takeableSet = (color: PropertyColor) => !!attacks.expelliarmus && isComplete(target, color) && shieldOf(target) !== color;
  const sets = groupSets(target.properties);
  // Only name the cards that have something to hit here
  const names = [
    ...(target.properties.some(c => canTake(me, target, c)) ? cardKinds : []),
    ...(sets.some(({ color }) => takeableSet(color)) ? ["expelliarmus" as const] : []),
  ].map(k => ATTACKS[k]);
  const hint = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];

  return (
    <>
      {hint && (
        <div className="hp-chip gold" style={{ justifySelf: "start", whiteSpace: "normal", borderRadius: 10, padding: "3px 10px" }}>
          {cardKinds.length && names[0] !== "Deal Breaker" ? `Tap a property to use ${hint} on it` : `You can use ${hint} on a set here`}
        </div>
      )}
      {sets.map(({ color, cards }) => {
        const setTakeable = takeableSet(color);
        return (
          <div key={color} style={{ display: "grid", gap: 6 }}>
            <div className="hp-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <div className="hp-label">{label(color)} · {cards.length}/{SET_SIZES[color]}{shieldOf(target) === color ? " · 🛡 Shielded by Harry" : ""}</div>
              {setTakeable && <button className="hp-btn gold" onClick={() => play("expelliarmus", color)}>Take the set with Deal Breaker</button>}
            </div>
            <div className="cards">
              {cards.map(c => {
                const card = <GameCard defId={c.defId} size="md" color={color} label={`${nameOf(c.defId)}, worth ${valueOf(c)}M`} />;
                const usable = cardKinds.length > 0 && canTake(me, target, c);
                if (!usable) return <span key={c.defId}>{card}</span>;
                const sel = picked === c.defId;
                return (
                  <button key={c.defId} className="hp-cardpick hp-useful" aria-pressed={sel} onClick={() => { setPicked(sel ? null : c.defId); setSwapping(false); }}>
                    {card}
                  </button>
                );
              })}
            </div>
            {picked && cards.some(c => c.defId === picked) && (
              <div className="hp-steal">
                {!swapping ? (
                  <>
                    <b>{nameOf(picked)}</b>
                    {attacks.accio && <button className="hp-btn gold" onClick={() => play("accio", picked)}>Take it with Sly Deal</button>}
                    {attacks.confundus_charm && <button className="hp-btn gold" onClick={() => setSwapping(true)}>Swap for it with Forced Deal</button>}
                    {attacks.reducto && <button className="hp-btn gold" onClick={() => play("reducto", picked)}>Destroy it with Demolish</button>}
                    <button className="hp-btn ghost" onClick={() => setPicked(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span>Forced Deal: pick the property you give {target.animal.name} in return.</span>
                    <div className="hp-row">
                      {me.properties.map(own => (
                        <button key={own.defId} className="hp-cardpick" onClick={() => play("confundus_charm", picked, own.defId)} title={`Give ${nameOf(own.defId)}`}>
                          <GameCard defId={own.defId} size="sm" color={own.assignedColor} />
                        </button>
                      ))}
                    </div>
                    <button className="hp-btn ghost" onClick={() => setSwapping(false)}>Back</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
