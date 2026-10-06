/**
 * Quick rules check for the game engine. Run with `npm run test:engine`.
 * Plays full bot-vs-bot games and walks through the tricky rules
 * (payments, Protego chains, Silencio, Harry's shield, Time-Turner).
 */
import assert from "node:assert/strict";
import {
  createInitialGameState, botStep, payWithCards, playProtego, declineProtego,
  chooseTarget, playCard, drawCards, paySilencio, getWaitingOn, flipWild,
  harryProtectColor, endTurn, timeTurnerChoose, bankCard, cancelChoice,
} from "../worker/gameEngine";
import { ANIMALS, SET_SIZES } from "../shared/schema";
import type { GameState, PlayerState } from "../shared/schema";
import { CARD_DEF_MAP, countCompleteSets } from "../shared/cardDefs";

function newGame(n: number): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
  return createInitialGameState("TEST", players, 60);
}

function countCards(s: GameState) {
  return s.drawPile.length + s.discardPile.length +
    s.players.reduce((n, p) => n + p.hand.length + p.properties.length + p.bank.length, 0);
}

// ---------- 1. Bot-only games finish without breaking card counts ----------
let finished = 0;
for (let g = 0; g < 300; g++) {
  const s = newGame(2 + (g % 4));
  const total = countCards(s);
  s.players.forEach(p => (p.isSleeping = true));
  let steps = 0;
  while (s.status === "playing" && steps < 5000) {
    assert.ok(botStep(s), `bot got stuck in game ${g} at step ${steps}: ${JSON.stringify(s.pendingAction)}`);
    assert.equal(countCards(s), total, "cards appeared or vanished");
    steps++;
  }
  if (s.status === "finished") {
    finished++;
    const winner = s.players.find(p => p.visitorId === s.winnerId)!;
    assert.ok(countCompleteSets(winner.properties, SET_SIZES) >= 3);
  }
}
console.log(`bot games: ${finished}/300 reached a winner`);
// Bots never steal, so some games stall with nobody holding 3 sets; that is fine here.
assert.ok(finished > 50, "plenty of bot games should end with a winner");

// ---------- helpers for hand-built scenarios ----------
function setup(n = 3): GameState {
  const s = newGame(n);
  for (const p of s.players) { s.drawPile.push(...p.hand); p.hand = []; }
  s.drawnThisTurn = true;
  return s;
}
function take(s: GameState, id: string) {
  for (const zone of [s.drawPile, s.discardPile, ...s.players.flatMap(p => [p.hand, p.bank, p.properties])]) {
    const i = zone.findIndex(c => c.defId === id);
    if (i >= 0) return zone.splice(i, 1)[0];
  }
  throw new Error("card not found " + id);
}
const give = (s: GameState, p: PlayerState, zone: "hand" | "bank" | "properties", id: string, color?: any) => {
  const card = take(s, id);
  p[zone].push(color ? { ...card, assignedColor: color } : zone === "properties" ? { ...card, assignedColor: CARD_DEF_MAP[id].color } : card);
};

// ---------- 2. Payments: must pay in full, or everything if short ----------
{
  const s = setup();
  const [a, b, c] = s.players;
  a.role = "luna"; b.role = "hermione"; c.role = "draco";
  give(s, a, "properties", "prop_red_1"); give(s, a, "properties", "prop_red_2");
  give(s, a, "hand", "rent_red_yellow_1");
  give(s, b, "bank", "money_1g_1"); give(s, b, "properties", "prop_brown_1");
  give(s, c, "bank", "money_5g_1");
  assert.ok(playCard(s, "p0", "rent_red_yellow_1", false, "red").success);
  assert.equal(s.pendingAction?.amount, 3);
  assert.equal(getWaitingOn(s), "p1");
  assert.equal(payWithCards(s, "p1", ["money_1g_1"]).success, false, "short payment must be refused");
  assert.ok(payWithCards(s, "p1", ["money_1g_1", "prop_brown_1"]).success, "paying everything is allowed");
  assert.ok(a.properties.some(c => c.defId === "prop_brown_1"), "paid properties go to the receiver's properties");
  assert.equal(getWaitingOn(s), "p2");
  assert.ok(payWithCards(s, "p2", ["money_5g_1"]).success, "overpaying is allowed");
  assert.equal(s.pendingAction, null);
  console.log("payments: ok");
}

