import { useEffect, useRef, useState } from "react";
import type { GameCard as Card, PlayerState, PropertyColor, PaymentResult } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { SET_SIZES, inDrawStep } from "@shared/schema";
import { countCompleteSets } from "@shared/cardDefs";
import { useGame } from "./context";
import { CardInfo, DiscardLink, DiscardPile } from "./DiscardPile";
import {
  CARD_DEF_MAP, COLORS, label, fillOf, valueOf, sumValue, nameOf, groupSets, canTake, isComplete, shieldOf, roleName, roleNames,
  payableCards, playerName, waitingText, isPayment, hasProtego, drawCount, tileFill, colorOnTable, looseWilds, cardBlurb, outOfMoves,
  type PaySelection,
} from "./helpers";

// ---------- paying with cards ----------

function cheapestPick(p: PlayerState, amount: number): string[] {
  const payable = payableCards(p).filter(c => valueOf(c) > 0);
  const bank = payable.filter(c => p.bank.includes(c)).sort((a, b) => valueOf(a) - valueOf(b));
  const props = payable.filter(c => !p.bank.includes(c)).sort((a, b) => {
    const ca = colorOnTable(a, p.properties), cb = colorOnTable(b, p.properties);
    const fa = ca && isComplete(p, ca) ? 1 : 0, fb = cb && isComplete(p, cb) ? 1 : 0;
    return fa - fb || valueOf(a) - valueOf(b);
  });
  const out: string[] = [];
  let total = 0;
  for (const c of [...bank, ...props]) {
    if (total >= amount) break;
    out.push(c.defId);
    total += valueOf(c);
  }
  return total >= amount ? out : payableCards(p).map(c => c.defId);
}

function PaymentPicker({ pay, amount, title, payLabel, onPay, onProtego, onCancel, mustCover }: {
  pay: PaySelection;
  amount: number;
  title: React.ReactNode;
  payLabel: (n: number) => string;
  onPay: (ids: string[]) => void;
  onProtego?: () => void;
  onCancel?: () => void;
  mustCover?: boolean; // Silencio needs the full 10M, debts accept "everything you have"
}) {
  const { me } = useGame();
  const { picked, toggle, set: setPicked } = pay;
  if (!me) return null;
  const shield = shieldOf(me);
  const required = payableCards(me);
  const total = picked.reduce((n, id) => n + valueOf(id), 0);
  const coversAll = required.every(c => picked.includes(c.defId));
  const ok = total >= amount || (!mustCover && coversAll);

  const chip = (c: Card, color?: PropertyColor) => {
    const optional = !!color && shield === color;
    return (
      <button key={c.defId} className={`hp-pick ${optional ? "opt" : ""}`} aria-pressed={picked.includes(c.defId)} onClick={() => toggle(c.defId)}>
        <span className="hp-coin">{valueOf(c)}</span>
        {color && <span className="sw" style={{ background: tileFill(c, color, 3) }} />}
        {nameOf(c.defId)}{optional ? " (shielded, optional)" : ""}
      </button>
    );
  };

  const nothing = me.bank.length === 0 && me.properties.length === 0;
  return (
    <div className="hp-prompt alert" data-testid="payment-prompt">
      <div className="head"><p>{title}</p></div>
      <div className="hp-row"><span className="hp-label lab">Bank</span>{me.bank.length ? [...me.bank].sort((a, b) => valueOf(a) - valueOf(b)).map(c => chip(c)) : <span className="hp-muted">Empty</span>}</div>
      <div className="hp-row"><span className="hp-label lab">Property</span>
        {me.properties.length ? [...groupSets(me.properties).flatMap(g => g.cards.map(c => chip(c, g.color))), ...looseWilds(me.properties).map(c => chip(c))] : <span className="hp-muted">None</span>}
      </div>
      <div className="hp-row">
        <b style={{ fontVariantNumeric: "tabular-nums" }}>Selected {total}M of {amount}M</b>
        <span className="hp-muted" style={{ fontSize: 12.5 }}>
          {nothing ? "You have nothing to pay with." : total === 0 ? "Tap the chips or your cards below." : total > amount ? "Overpaying. No change is given." : !mustCover && total < amount ? "If you can't cover it, pick everything you have." : ""}
        </span>
        <span style={{ flex: 1 }} />
        {!nothing && <button className="hp-btn ghost" onClick={() => setPicked(cheapestPick(me, amount))}>Pick cheapest for me</button>}
        {onProtego && <button className="hp-btn ghost" onClick={onProtego}>🛡️ Just Say No</button>}
        {onCancel && <button className="hp-btn ghost" onClick={onCancel}>Cancel</button>}
        <button className="hp-btn gold" disabled={!ok} onClick={() => { onPay(picked); setPicked([]); }} data-testid="button-pay">
          {nothing && !mustCover ? "Pay nothing" : payLabel(total)}
        </button>
      </div>
    </div>
  );
}

