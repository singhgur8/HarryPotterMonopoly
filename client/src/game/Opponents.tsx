import { useEffect, useState } from "react";
import type { GameCard as Card, PlayerState, PropertyColor } from "@shared/schema";
import { inDrawStep, freshTurnTimer } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import {
  groupSets, SET_SIZES, tileFill, valueOf, sumValue, label, fillOf, roleName, roleNames, roleInfo, borrowedText, roleCut, allRolesCut, outageLabel, shieldOf, setSizeFor, shortcutOf, friendName, rentFor, sparedBy, nameOf, otherColor, completeSets, looseWilds, colorOnTable, RAINBOW,
  CARD_DEF_MAP, canTake, isComplete, RENT_TABLE, STACK_STEP,
} from "./helpers";

/** Avatar with a ring that empties as the player the game waits on runs out of time. */
export function TimerAvatar({ p }: { p: PlayerState }) {
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

const ATTACKS = { accio: "Sly Deal", confundus_charm: "Forced Deal", reducto: "Demolish", destroy: "Destroy", expelliarmus: "Deal Breaker" } as const;
type Attack = keyof typeof ATTACKS;
const CARD_ATTACKS = ["accio", "confundus_charm", "reducto", "destroy"] as const;
/** Destroy can hit a complete set; the others can't (unless you're Draco). */
const hits = (kind: Attack, me: PlayerState, target: PlayerState, c: Card) => canTake(me, target, c, kind === "destroy");

const PICKS: Record<string, Attack> = {
  choose_steal: "accio", choose_swap: "confundus_charm", choose_reducto: "reducto", choose_destroy: "destroy", choose_steal_set: "expelliarmus",
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
  const loose = looseWilds(p.properties);
  if (!sets.length && !loose.length) return <div className="none">No properties yet</div>;
  const shield = shieldOf(p);
  return (
    <div className="hp-opp-sets">
      {sets.map(({ color, cards }) => {
        const size = setSizeFor(p, color);
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
            {shortcutOf(p) === color && <span className="hp-lock">✂ Shortcut</span>}
            {wilds > 0 && cards.length < size && <span className="hp-muted" style={{ fontSize: 11 }}>{wilds} wild</span>}
          </div>
        );
      })}
      {loose.length > 0 && (
        <div className="hp-setline">
          <span className="hp-dot" style={{ background: RAINBOW }} />
          <span className="nm">No colour</span>
          <span className="hp-tiles">
            {loose.map(c => <i key={c.defId} className="hp-tile" style={{ background: RAINBOW }} title={`Any-colour wild on its own, worth ${valueOf(c)}M`}><b>{valueOf(c)}</b></i>)}
          </span>
          <span className="hp-muted" style={{ fontSize: 11 }}>no rent</span>
        </div>
      )}
    </div>
  );
}

