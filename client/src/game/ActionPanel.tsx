import { useEffect, useRef, useState } from "react";
import type { GameCard as Card, PlayerState, PropertyColor, PaymentResult } from "@shared/schema";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import { CardInfo, DiscardLink, DiscardPile } from "./DiscardPile";
import {
  CARD_DEF_MAP, COLORS, label, fillOf, valueOf, sumValue, nameOf, groupSets, canTake, isComplete, shieldOf,
  payableCards, playerName, waitingText, isPayment, hasProtego, drawCount, tileFill, getEffectiveColor, cardBlurb,
} from "./helpers";

// ---------- paying with cards ----------

function cheapestPick(p: PlayerState, amount: number): string[] {
  const payable = payableCards(p).filter(c => valueOf(c) > 0);
  const bank = payable.filter(c => p.bank.includes(c)).sort((a, b) => valueOf(a) - valueOf(b));
  const props = payable.filter(c => !p.bank.includes(c)).sort((a, b) => {
    const fa = isComplete(p, getEffectiveColor(a)!) ? 1 : 0, fb = isComplete(p, getEffectiveColor(b)!) ? 1 : 0;
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

function PaymentPicker({ amount, title, payLabel, onPay, onProtego, onCancel, mustCover }: {
  amount: number;
  title: React.ReactNode;
  payLabel: (n: number) => string;
  onPay: (ids: string[]) => void;
  onProtego?: () => void;
  onCancel?: () => void;
  mustCover?: boolean; // Silencio needs the full 10G, debts accept "everything you have"
}) {
  const { me } = useGame();
  const [picked, setPicked] = useState<string[]>([]);
  if (!me) return null;
  const shield = shieldOf(me);
  const required = payableCards(me);
  const total = picked.reduce((n, id) => n + valueOf(id), 0);
  const coversAll = required.every(c => picked.includes(c.defId));
  const ok = total >= amount || (!mustCover && coversAll);
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

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
        {me.properties.length ? groupSets(me.properties).flatMap(g => g.cards.map(c => chip(c, g.color))) : <span className="hp-muted">None</span>}
      </div>
      <div className="hp-row">
        <b style={{ fontVariantNumeric: "tabular-nums" }}>Selected {total}G of {amount}G</b>
        <span className="hp-muted" style={{ fontSize: 12.5 }}>
          {nothing ? "You have nothing to pay with." : total > amount ? "Overpaying. No change is given." : !mustCover && total < amount ? "If you can't cover it, pick everything you have." : ""}
        </span>
        <span style={{ flex: 1 }} />
        {!nothing && <button className="hp-btn ghost" onClick={() => setPicked(cheapestPick(me, amount))}>Pick cheapest for me</button>}
        {onProtego && <button className="hp-btn ghost" onClick={onProtego}>🛡️ Protego</button>}
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
            text = r.outcome === "paid" ? `Paid ${r.amount}G` : r.outcome === "nothing" ? "Had nothing" : r.outcome === "shielded" ? "Shielded" : "Blocked";
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
    <button key={c.defId} className="hp-cardpick" aria-disabled={!enabled} disabled={!enabled} onClick={onClick} title={`${nameOf(c.defId)}, worth ${valueOf(c)}G`}>
      <GameCard defId={c.defId} size="sm" />
    </button>
  );

  const titles: Record<string, string> = {
    choose_steal: "Accio: pick a property to take. Complete sets are locked unless you're Draco.",
    choose_swap: own ? "Confundus: now pick the property you want in return." : "Confundus: first pick one of your properties to give away.",
    choose_steal_set: "Expelliarmus: pick a complete set to take.",
    choose_reducto: "Reducto: pick a property or bank card to destroy.",
    choose_silencio: "Silencio: pick who loses their role power.",
    choose_goblin: "Gringotts Goblin: pick who owes you 5G.",
  };

  return (
    <div className="hp-prompt alert" data-testid="target-prompt">
      <div className="head"><p><b>{titles[p.type] ?? `Choose a target for ${card}`}</b></p></div>

      {p.type === "choose_swap" && !own && (
        <div className="hp-row">{me.properties.map(c => cardButton(me, c, true, () => setOwn(c.defId)))}</div>
      )}

      {(p.type !== "choose_swap" || own) && others.map(o => {
        let body: React.ReactNode = null;
        if (p.type === "choose_steal" || p.type === "choose_swap") {
          body = o.properties.length ? o.properties.map(c => cardButton(o, c, canTake(me, o, c), () => pick(o.visitorId, c.defId, own ?? undefined))) : <span className="hp-muted">No properties</span>;
        } else if (p.type === "choose_reducto") {
          body = (
            <>
              {o.properties.map(c => cardButton(o, c, canTake(me, o, c), () => pick(o.visitorId, c.defId)))}
              {o.bank.map(c => cardButton(o, c, true, () => pick(o.visitorId, c.defId)))}
              {!o.properties.length && !o.bank.length && <span className="hp-muted">Nothing to destroy</span>}
            </>
          );
        } else if (p.type === "choose_steal_set") {
          const sets = COLORS.filter(c => isComplete(o, c) && shieldOf(o) !== c);
          body = sets.length ? sets.map(c => (
            <button key={c} className="hp-swatch-btn" onClick={() => pick(o.visitorId, c)}>
              <span className="sq" style={{ background: fillOf(c) }} />Take {label(c)}
            </button>
          )) : <span className="hp-muted">No complete sets you can take</span>;
        } else if (p.type === "choose_silencio") {
          body = <button className="hp-btn gold" disabled={o.isSilenced} onClick={() => pick(o.visitorId)}>{o.isSilenced ? "Already silenced" : `Silence ${o.animal.name}`}</button>;
        } else if (p.type === "choose_goblin") {
          body = <button className="hp-btn gold" onClick={() => pick(o.visitorId)}>Send to {o.animal.name} (bank {sumValue(o.bank)}G)</button>;
        }
        return (
          <div key={o.visitorId} className="hp-target">
            <div className="hp-row"><span>{o.animal.emoji}</span><b>{o.animal.name}</b><span className="hp-muted" style={{ fontSize: 12.5 }}>{o.role ? `· ${o.isSilenced ? "silenced" : CARD_DEF_MAP[`role_${o.role}`]?.name ?? o.role}` : ""}</span></div>
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

// ---------- the panel ----------

export function ActionPanel({ discardPicked, silencioOpen, setSilencioOpen }: {
  discardPicked: string[];
  silencioOpen: boolean;
  setSilencioOpen: (v: boolean) => void;
}) {
  const { s, me, current, isMyTurn, send } = useGame();
  const p = s.pendingAction;
  const meId = me?.visitorId ?? "";
  const mine = !!me && s.waitingOn === meId;
  const waitedOn = s.players.find(x => x.visitorId === s.waitingOn);
  const low = s.turnTimer <= 10;
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

  let mainButton: React.ReactNode = null;
  if (isMyTurn && !p && s.status === "playing" && !me?.isSleeping) {
    mainButton = !s.drawnThisTurn
      ? <button className="hp-btn gold big" onClick={() => send("draw_cards")} data-testid="button-draw">Draw {drawCount(me!)} cards</button>
      : <button className={`hp-btn big ${s.actionsUsed >= s.maxActions ? "gold" : "ghost"}`} onClick={() => send("end_turn")} disabled={!!s.freePlayCardId} data-testid="button-end-turn">End turn</button>;
  }

  // What I need to do right now
  let prompt: React.ReactNode = null;
  if (winner) {
    prompt = (
      <div className="hp-prompt win">
        <div style={{ fontSize: 40 }}>🏆</div>
        <h2 style={{ font: "800 24px var(--display)" }}>{winner.visitorId === meId ? "You win!" : `${winner.animal.name} wins!`}</h2>
        <p className="hp-muted" style={{ margin: 0 }}>Three complete sets. Head back to the start page to play again.</p>
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
        amount={10}
        mustCover
        title={<><b>Lift Silencio.</b> Pay 10G from your bank or properties. The cards are discarded and your role power comes back.</>}
        payLabel={n => `Pay ${n}G`}
        onPay={ids => { send("pay_silencio", { cardDefIds: ids }); setSilencioOpen(false); }}
        onCancel={() => setSilencioOpen(false)}
      />
    );
  } else if (p && mine && me) {
    const source = playerName(s, p.sourcePlayerId);
    switch (p.type) {
      case "pay_rent": case "pay_birthday": case "pay_debt": {
        const why = p.type === "pay_rent" ? `charged ${p.data?.rentColor ? label(p.data.rentColor) + " " : ""}rent`
          : p.type === "pay_birthday" ? "threw a Yule Ball" : "sent a Gringotts Goblin";
        prompt = (
          <>
            <PaymentPicker
              key={`${p.type}-${p.sourcePlayerId}-${p.cardDefId}`}
              amount={p.amount ?? 0}
              title={<><b>{source} {why}.</b> You owe {p.amount}G. Pick what to pay with{hasProtego(me) ? ", or block it with Protego" : ""}. Cards you give go to {source}.</>}
              payLabel={n => `Pay ${n}G`}
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
                ? <><b>{playerName(s, orig.targetPlayerId)} blocked your {what} with Protego.</b> Cast Protego back to push it through?</>
                : <><b>{source} {what}.</b> Block it with Protego?</>}</p>
              <button className="hp-btn ghost" onClick={() => send("decline_protego")}>{attacking ? "Let it go" : "Let it happen"}</button>
              <button className="hp-btn gold" onClick={() => send("play_protego")}>🛡️ Cast Protego</button>
            </div>
          </div>
        );
        break;
      }
      case "harry_protect": {
        const owned = groupSets(me.properties).map(g => g.color);
        prompt = (
          <div className="hp-prompt wait">
            <div className="head"><p><b>Harry's charm.</b> Shield one colour until your next turn. It can't be stolen or charged rent.</p></div>
            <div className="hp-row">
              {owned.map(c => (
                <button key={c} className="hp-swatch-btn" onClick={() => send("harry_protect_color", { color: c })}>
                  <span className="sq" style={{ background: fillOf(c) }} />Shield {label(c)}
                </button>
              ))}
              <button className="hp-btn ghost" onClick={() => send("harry_protect_color", {})}>{owned.length ? "No shield" : "Nothing to shield, end turn"}</button>
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
            <div className="head"><p><b>Time-Turner.</b> Take any card from the discard pile. You play it straight away, for free.</p><DiscardLink /></div>
            <div className="hp-row">
              {pile.map(c => (
                <button key={c.defId} className="hp-cardpick" onClick={() => send("time_turner_choose", { cardDefId: c.defId })} title={`${nameOf(c.defId)}: ${cardBlurb(c.defId)}`}>
                  <GameCard defId={c.defId} size="sm" />
                </button>
              ))}
              <button className="hp-btn ghost" onClick={() => send("cancel_action")}>Take the Time-Turner back</button>
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
          {!winner && <span className={`hp-timer ${low ? "low" : ""}`} style={{ fontSize: 22 }}>{timer}</span>}
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
    case "choose_steal": return `is using Accio on ${a.targetPlayerId === s.waitingOn ? "your" : target + "'s"} ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_swap": return `is using Confundus to swap ${nameOf(a.data?.ownCardDefId)} for ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_steal_set": return `is using Expelliarmus on the ${label(a.data?.color)} set`;
    case "choose_reducto": return `is using Reducto on ${nameOf(a.data?.targetCardDefId)}`;
    case "choose_silencio": return "is casting Silencio";
    case "pay_rent": return `charged ${a.amount}G rent`;
    case "pay_birthday": return "threw a Yule Ball (2G)";
    case "pay_debt": return "sent a Gringotts Goblin (5G)";
    default: return "action";
  }
}