// ---------- payment tracker ----------

function Tracker() {
  const { s, me } = useGame();
  const p = s.pendingAction;
  if (!p || !isPayment(p)) return null;
  const all: string[] = p.data?.allTargets ?? [p.targetPlayerId];
  const results: PaymentResult[] = p.data?.results ?? [];
  const remaining: string[] = p.data?.remainingTargets ?? [];
  const paidCount = results.length;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span className="hp-label">{playerName(s, p.sourcePlayerId)} collects · {paidCount} of {all.length} done</span>
      <div className="hp-tracker">
        {all.map(id => {
          const r = results.find(x => x.playerId === id);
          const name = id === me?.visitorId ? "You" : playerName(s, id);
          const emoji = s.players.find(x => x.visitorId === id)?.animal.emoji;
          let cls = "", text = "Waiting";
          if (r) {
            cls = r.outcome === "paid" ? "paid" : "blocked";
            text = r.outcome === "paid" ? `Paid ${r.amount}M` : r.outcome === "nothing" ? "Had nothing" : r.outcome === "shielded" ? "Shielded" : "Blocked";
          } else if (id === p.targetPlayerId) { cls = "now"; text = "Paying now"; }
          else if (remaining[0] === id) text = "Up next";
          return <span key={id} className={`hp-tchip ${cls}`}>{emoji} <b>{name}</b> {text}</span>;
        })}
      </div>
    </div>
  );
}

// ---------- choosing a target ----------

