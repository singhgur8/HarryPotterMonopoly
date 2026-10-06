import { useState } from "react";
import type { PlayerState } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GameCard } from "@/components/GameCard";
import { useGame } from "./context";
import {
  groupSets, SET_SIZES, tileFill, valueOf, sumValue, label, fillOf, roleName, shieldOf, nameOf, otherColor, completeSets,
} from "./helpers";

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
                const title = other === "rainbow" ? "Polyjuice, any colour" : other ? `${label(color)} / ${label(other)} wild` : label(color);
                return (
                  <i key={c.defId} className="hp-tile" style={{ background: tileFill(c, color) }} title={`${title}, worth ${valueOf(c)}G`}>
                    <b>{valueOf(c)}</b>
                  </i>
                );
              })}
              {Array.from({ length: Math.max(0, size - cards.length) }, (_, i) => <i key={`e${i}`} className="hp-tile empty" />)}
            </span>
            <span>{cards.length}/{size}</span>
            {cards.length >= size && <span className="hp-lock">Locked</span>}
            {shield === color && <span className="hp-lock">Shield</span>}
            {wilds > 0 && cards.length < size && <span className="hp-muted" style={{ fontSize: 11 }}>{wilds} wild</span>}
          </div>
        );
      })}
    </div>
  );
}

export function OpponentSeat({ p, onOpen }: { p: PlayerState; onOpen: () => void }) {
  const { s } = useGame();
  const turn = s.players[s.currentTurnIndex]?.visitorId === p.visitorId;
  const waited = s.waitingOn === p.visitorId && !turn;
  const coins = [...p.bank].sort((a, b) => valueOf(b) - valueOf(a));
  const late = s.waitingOn === p.visitorId && s.turnTimer <= 0 && !p.isSleeping;
  return (
    <button className={`hp-opp ${turn ? "turn" : ""} ${!p.isConnected ? "away" : ""}`} onClick={onOpen} data-testid={`player-panel-${p.seatIndex}`} aria-label={`${p.animal.name}: open their table`}>
      <div className="hp-opp-top">
        <span className="hp-ava">{p.animal.emoji}</span>
        <span className="nm">{p.animal.name}</span>
        {p.role && <span className={`hp-role ${p.isSilenced ? "off" : ""}`} title={p.isSilenced ? "Silenced" : undefined}>{roleName(p.role).split(" ")[0]}</span>}
        {p.isSilenced && <span className="hp-chip late">Silenced</span>}
        {turn && <span className="hp-chip solid">Turn</span>}
        {waited && <span className="hp-chip gold">Deciding</span>}
        {late && <span className="hp-chip late">Out of time</span>}
        {p.isSleeping && <span className="hp-chip zz">💤 Bot playing</span>}
        {!p.isConnected && !p.isSleeping && <span className="hp-chip wait">Offline</span>}
        <span className="hand">Hand <b>{p.hand.length}</b></span>
      </div>
      <SetLines p={p} />
      <div className="hp-opp-bank">
        <span>Bank <b>{sumValue(p.bank)}G</b></span>
        <span className="hp-coins">{coins.map(c => <span key={c.defId} className="hp-cn">{valueOf(c)}</span>)}</span>
        <span className="worth">Sets {completeSets(p)}/3 · Property {sumValue(p.properties)}G</span>
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
                <div className="hp-muted" style={{ fontSize: 13 }}>
                  {roleName(shown.role)}{shown.isSilenced ? " (silenced)" : ""} · {shown.hand.length} cards in hand
                </div>
                {groupSets(shown.properties).map(({ color, cards }) => (
                  <div key={color} style={{ display: "grid", gap: 6 }}>
                    <div className="hp-label">{label(color)} · {cards.length}/{SET_SIZES[color]}</div>
                    <div className="cards">{cards.map(c => <GameCard key={c.defId} defId={c.defId} size="md" label={`${nameOf(c.defId)}, worth ${valueOf(c)}G`} />)}</div>
                  </div>
                ))}
                <div style={{ display: "grid", gap: 6 }}>
                  <div className="hp-label">Bank · {sumValue(shown.bank)}G</div>
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