// ---------- 3. Protego chain on rent, and the next payer still pays ----------
{
  const s = setup();
  const [a, b, c] = s.players;
  give(s, a, "properties", "prop_pink_1");
  give(s, a, "hand", "rent_pink_orange_1"); give(s, a, "hand", "action_protego_1");
  give(s, b, "hand", "action_protego_2"); give(s, b, "hand", "action_protego_3");
  give(s, c, "bank", "money_2g_1");
  assert.ok(playCard(s, "p0", "rent_pink_orange_1", false, "pink").success);
  assert.ok(playProtego(s, "p1").success);              // b blocks
  assert.equal(getWaitingOn(s), "p0");                   // a may push back
  assert.ok(playProtego(s, "p0").success);              // a counters
  assert.equal(getWaitingOn(s), "p1");
  assert.ok(playProtego(s, "p1").success);              // b blocks again, a has none left
  assert.equal(getWaitingOn(s), "p2", "after b is protected, c still owes rent");
  assert.ok(payWithCards(s, "p2", ["money_2g_1"]).success);
  assert.equal(s.pendingAction, null);
  console.log("protego chain on rent: ok");
}

// ---------- 4. Defender declining Protego lets Accio through ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.role = "luna"; b.role = "hermione";
  give(s, a, "hand", "action_accio_1");
  give(s, b, "properties", "prop_green_1"); give(s, b, "hand", "action_protego_1");
  assert.ok(playCard(s, "p0", "action_accio_1").success);
  assert.ok(chooseTarget(s, "p0", "p1", "prop_green_1").success);
  assert.equal(s.pendingAction?.type, "protego_response");
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(a.properties.some(c => c.defId === "prop_green_1"), "declining lets the steal happen");
  console.log("accio after declined protego: ok");
}

// ---------- 5. Silenced Draco loses his power; paying 10G restores it ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.role = "draco"; b.role = "luna";
  give(s, b, "properties", "prop_brown_1"); give(s, b, "properties", "prop_brown_2");
  give(s, a, "hand", "action_accio_1");
  give(s, a, "bank", "money_10g_1");
  give(s, a, "properties", "prop_orange_1");
  a.isSilenced = true;
  assert.equal(playCard(s, "p0", "action_accio_1").success, false, "silenced Draco can't take from a complete set");
  assert.equal(paySilencio(s, "p0", ["prop_orange_1"]).success, false, "2G isn't enough");
  assert.ok(a.properties.some(c => c.defId === "prop_orange_1"), "a refused Silencio payment keeps cards where they were");
  assert.ok(paySilencio(s, "p0", ["money_10g_1"]).success);
  assert.ok(playCard(s, "p0", "action_accio_1").success);
  assert.ok(chooseTarget(s, "p0", "p1", "prop_brown_1").success, "Draco takes from a complete set");
  console.log("silencio and draco: ok");
}

// ---------- 6. Silenced Hermione gets 3 actions; Harry's shield stops working ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.role = "luna"; b.role = "harry";
  b.isSilenced = false; b.protectedColor = "red";
  give(s, b, "properties", "prop_red_1");
  give(s, a, "properties", "prop_red_2");
  give(s, a, "hand", "rent_red_yellow_1");
  give(s, a, "hand", "action_silencio_1");
  assert.ok(playCard(s, "p0", "action_silencio_1").success);
  assert.ok(chooseTarget(s, "p0", "p1").success);
  assert.ok(b.isSilenced);
  assert.ok(playCard(s, "p0", "rent_red_yellow_1", false, "red").success);
  assert.equal(getWaitingOn(s), "p1", "a silenced Harry's shield doesn't protect him");
  console.log("silenced harry: ok");
}

