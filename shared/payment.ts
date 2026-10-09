/**
 * "Pick cheapest" for paying a charge, shared by the payment screen and the bots.
 */

export interface PayOption {
  id: string;
  value: number;
  /** How much the player would rather keep this card: bank 0, loose property 1, card from a full set 2. */
  keep: number;
}

/**
 * The cards that cover `amount` with the smallest total (there's no change),
 * then the ones the player minds losing least, then the fewest cards.
 * Returns null when everything together still doesn't cover it.
 */
export function cheapestCover(options: PayOption[], amount: number): string[] | null {
  const cards = options.filter(o => o.value > 0);
  const max = cards.reduce((n, o) => n + o.value, 0);
  if (max < amount) return null;
  if (amount <= 0) return [];
  // best[t]: the least painful way to pick cards adding up to exactly t
  type Pick = { keep: number; count: number; ids: string[] };
  const best: (Pick | undefined)[] = new Array(max + 1);
  best[0] = { keep: 0, count: 0, ids: [] };
  const better = (a: Pick, b?: Pick) => !b || a.keep < b.keep || (a.keep === b.keep && a.count < b.count);
  // Weight full-set cards far above the rest so breaking a set is a last resort
  const weight = (o: PayOption) => (o.keep >= 2 ? 1000 : o.keep);
  for (const c of cards) {
    for (let t = max; t >= c.value; t--) {
      const from = best[t - c.value];
      if (!from) continue;
      const next = { keep: from.keep + weight(c), count: from.count + 1, ids: [...from.ids, c.id] };
      if (better(next, best[t])) best[t] = next;
    }
  }
  for (let t = amount; t <= max; t++) if (best[t]) return best[t]!.ids;
  return null;
}