function TargetPicker() {
  const { s, me, send } = useGame();
  const p = s.pendingAction!;
  const [own, setOwn] = useState<string | null>(null);
  useEffect(() => setOwn(null), [p.type]);
  if (!me) return null;
  const others = s.players.filter(x => x.visitorId !== me.visitorId);
  const pick = (target: string, targetCardDefId?: string, ownCardDefId?: string) =>
    send("choose_target", { targetPlayerId: target, targetCardDefId, ownCardDefId });
  const card = nameOf(p.cardDefId ?? "");

  const cardButton = (o: PlayerState, c: Card, enabled: boolean, onClick: () => void) => (
    <button key={c.defId} className="hp-cardpick" aria-disabled={!enabled} disabled={!enabled} onClick={onClick} title={`${nameOf(c.defId)}, worth ${valueOf(c)}M`}>
      <GameCard defId={c.defId} size="sm" color={colorOnTable(c, o.properties)} />
    </button>
  );

  const titles: Record<string, string> = {
    choose_steal: "Sly Deal: pick a property to take. Complete sets are locked unless you're Draco.",
    choose_swap: own ? "Forced Deal: now pick the property you want in return." : "Forced Deal: first pick one of your properties to give away.",
    choose_steal_set: "Deal Breaker: pick a complete set to take.",
    choose_reducto: "Demolish: pick a property to destroy. Bank cards are safe.",
    choose_silencio: "Power Outage: pick who loses their role power.",
    choose_goblin: "Debt Collector: pick who owes you 5M.",
  };

  return (
    <div className="hp-prompt alert" data-testid="target-prompt">
      <div className="head"><p><b>{titles[p.type] ?? `Choose a target for ${card}`}</b>{["choose_steal", "choose_swap", "choose_reducto", "choose_steal_set"].includes(p.type) ? " Or tap a player's seat to see their cards up close and pick there." : ""}</p></div>

      {p.type === "choose_swap" && !own && (
        <div className="hp-row">{me.properties.map(c => cardButton(me, c, true, () => setOwn(c.defId)))}</div>
      )}

      {(p.type !== "choose_swap" || own) && others.map(o => {
        let body: React.ReactNode = null;
        if (p.type === "choose_steal" || p.type === "choose_swap" || p.type === "choose_reducto") {
          body = o.properties.length ? o.properties.map(c => cardButton(o, c, canTake(me, o, c), () => pick(o.visitorId, c.defId, own ?? undefined))) : <span className="hp-muted">No properties</span>;
        } else if (p.type === "choose_steal_set") {
          const sets = COLORS.filter(c => isComplete(o, c) && shieldOf(o) !== c);
          body = sets.length ? sets.map(c => (
            <button key={c} className="hp-swatch-btn" onClick={() => pick(o.visitorId, c)}>
              <span className="sq" style={{ background: fillOf(c) }} />Take {label(c)}
            </button>
          )) : <span className="hp-muted">No complete sets you can take</span>;
        } else if (p.type === "choose_silencio") {
          body = <button className="hp-btn gold" disabled={o.isSilenced} onClick={() => pick(o.visitorId)}>{o.isSilenced ? "Power already off" : `Cut ${o.animal.name}'s power`}</button>;
        } else if (p.type === "choose_goblin") {
          body = <button className="hp-btn gold" onClick={() => pick(o.visitorId)}>Send to {o.animal.name} (bank {sumValue(o.bank)}M)</button>;
        }
        return (
          <div key={o.visitorId} className="hp-target">
            <div className="hp-row"><span>{o.animal.emoji}</span><b>{o.animal.name}</b><span className="hp-muted" style={{ fontSize: 12.5 }}>{o.roles.length ? `· ${o.isSilenced ? "power off" : roleNames(o)}` : ""}</span></div>
            <div className="hp-row">{body}</div>
          </div>
        );
      })}
      <div className="hp-row">
        {p.type === "choose_swap" && own && <button className="hp-btn ghost" onClick={() => setOwn(null)}>Pick a different card of mine</button>}
        <button className="hp-btn ghost" onClick={() => send("cancel_action")}>Take {card} back</button>
      </div>
    </div>
  );
}

// ---------- ending the turn for you ----------

const AUTO_END_SECONDS = 5;

/**
 * Once there's truly nothing left to do (no actions or cards to play, no wilds
 * to move), count down a few seconds and end the turn. "Keep my turn" stops it
 * for the rest of this turn.
 */
function useAutoEnd() {
  const { s, me, send } = useGame();
  const ready = !!me && outOfMoves(s, me);
  // Identifies this turn, so stopping the countdown doesn't carry into the next one
  const turnKey = `${s.currentTurnIndex}-${[...s.eventLog].reverse().find(e => e.message === "starts their turn")?.id ?? ""}`;
  const [kept, setKept] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const running = ready && kept !== turnKey;

  useEffect(() => {
    if (!running) { setLeft(null); return; }
    setLeft(AUTO_END_SECONDS);
    const id = window.setInterval(() => setLeft(n => (n === null ? null : n - 1)), 1000);
    return () => clearInterval(id);
  }, [running, turnKey]);

  useEffect(() => {
    if (running && left !== null && left <= 0) { setLeft(null); send("end_turn"); }
  }, [running, left, send]);

  return running && left !== null ? { left: Math.max(0, left), keep: () => setKept(turnKey) } : null;
}

// ---------- the panel ----------