export function OpponentSeat({ p, onOpen }: { p: PlayerState; onOpen: () => void }) {
  const { s, me } = useGame();
  const attacks = useAttacks();
  // Something here my attack cards could hit: say so, since tapping opens their table
  const target = !!me && !!(
    CARD_ATTACKS.some(k => attacks[k] && p.properties.some(c => hits(k, me, p, c))) ||
    (attacks.expelliarmus && !sparedBy(me, p) && groupSets(p.properties).some(({ color }) => isComplete(p, color) && shieldOf(p) !== color))
  );
  const turn = s.players[s.currentTurnIndex]?.visitorId === p.visitorId;
  const coins = [...p.bank].sort((a, b) => valueOf(b) - valueOf(a));
  return (
    <button className={`hp-opp ${turn ? "turn" : ""} ${!p.isConnected ? "away" : ""}`} onClick={onOpen} data-testid={`player-panel-${p.seatIndex}`} aria-label={`${p.animal.name}: open their table`}>
      <div className="hp-opp-top">
        <TimerAvatar p={p} />
        <span className="nm">{p.animal.name}</span>
        {p.roles.length > 0 && <span className={`hp-role ${allRolesCut(p) ? "off" : ""}`} title={`${p.roles.map(r => roleInfo(r)?.power ?? "").join(" ")}${p.isSilenced ? ` (${outageLabel(p).toLowerCase()})` : ""}`}>{roleNames(p, true)}</span>}
        <SeatChips p={p} target={target} />
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

export function Opponents({ full }: { full: boolean }) {
  const { s, me } = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const others = s.players.filter(p => p.visitorId !== me?.visitorId);
  const shown = s.players.find(p => p.visitorId === open);
  if (full) {
    return (
      <div className="hp-rows" data-testid="opponent-rows">
        {others.map(p => <OpponentRow key={p.visitorId} p={p} />)}
      </div>
    );
  }
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
                {shown.roles.length > 0 && (
                  <div className="hp-rolec">
                    {shown.roles.map(r => (
                      <span key={r} style={{ display: "grid", gap: 2 }}>
                        <b style={roleCut(shown, r) ? { textDecoration: "line-through" } : undefined}>{roleName(r)}</b>
                        <span>{roleInfo(r)?.power}</span>
                      </span>
                    ))}
                    {borrowedText(s, shown) && <span>{borrowedText(s, shown)}.</span>}
                    {shown.isSilenced && <span>{outageLabel(shown) === "Power off" ? "Their power is" : `Their ${roleName(shown.silencedRole)} power is`} switched off right now.</span>}
                    {shieldOf(shown) && <span>Shield is on {label(shieldOf(shown)!)}.</span>}
                    {shortcutOf(shown) && <span>Shortcut is on {label(shortcutOf(shown)!)}: {setSizeFor(shown, shortcutOf(shown)!)} cards make a full set.</span>}
                    {friendName(s, shown) && <span>Friends with {friendName(s, shown)} this round.</span>}
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

/** Status chips shared by the compact seat and the full row. */
function SeatChips({ p, target }: { p: PlayerState; target: boolean }) {
  const { s } = useGame();
  const turn = s.players[s.currentTurnIndex]?.visitorId === p.visitorId;
  const waited = s.waitingOn === p.visitorId && !turn;
  const late = s.waitingOn === p.visitorId && s.turnTimer <= 0 && !p.isSleeping;
  return (
    <>
      {p.isSilenced && <span className="hp-chip late">{outageLabel(p)}</span>}
      {shieldOf(p) && <span className="hp-chip gold" title={`${label(shieldOf(p)!)} is shielded by Harry's charm`}>🛡 {label(shieldOf(p)!)}</span>}
      {shortcutOf(p) && <span className="hp-chip gold" title={`${label(shortcutOf(p)!)} needs one fewer card (Tharki's Shortcut)`}>✂ {label(shortcutOf(p)!)}</span>}
      {friendName(s, p) && <span className="hp-chip gold" title={`${friendName(s, p)} can't act against ${p.animal.name} this round`}>🤝 {friendName(s, p)}</span>}
      {turn && <span className="hp-chip solid">Turn</span>}
      {waited && <span className="hp-chip gold">Deciding</span>}
      {late && <span className="hp-chip late">Out of time</span>}
      {target && <span className="hp-chip gold">🎯 Tap to steal</span>}
      {p.isBot ? <span className="hp-chip zz">🤖 Bot</span> : p.isSleeping && <span className="hp-chip zz">💤 Bot playing</span>}
      {!p.isConnected && !p.isSleeping && <span className="hp-chip wait">Offline</span>}
    </>
  );
}

/**
 * Full view: an opponent's own row with their sets laid out like mine. On your
 * turn, tapping one of their properties (or a set's Deal Breaker button) attacks it.
 */
function OpponentRow({ p }: { p: PlayerState }) {
  const { s } = useGame();
  const st = useSteal(p);
  const turn = s.players[s.currentTurnIndex]?.visitorId === p.visitorId;
  const waited = s.waitingOn === p.visitorId && !turn;
  const sets = groupSets(p.properties);
  const loose = looseWilds(p.properties);
  const shield = shieldOf(p);
  const coins = [...p.bank].sort((a, b) => valueOf(b) - valueOf(a));
  const target = st.names.length > 0;
  return (
    <section
      className={`hp-zone ${turn ? "turn" : waited ? "waited" : ""} ${!p.isConnected ? "away" : ""}`}
      aria-label={`${p.animal.name}'s table${turn ? ", their turn" : ""}`}
      data-testid={`player-row-${p.seatIndex}`}
    >
      <div className="hp-zone-head">
        <TimerAvatar p={p} />
        <span className="nm">{p.animal.name}</span>
        {p.roles.length > 0 && <span className={`hp-role ${allRolesCut(p) ? "off" : ""}`}>{roleNames(p)}</span>}
        <SeatChips p={p} target={target} />
        <span className="hand">Hand <b>{p.hand.length}</b></span>
      </div>
      <div className="hp-mine">
        <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <div className="hp-label">Sets · {completeSets(p)} of 3 complete</div>
          <div className="hp-sets">
            {sets.map(({ color, cards }) => {
              const n = cards.length;
              const size = setSizeFor(p, color);
              const full = n >= size;
              return (
                <div className="hp-set" key={color}>
                  <div className="hp-set-head"><span className="hp-dot" style={{ background: fillOf(color) }} />{label(color)} {n}/{size}</div>
                  <div className={`rent ${full ? "full" : ""}`}>{full ? "Locked · rent " : "Rent "}{rentFor(p, color)}M</div>
                  {shield === color && <span className="hp-lock">🛡 Shielded by Harry</span>}
                  {shortcutOf(p) === color && <span className="hp-lock">✂ Tharki's Shortcut</span>}
                  {st.takeableSet(color) && (
                    <button className="hp-btn gold hp-useful" style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => st.play("expelliarmus", color)}>
                      Deal Breaker
                    </button>
                  )}
                  <div className="hp-stack" style={{ height: 134 + (n - 1) * STACK_STEP }}>
                    {cards.map((c, i) => {
                      const style = { top: i * STACK_STEP, zIndex: i + 1 };
                      const card = <GameCard defId={c.defId} size="md" color={color} label={`${nameOf(c.defId)}, worth ${valueOf(c)}M`} />;
                      if (!st.usable(c.defId)) return <div key={c.defId} style={style}>{card}</div>;
                      const sel = st.picked === c.defId;
                      return (
                        <button
                          key={c.defId}
                          style={style}
                          className="hp-cardpick hp-useful"
                          aria-pressed={sel}
                          aria-label={`${nameOf(c.defId)}: choose a card to use on it`}
                          onClick={() => st.pick(sel ? null : c.defId)}
                        >
                          {card}
                        </button>
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
                <div className="hp-stack" style={{ height: 134 + (loose.length - 1) * STACK_STEP }}>
                  {loose.map((c, i) => {
                    const style = { top: i * STACK_STEP, zIndex: i + 1 };
                    const card = <GameCard defId={c.defId} size="md" label={`${nameOf(c.defId)}, no colour yet, worth ${valueOf(c)}M`} />;
                    if (!st.usable(c.defId)) return <div key={c.defId} style={style}>{card}</div>;
                    const sel = st.picked === c.defId;
                    return (
                      <button key={c.defId} style={style} className="hp-cardpick hp-useful" aria-pressed={sel} aria-label={`${nameOf(c.defId)}: choose a card to use on it`} onClick={() => st.pick(sel ? null : c.defId)}>
                        {card}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {!sets.length && !loose.length && <div className="hp-empty-set">No properties yet</div>}
          </div>
          <StealBar st={st} target={p} />
        </div>
        <div className="hp-bankbox">
          <div className="hp-label">Bank</div>
          <div className="hp-bank-total">{sumValue(p.bank)}M</div>
          <div className="hp-coins">
            {coins.length ? coins.map(c => <span key={c.defId} className="hp-cn" title={nameOf(c.defId)}>{valueOf(c)}</span>)
              : <span className="hp-muted" style={{ fontSize: 12.5 }}>Nothing banked yet</span>}
          </div>
          {p.roles.length > 0 && (
            <div className="hp-myrole">
              {p.roles.map(r => (
                <div key={r} style={{ display: "grid", gap: 2 }}>
                  <b style={roleCut(p, r) ? { textDecoration: "line-through" } : undefined}>{roleName(r)}</b>
                  <span>{roleInfo(r)?.power}</span>
                </div>
              ))}
              {borrowedText(s, p) && <span>{borrowedText(s, p)}.</span>}
              {friendName(s, p) && <span>Friends with {friendName(s, p)} this round.</span>}
              {p.isSilenced && <span>{outageLabel(p) === "Power off" ? "Their power is" : `Their ${roleName(p.silencedRole)} power is`} switched off right now.</span>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type Steal = ReturnType<typeof useSteal>;

/**
 * Picking an opponent's property to hit with the attack cards I hold, shared by
 * the table dialog (compact view) and the opponent's row (full view).
 */
function useSteal(target: PlayerState, done?: () => void) {
  const { me, send } = useGame();
  const attacks = useAttacks();
  const [picked, setPicked] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);

  const cardKinds = CARD_ATTACKS.filter(k => attacks[k]);
  const usable = (defId: string, kind?: Attack) => {
    const c = target.properties.find(x => x.defId === defId);
    return !!me && !!c && (kind ? [kind] : cardKinds).some(k => attacks[k] && hits(k, me, target, c));
  };
  const takeableSet = (color: PropertyColor) => !!me && !!attacks.expelliarmus && !sparedBy(me, target) && isComplete(target, color) && shieldOf(target) !== color;
  // The pick goes stale when the card moves or I can no longer use anything on it
  const stale = !!picked && !usable(picked);
  useEffect(() => { if (stale) { setPicked(null); setSwapping(false); } }, [stale]);

  const play = (kind: Attack, targetCardDefId: string, ownCardDefId?: string) => {
    if (attacks[kind] === AIMING) send("choose_target", { targetPlayerId: target.visitorId, targetCardDefId, ownCardDefId });
    else send("play_card", { cardDefId: attacks[kind], targetPlayerId: target.visitorId, targetCardDefId, ownCardDefId });
    setPicked(null);
    setSwapping(false);
    done?.();
  };
  const sets = groupSets(target.properties);
  // Only name the cards that have something to hit here
  const names = !me ? [] : [
    ...cardKinds.filter(k => target.properties.some(c => hits(k, me, target, c))),
    ...(sets.some(({ color }) => takeableSet(color)) ? ["expelliarmus" as const] : []),
  ].map(k => ATTACKS[k]);
  const hint = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0];
  const pick = (id: string | null) => { setPicked(id); setSwapping(false); };
  return { me, attacks, picked: stale ? null : picked, pick, swapping, setSwapping, cardKinds, usable, takeableSet, play, names, hint };
}

/** The choices for the property I picked: which attack card to use on it. */
function StealBar({ st, target }: { st: Steal; target: PlayerState }) {
  const { me, picked, swapping, setSwapping, play, pick, usable } = st;
  if (!me || !picked) return null;
  return (
    <div className="hp-steal">
      {!swapping ? (
        <>
          <b>{nameOf(picked)}</b>
          {usable(picked, "accio") && <button className="hp-btn gold" onClick={() => play("accio", picked)}>Take it with Sly Deal</button>}
          {usable(picked, "confundus_charm") && <button className="hp-btn gold" onClick={() => setSwapping(true)}>Swap for it with Forced Deal</button>}
          {usable(picked, "reducto") && <button className="hp-btn gold" onClick={() => play("reducto", picked)}>Destroy it with Demolish</button>}
          {usable(picked, "destroy") && <button className="hp-btn gold" onClick={() => play("destroy", picked)}>Discard it with Destroy</button>}
          <button className="hp-btn ghost" onClick={() => pick(null)}>Cancel</button>
        </>
      ) : (
        <>
          <span>Forced Deal: pick the property you give {target.animal.name} in return.</span>
          <div className="hp-row">
            {me.properties.map(own => (
              <button key={own.defId} className="hp-cardpick" onClick={() => play("confundus_charm", picked, own.defId)} title={`Give ${nameOf(own.defId)}`}>
                <GameCard defId={own.defId} size="sm" color={colorOnTable(own, me.properties)} />
              </button>
            ))}
          </div>
          <button className="hp-btn ghost" onClick={() => setSwapping(false)}>Back</button>
        </>
      )}
    </div>
  );
}

/**
 * The opponent's sets in their table view. On your turn, tapping one of their
 * properties (or a complete set) offers the attack cards you hold that can hit it.
 */
function StealableSets({ target, done }: { target: PlayerState; done: () => void }) {
  const st = useSteal(target, done);
  const { me, cardKinds, names, hint, takeableSet, usable, picked, pick, play } = st;
  if (!me) return null;
  const sets = groupSets(target.properties);

  return (
    <>
      {hint && (
        <div className="hp-chip gold" style={{ justifySelf: "start", whiteSpace: "normal", borderRadius: 10, padding: "3px 10px" }}>
          {cardKinds.length && names[0] !== "Deal Breaker" ? `Tap a property to use ${hint} on it` : `You can use ${hint} on a set here`}
        </div>
      )}
      {sets.map(({ color, cards }) => (
        <div key={color} style={{ display: "grid", gap: 6 }}>
          <div className="hp-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <div className="hp-label">{label(color)} · {cards.length}/{setSizeFor(target, color)}{shieldOf(target) === color ? " · 🛡 Shielded by Harry" : ""}</div>
            {takeableSet(color) && <button className="hp-btn gold" onClick={() => play("expelliarmus", color)}>Take the set with Deal Breaker</button>}
          </div>
          <div className="cards">
            {cards.map(c => {
              const card = <GameCard defId={c.defId} size="md" color={color} label={`${nameOf(c.defId)}, worth ${valueOf(c)}M`} />;
              if (!usable(c.defId)) return <span key={c.defId}>{card}</span>;
              const sel = picked === c.defId;
              return (
                <button key={c.defId} className="hp-cardpick hp-useful" aria-pressed={sel} onClick={() => pick(sel ? null : c.defId)}>
                  {card}
                </button>
              );
            })}
          </div>
          {picked && cards.some(c => c.defId === picked) && <StealBar st={st} target={target} />}
        </div>
      ))}
      {looseWilds(target.properties).length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="hp-label">No colour yet · not in a set</div>
          <div className="cards">
            {looseWilds(target.properties).map(c => {
              const card = <GameCard defId={c.defId} size="md" label={`${nameOf(c.defId)}, no colour yet, worth ${valueOf(c)}M`} />;
              if (!usable(c.defId)) return <span key={c.defId}>{card}</span>;
              const sel = picked === c.defId;
              return (
                <button key={c.defId} className="hp-cardpick hp-useful" aria-pressed={sel} onClick={() => pick(sel ? null : c.defId)}>
                  {card}
                </button>
              );
            })}
          </div>
          {picked && looseWilds(target.properties).some(c => c.defId === picked) && <StealBar st={st} target={target} />}
        </div>
      )}
    </>
  );
}
