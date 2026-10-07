import { useContext, useState } from "react";
import { GameCard, RulesContext } from "@/components/GameCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGame } from "./context";
import { cardBlurb, nameOf, roleActive } from "./helpers";

/** A card with its name and what it does, for cards you can see but don't hold. */
export function CardInfo({ defId, tag }: { defId: string; tag?: string }) {
  const rules = useContext(RulesContext);
  return (
    <div className="hp-cardinfo">
      <GameCard defId={defId} size="sm" label={nameOf(defId)} />
      <div>
        <span className="nm"><strong>{nameOf(defId)}</strong>{tag && <span className="hp-chip gold">{tag}</span>}</span>
        <span>{cardBlurb(defId, rules)}</span>
      </div>
    </div>
  );
}

/** The face-up discard pile, top card first. Anyone can open it at any time. */
function DiscardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { s } = useGame();
  const pile = [...s.discardPile].reverse();
  const cedric = s.players.find(p => roleActive(p, "cedric"));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg hp-dialog">
        <DialogHeader>
          <DialogTitle>Discard pile · {pile.length} card{pile.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="hp-inspect">
          <div className="hp-muted" style={{ fontSize: 13 }}>
            Top of the pile first.
            {cedric ? ` ${cedric.animal.emoji} ${cedric.animal.name} is Cedric and can take the top 2 at the start of their turn.` : ""}
          </div>
          {pile.length === 0 && <span className="hp-muted">Nothing has been discarded yet.</span>}
          {pile.map((c, i) => (
            <CardInfo
              key={`${c.defId}-${i}`}
              defId={c.defId}
              tag={i === 0 ? "Top" : i === pile.length - 1 ? "Bottom" : undefined}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The discard pile on the table: the top card, which opens the full pile when tapped. */
export function DiscardPile() {
  const { s } = useGame();
  const [open, setOpen] = useState(false);
  const n = s.discardPile.length;
  const top = s.discardPile[n - 1];
  return (
    <>
      <button className="hp-cardpick hp-discard" onClick={() => setOpen(true)} aria-label={`Discard pile, ${n} cards. Open to see them all`}>
        {top ? <GameCard defId={top.defId} size="sm" /> : <div className="hp-pile empty">Discard<br />empty</div>}
        {n > 0 && <span className="hp-discard-n">{n}</span>}
      </button>
      <DiscardDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Phone version: the piles are hidden there, so a small link opens the pile instead. */
export function DiscardLink() {
  const { s } = useGame();
  const [open, setOpen] = useState(false);
  const n = s.discardPile.length;
  return (
    <>
      <button className="hp-linkbtn" onClick={() => setOpen(true)}>See the discard pile ({n})</button>
      <DiscardDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