export function ActionPanel({ discardPicked, silencioOpen, setSilencioOpen, pay }: {
  discardPicked: string[];
  pay: PaySelection;
  silencioOpen: boolean;
  setSilencioOpen: (v: boolean) => void;
}) {
  const { s, me, current, isMyTurn, send } = useGame();
  const p = s.pendingAction;
  const meId = me?.visitorId ?? "";
  const mine = !!me && s.waitingOn === meId;
  const waitedOn = s.players.find(x => x.visitorId === s.waitingOn);
  // The short draw step at the start of a turn has its own timer; the cards draw themselves when it runs out
  const drawStep = inDrawStep(s);
  const low = s.turnTimer <= (drawStep ? 3 : 10);
  const timer = `${Math.floor(Math.max(0, s.turnTimer) / 60)}:${String(Math.max(0, s.turnTimer) % 60).padStart(2, "0")}`;
  const winner = s.players.find(x => x.visitorId === s.winnerId);

  // Bring a new question for me into view
  const promptRef = useRef<HTMLDivElement>(null);
  const promptKey = mine ? `${p?.type}-${p?.cardDefId}` : "";
  useEffect(() => {
    if (!promptKey) return;
    const el = promptRef.current?.firstElementChild as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [promptKey]);

  // Turn header
  const steps = (
    <div className="hp-steps">
      <span className={`hp-step ${s.drawnThisTurn ? "done" : "now"}`}>Draw{isMyTurn && me ? ` ${drawCount(me)}` : ""}</span>
      <span className={`hp-step ${s.drawnThisTurn && s.actionsUsed < s.maxActions ? "now" : s.actionsUsed >= s.maxActions ? "done" : ""}`}>Play up to {s.maxActions}</span>
      <span className={`hp-step ${s.drawnThisTurn && s.actionsUsed >= s.maxActions ? "now" : ""}`}>End</span>
    </div>
  );
  const dots = (
    <div className="hp-acts">Actions {Array.from({ length: s.maxActions }, (_, i) => <i key={i} className={i < s.actionsUsed ? "used" : ""} />)} {s.actionsUsed} of {s.maxActions} used</div>
  );

  const autoEnd = useAutoEnd();
  let mainButton: React.ReactNode = null;
  if (isMyTurn && !p && s.status === "playing" && !me?.isSleeping) {
    // Pulse the button when it's the only thing left to do, or time is nearly up
    const endNow = !s.freePlayCardId && (s.actionsUsed >= s.maxActions || s.turnTimer <= 10);
    mainButton = autoEnd
      ? (
        <div className="hp-autoend" data-testid="auto-end">
          <button className="hp-btn gold big hp-nudge" onClick={() => send("end_turn")} data-testid="button-end-turn">End turn · {autoEnd.left}</button>
          <span className="hp-muted">No moves left, so your turn ends in {autoEnd.left}s.</span>
          <button className="hp-btn ghost" onClick={autoEnd.keep}>Keep my turn</button>
        </div>
      )
      : !s.drawnThisTurn
      ? <button className="hp-btn gold big hp-nudge" onClick={() => send("draw_cards")} data-testid="button-draw">Draw {drawCount(me!)} cards</button>
      : <button className={`hp-btn big ${s.actionsUsed >= s.maxActions ? "gold" : "ghost"} ${endNow ? "hp-nudge" : ""}`} onClick={() => send("end_turn")} disabled={!!s.freePlayCardId} data-testid="button-end-turn">End turn</button>;
  }

  // What I need to do right now
  let prompt: React.ReactNode = null;
  if (winner) {
    prompt = (
      <div className="hp-prompt win">
        <div style={{ fontSize: 40 }}>🏆</div>
        <h2 style={{ font: "800 24px var(--display)" }}>{winner.visitorId === meId ? "You win!" : `${winner.animal.name} wins!`}</h2>
        <p className="hp-muted" style={{ margin: 0 }}>
          {countCompleteSets(winner.properties, SET_SIZES) >= 3 ? "Three complete sets." : "Won by forfeit."} Head back to the start page to play again.
        </p>
        <a className="hp-btn gold" href="#/">New game</a>
      </div>
    );
  } else if (me?.isSleeping) {
    prompt = (
      <div className="hp-prompt wait">
        <div className="head"><p><b>You're asleep.</b> A bot is playing for you so the game keeps moving. It draws, plays properties, banks money, pays with your cheapest cards and never attacks.</p>
          <button className="hp-btn gold" onClick={() => send("wake_up")}>I'm back</button></div>
      </div>
    );
  } else if (silencioOpen && me?.isSilenced) {
    prompt = (
      <PaymentPicker
        pay={pay}
        amount={10}
        mustCover
        title={<><b>End the Power Outage.</b> Pay 10M from your bank or properties. The cards are discarded and your role power comes back.</>}
        payLabel={n => `Pay ${n}M`}
        onPay={ids => { send("pay_silencio", { cardDefIds: ids }); setSilencioOpen(false); }}
        onCancel={() => setSilencioOpen(false)}
      />
    );
  } else if (p && mine && me) {
    const source = playerName(s, p.sourcePlayerId);
    switch (p.type) {
      case "pay_rent": case "pay_birthday": case "pay_debt": {
        const why = p.type === "pay_rent" ? `charged ${p.data?.rentColor ? label(p.data.rentColor) + " " : ""}rent`
          : p.type === "pay_birthday" ? "played It's My Birthday" : "played Debt Collector";
        prompt = (
          <>
            <PaymentPicker
              pay={pay}
              amount={p.amount ?? 0}
              title={<><b>{source} {why}.</b> You owe {p.amount}M. Pick what to pay with{hasProtego(me) ? ", or block it with Just Say No" : ""}. Cards you give go to {source}.</>}
              payLabel={n => `Pay ${n}M`}
              onPay={ids => send("pay_with_cards", { cardDefIds: ids })}
              onProtego={hasProtego(me) ? () => send("play_protego") : undefined}
            />
            <Tracker />
          </>
        );
        break;
      }
      case "protego_response": {
        const orig = p.data?.originalAction;
        const attacking = orig?.sourcePlayerId === meId;
        const what = describeAction(s, orig);
        prompt = (
          <div className="hp-prompt alert">
            <div className="head">
              <p>{attacking
                ? <><b>{playerName(s, orig.targetPlayerId)} blocked your {what} with Just Say No.</b> Say Just Say No back to push it through?</>
                : <><b>{source} {what}.</b> Block it with Just Say No?</>}</p>
              <button className="hp-btn ghost" onClick={() => send("decline_protego")}>{attacking ? "Let it go" : "Let it happen"}</button>
              <button className="hp-btn gold" onClick={() => send("play_protego")}>🛡️ Just Say No</button>
            </div>
          </div>
        );
        break;
      }
      case "harry_protect": {
        const owned = groupSets(me.properties).map(g => g.color);
        const current = me.protectedColor;
        const moveTo = owned.filter(c => c !== current);
        prompt = (
          <div className="hp-prompt wait">
            <div className="head"><p>
              <b>Harry's charm.</b>{" "}
              {current
                ? <>Your shield is on {label(current)}. Keep it there or move it? It stays until you move it.</>
                : <>Shield one colour. It can't be stolen or charged rent, and it stays until you move it.</>}
            </p></div>
            <div className="hp-row">
              {current && (
                <button className="hp-swatch-btn" onClick={() => send("harry_protect_color", {})}>
                  <span className="sq" style={{ background: fillOf(current) }} />Keep on {label(current)}
                </button>
              )}
              {moveTo.map(c => (
                <button key={c} className="hp-swatch-btn" onClick={() => send("harry_protect_color", { color: c })}>
                  <span className="sq" style={{ background: fillOf(c) }} />{current ? "Move to" : "Shield"} {label(c)}
                </button>
              ))}
              {current
                ? <button className="hp-btn ghost" onClick={() => send("harry_protect_color", { color: null })}>Drop shield</button>
                : <button className="hp-btn ghost" onClick={() => send("harry_protect_color", {})}>{owned.length ? "No shield" : "Nothing to shield, end turn"}</button>}
            </div>
          </div>
        );
        break;
      }
      case "cedric_draw_choice": {
        const top = s.discardPile.slice(-2).reverse();
        prompt = (
          <div className="hp-prompt wait">
            <div className="head"><p><b>Cedric's choice.</b> Draw {drawCount(me)} from the deck, or take the top {top.length} of the discard pile.</p></div>
            <div className="hp-cardinfos">
              {top.map((c, i) => <CardInfo key={c.defId} defId={c.defId} tag={i === 0 ? "Top" : undefined} />)}
            </div>
            <div className="hp-row">
              <button className="hp-btn ghost" onClick={() => send("cedric_choose_source", { source: "discard" })}>Take these {top.length}</button>
              <button className="hp-btn gold" onClick={() => send("cedric_choose_source", { source: "deck" })}>Draw from the deck</button>
            </div>
          </div>
        );
        break;
      }
      case "discard_excess": {
        const n = p.data?.mustDiscard ?? 0;
        prompt = (
          <div className="hp-prompt alert">
            <div className="head">
              <p><b>Too many cards.</b> Pick {n} card{n === 1 ? "" : "s"} from your hand to discard. ({discardPicked.length} of {n} picked)</p>
              <button className="hp-btn gold" disabled={discardPicked.length !== n} onClick={() => send("discard_cards", { cardDefIds: discardPicked })}>Discard {n}</button>
            </div>
          </div>
        );
        break;
      }
      case "time_turner_play": {
        const pile = s.discardPile.filter(c => CARD_DEF_MAP[c.defId]?.actionType !== "time_turner");
        prompt = (
          <div className="hp-prompt alert">
            <div className="head"><p><b>Rewind.</b> Take any card from the discard pile. You play it straight away, for free.</p><DiscardLink /></div>
            <div className="hp-row">
              {pile.map(c => (
                <button key={c.defId} className="hp-cardpick" onClick={() => send("time_turner_choose", { cardDefId: c.defId })} title={`${nameOf(c.defId)}: ${cardBlurb(c.defId)}`}>
                  <GameCard defId={c.defId} size="sm" />
                </button>
              ))}
              <button className="hp-btn ghost" onClick={() => send("cancel_action")}>Take Rewind back</button>
            </div>
          </div>
        );
        break;
      }
      default:
        if (p.type.startsWith("choose_")) prompt = <TargetPicker />;
    }
  } else if (p && isPayment(p)) {
    prompt = <div className="hp-prompt wait"><Tracker /></div>;
  }

  // Sleep mode: once the timer runs out anyone else can hand the waiting player to the bot
  const canSleep = !!me && !winner && s.turnTimer <= 0 && !!waitedOn && waitedOn.visitorId !== meId && !waitedOn.isSleeping;

  return (
    <>
      <div className="hp-center">
        <div className="hp-piles">
          <div className="hp-pile deck">Deck<br />{s.drawPileCount ?? 0}</div>
          <DiscardPile />
        </div>
        <div className="hp-turn">
          <div className="t">{winner ? "Game over" : isMyTurn ? "Your turn" : `${current?.animal.emoji} ${current?.animal.name}'s turn`}</div>
          {!winner && steps}
          {!winner && dots}
          {!winner && (!isMyTurn || p) && <div className="hp-waitline">⏳ {waitingText(s, meId)}</div>}
          {mainButton && <div className="hp-mobile-only">{mainButton}</div>}
          <div className="hp-mobile-only"><DiscardLink /></div>
        </div>
        <div className="hp-turn-side">
          {!winner && (
            <span className={`hp-timer ${low ? "low" : ""}`} style={{ fontSize: 22 }} title={drawStep ? "Cards are drawn automatically when this runs out" : undefined}>
              {drawStep && <small className="hp-timer-label">Draw</small>}{timer}
            </span>
          )}
          {mainButton}
        </div>
      </div>
      {canSleep && (
        <div className="hp-prompt wait">
          <div className="head">
            <p><b>{waitedOn!.animal.name}'s time is up.</b> Mark them asleep and a bot plays for them so the game keeps moving. They take over again as soon as they act or tap I'm back.</p>
            <button className="hp-btn gold" onClick={() => send("put_to_sleep", { targetPlayerId: waitedOn!.visitorId })}>💤 Mark {waitedOn!.animal.name} asleep</button>
          </div>
        </div>
      )}
      <div ref={promptRef} style={{ display: "contents" }}>{prompt}</div>
    </>
  );
}

function describeAction(s: any, a: any): string {
  if (!a) return "action";
  const target = playerName(s, a.targetPlayerId);
  switch (a.type) {
    case "choose_steal": return `is using Sly Deal on ${a.targetPlayerId === s.waitingOn ? "your" : target + "'s"} ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_swap": return `is using Forced Deal to swap ${nameOf(a.data?.ownCardDefId)} for ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_steal_set": return `is using Deal Breaker on the ${label(a.data?.color)} set`;
    case "choose_reducto": return `is using Demolish on ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_silencio": return "is playing Power Outage";
    case "pay_rent": return `charged ${a.amount}M rent`;
    case "pay_birthday": return "played It's My Birthday (2M)";
    case "pay_debt": return "played Debt Collector (5M)";
    default: return "action";
  }
}