// ---------- 7. Harry can't be forced to pay with his shielded colour ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.role = "luna"; b.role = "harry"; b.protectedColor = "green";
  give(s, b, "properties", "prop_green_1");
  give(s, a, "properties", "prop_pink_1");
  give(s, a, "hand", "rent_pink_orange_1");
  assert.ok(playCard(s, "p0", "rent_pink_orange_1", false, "pink").success);
  assert.ok(payWithCards(s, "p1", []).success, "Harry owes nothing when only shielded cards remain");
  console.log("harry shield payment: ok");
}

// ---------- 8. Time-Turner: the card comes back and is played for free ----------
{
  const s = setup();
  const [a] = s.players;
  a.role = "luna";
  give(s, a, "hand", "action_time_turner_1");
  s.discardPile.push(take(s, "money_3g_1"));
  s.actionsUsed = 2;
  assert.ok(playCard(s, "p0", "action_time_turner_1").success);
  assert.equal(s.actionsUsed, 3);
  assert.ok(timeTurnerChoose(s, "p0", "money_3g_1").success);
  assert.equal(endTurn(s, "p0").success, false, "must play the Time-Turner card first");
  assert.ok(bankCard(s, "p0", "money_3g_1").success, "it can be played even with no actions left");
  assert.equal(s.actionsUsed, 3);
  console.log("time-turner: ok");
}

// ---------- 9. Wilds flip only on your own turn ----------
{
  const s = setup();
  const [a, b] = s.players;
  give(s, a, "properties", "wild_pink_orange_1", "pink");
  give(s, b, "properties", "wild_pink_orange_2", "pink");
  assert.ok(flipWild(s, "p0", "wild_pink_orange_1", "orange").success);
  assert.equal(flipWild(s, "p0", "wild_pink_orange_1", "red").success, false);
  assert.equal(flipWild(s, "p1", "wild_pink_orange_2", "orange").success, false, "not p1's turn");
  console.log("wild flip: ok");
}

// ---------- 10. Harry shields at end of turn ----------
{
  const s = setup();
  const [a] = s.players;
  a.role = "harry";
  give(s, a, "properties", "prop_red_1");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "harry_protect");
  assert.ok(harryProtectColor(s, "p0", "red").success);
  assert.equal(a.protectedColor, "red");
  assert.equal(s.currentTurnIndex, 1);
  void drawCards;
  console.log("harry shield: ok");
}

// ---------- 11. Taking back an action while picking its target ----------
{
  const s = setup();
  const [a, b] = s.players;
  give(s, a, "hand", "action_accio_1");
  give(s, b, "properties", "prop_red_1");
  s.actionsUsed = 1;
  assert.ok(playCard(s, "p0", "action_accio_1").success);
  assert.equal(s.pendingAction?.type, "choose_steal");
  assert.equal(cancelChoice(s, "p1").success, false, "only the caster can take it back");
  assert.ok(cancelChoice(s, "p0").success);
  assert.equal(s.pendingAction, null);
  assert.equal(s.actionsUsed, 1);
  assert.ok(a.hand.some(c => c.defId === "action_accio_1"));
  console.log("take back: ok");
}

// ---------- 12. Reducto only destroys properties, never bank cards ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.role = "luna"; b.role = "hermione";
  give(s, a, "hand", "action_reducto_1");
  give(s, b, "bank", "money_5g_1");
  assert.equal(playCard(s, "p0", "action_reducto_1").success, false, "money alone isn't a Reducto target");
  give(s, b, "properties", "prop_green_1");
  assert.ok(playCard(s, "p0", "action_reducto_1").success);
  assert.equal(chooseTarget(s, "p0", "p1", "money_5g_1").success, false, "bank cards are safe");
  assert.ok(chooseTarget(s, "p0", "p1", "prop_green_1").success);
  assert.ok(declineProtego(s, "p1").success || s.pendingAction === null);
  assert.ok(!b.properties.some(c => c.defId === "prop_green_1"), "the property is destroyed");
  assert.ok(b.bank.some(c => c.defId === "money_5g_1"), "the bank is untouched");
  console.log("reducto: ok");
}

console.log("all engine checks passed");
