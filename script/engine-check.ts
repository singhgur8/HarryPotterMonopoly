/**
 * Quick rules check for the game engine. Run with `npm run test:engine`.
 * Plays full bot-vs-bot games and walks through the tricky rules
 * (payments, Protego chains, Silencio, Harry's shield, Time-Turner).
 */
import { cheapestCover } from "../shared/payment";
import assert from "node:assert/strict";
import {
  createInitialGameState, botStep, payWithCards, playProtego, declineProtego,
  chooseTarget, playCard, drawCards, paySilencio, getWaitingOn, flipWild,
  harryProtectColor, endTurn, luchaChoose, roleActive, timeTurnerChoose, bankCard, cancelChoice, cedricChooseSource, wakeUp, forfeit, autoDraw,
  sleepForDisconnect, settleWilds, playChargeback, playReverse, tharkiShortcutColor, kanjarChooseFriend, calculateRent,
  vegasGamble, guessCard, guessKindOf,
} from "../worker/gameEngine";
import { ANIMALS, SET_SIZES, DRAW_SECONDS, inDrawStep, freshTurnTimer, PLAYS_USED_UP_SECONDS } from "../shared/schema";
import type { GameState, PlayerState, RoleType } from "../shared/schema";
import { CARD_DEF_MAP, countCompleteSets, roleDef } from "../shared/cardDefs";
import { VARIATIONS, ACTION_CHOICES, DEFAULT_CUSTOM_RULES, ALL_ROLES, updateCustomRules, customFrom, customDeck, gameSetup } from "../shared/variations";

function newGame(n: number): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
  return createInitialGameState("TEST", players, 60);
}

function countCards(s: GameState) {
  return s.drawPile.length + s.discardPile.length + (s.poker?.pot.length ?? 0) +
    s.players.reduce((n, p) => n + p.hand.length + p.properties.length + p.bank.length, 0);
}

// ---------- 1. Bot-only games finish without breaking card counts ----------
let finished = 0;
for (let g = 0; g < 300; g++) {
  const s = newGame(2 + (g % 4));
  const total = countCards(s);
  // Half the games use practice bots, which also charge rent and play Protego
  s.players.forEach(p => { p.isSleeping = true; p.isBot = g % 2 === 1; });
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
  a.roles = ["luna"]; b.roles = ["hermione"]; c.roles = ["draco"];
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
  assert.ok(playProtego(s, "p1").success);              // b blocks again
  assert.equal(getWaitingOn(s), "p0", "a is still asked, though it has no Just Say No left");
  assert.equal(playProtego(s, "p0").success, false, "a can't block without the card");
  assert.ok(declineProtego(s, "p0").success);           // a lets it go
  assert.equal(getWaitingOn(s), "p2", "after b is protected, c still owes rent");
  assert.ok(payWithCards(s, "p2", ["money_2g_1"]).success);
  assert.equal(s.pendingAction, null);
  console.log("protego chain on rent: ok");
}

// ---------- 3b. The target is asked even without a Just Say No ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["hermione"];
  give(s, a, "hand", "action_accio_1");
  give(s, b, "properties", "prop_green_1");
  assert.ok(playCard(s, "p0", "action_accio_1").success);
  assert.ok(chooseTarget(s, "p0", "p1", "prop_green_1").success);
  assert.equal(s.pendingAction?.type, "protego_response", "the steal waits for the target's answer");
  assert.equal(getWaitingOn(s), "p1");
  assert.ok(!a.properties.some(c => c.defId === "prop_green_1"), "nothing is taken before they answer");
  assert.equal(playProtego(s, "p1").success, false, "no Just Say No, no block");
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(a.properties.some(c => c.defId === "prop_green_1"), "allowing lets the steal happen");
  console.log("target always asked: ok");
}

// ---------- 4. Defender declining Protego lets Accio through ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["hermione"];
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
  a.roles = ["draco"]; b.roles = ["luna"];
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
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(a.properties.some(c => c.defId === "prop_brown_1"));
  console.log("silencio and draco: ok");
}

// ---------- 5b. Power Outage is paid off only on your own turn, after drawing, and isn't a play ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["hermione"];
  b.isSilenced = true;
  give(s, b, "bank", "money_10g_1");
  assert.equal(paySilencio(s, "p1", ["money_10g_1"]).success, false, "can't pay on someone else's turn");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.currentTurnIndex, 1);
  assert.equal(s.maxActions, 3, "a powered-out Hermione starts with 3 plays");
  assert.equal(paySilencio(s, "p1", ["money_10g_1"]).success, false, "can't pay before drawing");
  assert.ok(drawCards(s, "p1").success);
  assert.ok(paySilencio(s, "p1", ["money_10g_1"]).success);
  assert.equal(b.isSilenced, false);
  assert.equal(s.actionsUsed, 0, "paying isn't one of the plays");
  assert.equal(s.maxActions, 4, "Hermione's extra play comes back straight away");

  // A powered-out Cedric draws from the deck with no discard choice, even if he pays later that turn
  const c = setup();
  const [, ced] = c.players;
  c.players[0].roles = ["luna"]; ced.roles = ["cedric"]; ced.isSilenced = true;
  c.discardPile.push(take(c, "prop_red_1"));
  assert.ok(endTurn(c, "p0").success);
  assert.notEqual(c.pendingAction?.type, "cedric_draw_choice");

  // A practice bot pays it off with bank money after drawing; a sleeping person's bot never does
  for (const isBot of [true, false]) {
    const t = setup();
    const [, y] = t.players;
    t.players[0].roles = ["luna"]; y.roles = ["luna"];
    y.isSilenced = true; y.isSleeping = true; y.isBot = isBot;
    give(t, y, "bank", "money_10g_1");
    assert.ok(endTurn(t, "p0").success);
    assert.ok(botStep(t), "bot draws");
    botStep(t);
    assert.equal(y.isSilenced, !isBot, isBot ? "practice bot pays" : "sleeping player keeps their money");
  }
  console.log("power outage timing: ok");
}

// ---------- 6. Silenced Hermione gets 3 actions; Harry's shield stops working ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["harry"];
  b.isSilenced = false; b.protectedColor = "red";
  give(s, b, "properties", "prop_red_1");
  give(s, a, "properties", "prop_red_2");
  give(s, a, "hand", "rent_red_yellow_1");
  give(s, a, "hand", "action_silencio_1");
  assert.ok(playCard(s, "p0", "action_silencio_1").success);
  assert.ok(chooseTarget(s, "p0", "p1").success);
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(b.isSilenced);
  assert.ok(playCard(s, "p0", "rent_red_yellow_1", false, "red").success);
  assert.equal(getWaitingOn(s), "p1", "a silenced Harry's shield doesn't protect him");
  console.log("silenced harry: ok");
}

// ---------- 7. Harry can't be forced to pay with his shielded colour ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["harry"]; b.protectedColor = "green";
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
  a.roles = ["luna"];
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
  const s = setup(2);
  const [a] = s.players;
  a.roles = ["harry"];
  give(s, a, "properties", "prop_red_1");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "harry_protect");
  assert.ok(harryProtectColor(s, "p0", "red").success);
  assert.equal(a.protectedColor, "red");
  assert.equal(s.currentTurnIndex, 1);
  // The shield stays through his next turn and is kept unless he moves it
  give(s, a, "properties", "prop_darkblue_1");
  s.players[1].roles = ["luna"]; s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p1").success);
  assert.equal(s.currentTurnIndex, 0);
  assert.equal(a.protectedColor, "red", "shield survives into his next turn");
  s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(harryProtectColor(s, "p0").success, "no answer keeps the shield");
  assert.equal(a.protectedColor, "red");
  s.currentTurnIndex = 0; s.drawnThisTurn = true; s.pendingAction = null;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(harryProtectColor(s, "p0", "dark_blue").success);
  assert.equal(a.protectedColor, "dark_blue", "moved");
  s.currentTurnIndex = 0; s.drawnThisTurn = true; s.pendingAction = null;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(harryProtectColor(s, "p0", null).success);
  assert.equal(a.protectedColor, undefined, "dropped");
  // Only colours on his table: not one he has never had
  s.currentTurnIndex = 0; s.drawnThisTurn = true; s.pendingAction = null;
  assert.ok(endTurn(s, "p0").success);
  assert.equal(harryProtectColor(s, "p0", "green").success, false, "no green on his table");
  // A shield left on a colour he no longer has comes off when he keeps it
  a.protectedColor = "green";
  assert.ok(harryProtectColor(s, "p0").success);
  assert.equal(a.protectedColor, undefined, "nothing to guard on green");
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

// ---------- 12. Cedric takes the top 2 of the discard pile, and the log names them ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["cedric"]; // a fixed role so Harry's end-of-turn shield never gets in the way
  give(s, b, "hand", "money_1g_1");
  s.discardPile.push(take(s, "prop_red_1"), take(s, "action_accio_1"), take(s, "money_5g_1"));
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "cedric_draw_choice");
  assert.ok(cedricChooseSource(s, "p1", "discard").success);
  assert.deepEqual(b.hand.map(c => c.defId), ["money_1g_1", "money_5g_1", "action_accio_1"]);
  assert.deepEqual(s.discardPile.map(c => c.defId), ["prop_red_1"]);
  const line = s.eventLog[s.eventLog.length - 1].message;
  assert.ok(line.includes(CARD_DEF_MAP.money_5g_1.name) && line.includes(CARD_DEF_MAP.action_accio_1.name), line);
  void a;
  console.log("cedric discard draw: ok");
}

// ---------- 13. Reducto only destroys properties, never bank cards ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["hermione"];
  give(s, a, "hand", "action_reducto_1");
  give(s, b, "bank", "money_5g_1");
  assert.equal(playCard(s, "p0", "action_reducto_1").success, false, "money alone isn't a Reducto target");
  give(s, b, "properties", "prop_green_1");
  assert.ok(playCard(s, "p0", "action_reducto_1").success);
  assert.equal(chooseTarget(s, "p0", "p1", "money_5g_1").success, false, "bank cards are safe");
  assert.ok(chooseTarget(s, "p0", "p1", "prop_green_1").success);
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(!b.properties.some(c => c.defId === "prop_green_1"), "the property is destroyed");
  assert.ok(b.bank.some(c => c.defId === "money_5g_1"), "the bank is untouched");
  console.log("reducto: ok");
}

// ---------- 14. Practice bots charge rent, and block with Protego ----------
{
  const s = setup();
  const [a, b] = s.players;
  s.currentTurnIndex = 1;
  b.isBot = b.isSleeping = true;
  give(s, b, "properties", "prop_red_1");
  give(s, b, "hand", "rent_red_yellow_1");
  give(s, a, "bank", "money_5g_1");
  assert.ok(botStep(s));
  assert.equal(s.pendingAction?.type, "pay_rent", "bot charges rent for its red property");
  assert.ok(wakeUp(s, "p1").success);
  assert.ok(b.isSleeping, "a practice bot never wakes up");

  const t = setup();
  const [x, y] = t.players;
  y.isBot = y.isSleeping = true;
  give(t, x, "hand", "action_goblin_1");
  give(t, y, "hand", "action_protego_1");
  t.actionsUsed = 0;
  assert.ok(playCard(t, "p0", "action_goblin_1").success);
  assert.ok(chooseTarget(t, "p0", "p1").success);
  assert.ok(botStep(t));
  assert.ok(!y.hand.some(c => c.defId === "action_protego_1"), "bot used its Protego");
  console.log("practice bots: ok");
}

// ---------- Game versions: each deals its own roles and deck ----------
{
  const players = Array.from({ length: 5 }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
  for (const version of Object.values(VARIATIONS)) {
    const v = { ...version, ...gameSetup(version.id), id: version.id }; // Custom's deck and roles come from its default rules
    for (const id of v.deck) assert.ok(CARD_DEF_MAP[id] && CARD_DEF_MAP[id].type !== "role", `${v.id} deck has a bad card ${id}`);
    for (const r of v.roles) assert.equal(roleDef(r)?.roleType, r, `${v.id} role ${r} needs a role_${r} card`);
    assert.equal(new Set(v.deck).size, v.deck.length, `${v.id} deck lists a card id twice`);

    let wins = 0;
    for (let g = 0; g < 40; g++) {
      const s = createInitialGameState("TEST", players.slice(0, 2 + (g % 4)), 60, v.id);
      assert.equal(s.variation, v.id);
      assert.equal(countCards(s), v.deck.length);
      assert.ok(s.players.every(p => v.roles.length === 0 ? p.roles.length === 0 : p.roles.length === 1 && v.roles.includes(p.roles[0])), `${v.id} dealt a role from another version`);
      s.players.forEach(p => { p.isSleeping = true; p.isBot = true; });
      let steps = 0;
      while (s.status === "playing" && steps < 5000) { assert.ok(botStep(s)); steps++; }
      if (s.status === "finished") wins++;
    }
    assert.ok(wins > 5, `${v.id} bot games should reach a winner`);
  }
  // No version given (older saves) means classic
  assert.equal(newGame(2).variation, "classic");
  console.log("game versions: ok");
}

// ---------- Custom games: chosen cards, chosen roles, several roles each ----------
{
  const players = Array.from({ length: 4 }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
  const all = Object.fromEntries(ACTION_CHOICES.map(a => [a.type, 2]));
  const sorted = (d: string[]) => [...d].sort();

  // Every template plays exactly like its version; the default is Classic Harry Potter
  for (const id of ["deal", "prime", "classic", "gg"] as const) {
    const t = customFrom(id);
    assert.deepEqual(sorted(customDeck(t)), sorted(VARIATIONS[id].deck), `${id} template deck`);
    assert.deepEqual(t.roles, VARIATIONS[id].roles);
    assert.deepEqual(gameSetup("custom", t).rules.wildRentOneTarget, VARIATIONS[id].rules?.wildRentOneTarget);
  }
  assert.deepEqual(DEFAULT_CUSTOM_RULES, customFrom("classic"));

  // Card counts: more copies than any deck has get their own ids
  const many = updateCustomRules(DEFAULT_CUSTOM_RULES, { counts: { accio: 7, money_10: 4, protego: 0, nope: 3, yule_ball: 99 } });
  const deck = customDeck(many);
  const n = (t: string) => deck.filter(id => CARD_DEF_MAP[id].actionType === t).length;
  assert.equal(n("accio"), 7);
  assert.equal(n("protego"), 0);
  assert.equal(n("yule_ball"), 10, "capped at 10");
  assert.equal(deck.filter(id => CARD_DEF_MAP[id].type === "money" && CARD_DEF_MAP[id].value === 10).length, 4);
  assert.equal(new Set(deck).size, deck.length, "every card id is different");
  assert.equal(updateCustomRules(DEFAULT_CUSTOM_RULES, { countKey: "reverse", count: 2 }).counts.reverse, 2, "one count per message");

  // Random, 3 roles each, all different within a player
  const r = createInitialGameState("TEST", players, 60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "ganda", "lucha"], rolesPerPlayer: 3 });
  for (const p of r.players) {
    assert.equal(p.roles.length, 3);
    assert.equal(new Set(p.roles).size, 3);
    assert.ok(p.roles.every(x => ["harry", "luna", "ganda", "lucha"].includes(x)));
  }

  // Players choose: their own picks (duplicates across players fine), the rest dealt; bots dealt
  const picks = [["harry", "luna", "draco"], [], ["harry", "luna"]] as RoleType[][];
  const c = createInitialGameState("TEST",
    [...players.slice(0, 3).map((p, i) => ({ ...p, pickedRoles: picks[i] })), { ...players[3], isBot: true }],
    60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "cedric", "hermione"], roleMode: "choose", rolesPerPlayer: 2 });
  assert.deepEqual(c.players[0].roles, ["harry", "luna"], "draco isn't in play");
  assert.equal(c.players[1].roles.length, 2, "no picks: dealt at random");
  assert.deepEqual(c.players[2].roles, ["harry", "luna"], "the same roles as another player");
  assert.equal(c.players[3].roles.length, 2);
  const same3 = createInitialGameState("TEST", players.slice(0, 3).map(p => ({ ...p, pickedRoles: ["harry", "luna", "cedric"] as RoleType[] })),
    60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "cedric", "hermione"], roleMode: "choose", rolesPerPlayer: 3 });
  assert.ok(same3.players.every(p => p.roles.join() === "harry,luna,cedric"), "everyone can pick the same three");
  const halfPicked = createInitialGameState("TEST", [{ ...players[0], pickedRoles: ["harry"] as RoleType[] }, players[1]],
    60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "cedric"], roleMode: "choose", rolesPerPlayer: 2 });
  assert.equal(halfPicked.players[0].roles[0], "harry");
  assert.equal(new Set(halfPicked.players[0].roles).size, 2, "filled with a different role");

  // Who goes first
  assert.equal(createInitialGameState("TEST", players, 60, "classic", undefined, "first").currentTurnIndex, 0);
  const starts = new Set(Array.from({ length: 60 }, () => createInitialGameState("TEST", players, 60, "classic", undefined, "random").currentTurnIndex));
  assert.ok(starts.size > 1, "random start varies");

  // Sets to win
  const w = createInitialGameState("TEST", players.slice(0, 2), 60, "custom", { ...DEFAULT_CUSTOM_RULES, setsToWin: 1 });
  assert.equal(w.rules?.setsToWin, 1);

  // Two roles at once: Luna draws 3 and Hermione gets 4 plays
  const both = c.players[2];
  c.currentTurnIndex = 2;
  c.drawnThisTurn = false;
  c.pendingAction = null;
  const before = both.hand.length;
  assert.ok(drawCards(c, "p2").success || cedricChooseSource(c, "p2", "deck").success);
  assert.ok(both.hand.length > before);

  // Bots play every action card in a full custom game
  let wins = 0;
  for (let g = 0; g < 40; g++) {
    const s = createInitialGameState("TEST", players.slice(0, 2 + (g % 3)), 60, "custom", { ...DEFAULT_CUSTOM_RULES, counts: { ...DEFAULT_CUSTOM_RULES.counts, ...all }, roles: ALL_ROLES, rolesPerPlayer: 2 });
    const total = countCards(s);
    s.players.forEach(p => { p.isSleeping = true; p.isBot = true; });
    let steps = 0;
    while (s.status === "playing" && steps < 5000) { assert.ok(botStep(s)); assert.equal(countCards(s), total); steps++; }
    if (s.status === "finished") wins++;
  }
  assert.ok(wins > 5, "custom bot games should reach a winner");

  // Host settings are cleaned up
  const u = updateCustomRules(DEFAULT_CUSTOM_RULES, { roles: ["luna", "nobody"], actions: ["double_rent", "x"], rolesPerPlayer: 9, roleMode: "bad", setsToWin: 40, template: "custom" });
  assert.deepEqual(u.roles, ["luna"]);
  assert.equal(u.counts.double_rent, 2, "older saves listed action cards in play");
  assert.equal(u.counts.accio, 0);
  assert.equal(u.rolesPerPlayer, 1);
  assert.equal(u.roleMode, "random");
  assert.equal(u.setsToWin, 6);
  assert.equal(u.template, "classic");
  const g = updateCustomRules(u, { useTemplate: "gg", setsToWin: 2 });
  assert.deepEqual(g.roles, VARIATIONS.gg.roles);
  assert.equal(g.setsToWin, 2);
  console.log("custom games: ok");
}

// ---------- Ganda: draw from the deck or take a random card from someone's hand ----------
{
  const s = setup(3);
  const [a, b, c] = s.players;
  a.roles = []; b.roles = ["ganda"]; c.roles = [];
  give(s, a, "hand", "money_1g_1"); give(s, a, "hand", "money_2g_1");
  give(s, b, "hand", "money_3g_1");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "cedric_draw_choice");
  assert.deepEqual(s.pendingAction?.data, { discard: false, opponent: true });
  assert.equal(cedricChooseSource(s, "p1", "opponent", "p2").success, false, "p2 has no cards");
  assert.equal(s.pendingAction?.type, "cedric_draw_choice", "a bad pick keeps the choice open");
  assert.ok(cedricChooseSource(s, "p1", "opponent", "p0").success);
  assert.equal(a.hand.length, 1);
  assert.equal(b.hand.length, 2);
  assert.ok(s.drawnThisTurn);
  console.log("ganda: ok");
}

// ---------- Lucha: copies someone's power at the end of each turn ----------
{
  const s = setup(3);
  const [a, b, c] = s.players;
  a.roles = ["lucha"]; b.roles = ["hermione"]; c.roles = ["luna"];
  give(s, a, "hand", "money_1g_1");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "lucha_choose");
  assert.ok(luchaChoose(s, "p0", "p1").success);
  assert.deepEqual(a.borrowedRoles, ["hermione"]);
  // Next time round, p1 can't be picked again
  s.currentTurnIndex = 0; s.pendingAction = null; s.drawnThisTurn = true;
  assert.ok(roleActive(a, "hermione"), "Lucha has Hermione's power now");
  assert.ok(!roleActive(a, "luna"));
  assert.ok(endTurn(s, "p0").success);
  assert.equal(luchaChoose(s, "p0", "p1").success, false, "can't copy the same player twice in a row");
  assert.ok(luchaChoose(s, "p0", "p2").success);
  assert.ok(roleActive(a, "luna") && !roleActive(a, "hermione"));
  // One on one: the same player every time is fine
  const d = setup(2);
  d.players[0].roles = ["lucha"]; d.players[1].roles = ["harry"];
  for (let i = 0; i < 2; i++) {
    d.currentTurnIndex = 0; d.pendingAction = null; d.drawnThisTurn = true;
    assert.ok(endTurn(d, "p0").success);
    assert.ok(luchaChoose(d, "p0", "p1").success);
    // Copying Harry: Lucha gets the end-of-turn shield too
    assert.equal(d.pendingAction?.type, "harry_protect");
    assert.ok(harryProtectColor(d, "p0").success);
  }
  // Silenced Lucha has no copied power either
  a.isSilenced = true;
  assert.ok(!roleActive(a, "luna"));
  console.log("lucha: ok");
}

// ---------- Lucha copies ONE power, even from someone with several ----------
{
  const s = setup(3);
  const [a, b] = s.players;
  a.roles = ["lucha"]; b.roles = ["harry", "hermione", "luna"]; s.players[2].roles = [];
  assert.ok(endTurn(s, "p0").success);
  assert.equal(luchaChoose(s, "p0", "p1").success, false, "must say which of three powers");
  assert.equal(luchaChoose(s, "p0", "p1", "draco").success, false, "not a power they have");
  assert.ok(luchaChoose(s, "p0", "p1", "luna").success);
  assert.deepEqual(a.borrowedRoles, ["luna"]);
  assert.ok(roleActive(a, "luna") && !roleActive(a, "harry") && !roleActive(a, "hermione"));
  // Bots copy one power too
  const t = setup(3);
  t.players[0].roles = ["lucha"]; t.players[0].isBot = true; t.players[0].isSleeping = true;
  t.players[1].roles = ["harry", "luna"]; t.players[2].roles = ["hermione"];
  t.drawnThisTurn = true;
  assert.ok(endTurn(t, "p0").success);
  assert.ok(botStep(t, "p0"));
  assert.equal(t.players[0].borrowedRoles?.length, 1);
  console.log("lucha one power: ok");
}

// ---------- Power Outage on several roles cuts just the one the attacker picks ----------
{
  const s = setup(2);
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["harry", "hermione"]; b.protectedColor = "red";
  give(s, b, "properties", "prop_red_1");
  give(s, a, "hand", "action_silencio_1");
  assert.ok(playCard(s, "p0", "action_silencio_1").success);
  assert.equal(chooseTarget(s, "p0", "p1").success, false, "must pick a role");
  assert.equal(chooseTarget(s, "p0", "p1", "role_draco").success, false, "not one of theirs");
  assert.ok(chooseTarget(s, "p0", "p1", "role_hermione").success);
  assert.equal(s.pendingAction?.type, "protego_response", "still blockable with Just Say No");
  assert.ok(declineProtego(s, "p1").success);
  assert.ok(b.isSilenced);
  assert.equal(b.silencedRole, "hermione");
  assert.ok(!roleActive(b, "hermione"), "Hermione is cut");
  assert.ok(roleActive(b, "harry"), "Harry still works");
  // Paying it off brings the role back
  give(s, b, "bank", "money_10g_1");
  s.currentTurnIndex = 1; s.drawnThisTurn = true; s.pendingAction = null;
  assert.ok(paySilencio(s, "p1", ["money_10g_1"]).success);
  assert.ok(roleActive(b, "hermione") && b.silencedRole === undefined);
  // One role: no pick needed
  const t = setup(2);
  t.players[0].roles = ["luna"]; t.players[1].roles = ["harry"];
  give(t, t.players[0], "hand", "action_silencio_1");
  assert.ok(playCard(t, "p0", "action_silencio_1").success);
  assert.ok(chooseTarget(t, "p0", "p1").success);
  assert.ok(declineProtego(t, "p1").success);
  assert.equal(t.players[1].silencedRole, "harry");
  assert.ok(!roleActive(t.players[1], "harry"));
  // Cutting Lucha also cuts the power he copied
  const l = setup(2);
  l.players[1].roles = ["lucha", "hermione"]; l.players[1].borrowedRoles = ["luna"]; l.players[1].isSilenced = true; l.players[1].silencedRole = "lucha";
  assert.ok(!roleActive(l.players[1], "luna") && roleActive(l.players[1], "hermione"));
  // Older games without a picked role: every role is off
  l.players[1].silencedRole = undefined;
  assert.ok(!roleActive(l.players[1], "hermione"));
  console.log("power outage one role: ok");
}

// ---------- Classic Monopoly Deal: no roles, real deck, Wild Rent hits one player ----------
{
  const players = Array.from({ length: 3 }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
  const s = createInitialGameState("TEST", players, 60, "deal");
  const all = [...s.drawPile, ...s.players.flatMap(p => p.hand)].map(c => CARD_DEF_MAP[c.defId]);
  assert.equal(all.length, 101, "106 real cards minus 3 houses and 2 hotels");
  const count = (t: string) => all.filter(c => c.actionType === t).length;
  assert.equal(count("double_rent"), 2);
  assert.equal(count("confundus_charm"), 3);
  for (const t of ["reducto", "silencio", "time_turner"]) assert.equal(count(t), 0);
  assert.ok(s.players.every(p => p.roles.length === 0), "nobody has a role");

  for (const p of s.players) { s.drawPile.push(...p.hand); p.hand = []; }
  s.drawnThisTurn = true;
  const [a, b, c] = s.players;
  give(s, a, "properties", "prop_green_1");
  give(s, a, "hand", "rent_rainbow_1");
  give(s, a, "hand", "action_double_rent_1");
  give(s, c, "bank", "money_10g_1");
  assert.ok(playCard(s, "p0", "action_double_rent_1").success);
  assert.ok(playCard(s, "p0", "rent_rainbow_1", false, "green").success);
  assert.equal(s.pendingAction?.type, "choose_rent_target");
  // Taking it back returns the card and keeps the double waiting
  assert.ok(cancelChoice(s, "p0").success);
  assert.equal(s.rentMultiplier, 2);
  assert.equal(s.actionsUsed, 1);
  assert.ok(playCard(s, "p0", "rent_rainbow_1", false, "green").success);
  assert.ok(chooseTarget(s, "p0", "p2").success);
  assert.equal(s.pendingAction?.type, "pay_rent");
  assert.equal(s.pendingAction?.targetPlayerId, "p2");
  assert.equal(s.pendingAction?.amount, 4, "green rent 2M doubled");
  assert.ok(payWithCards(s, "p2", ["money_10g_1"]).success);
  assert.equal(s.pendingAction, null, "only the chosen player pays");
  assert.equal(b.bank.length, 0);
  // Two-colour rent still charges everyone
  give(s, a, "properties", "prop_brown_1");
  give(s, a, "hand", "rent_brown_lb_1");
  s.actionsUsed = 0;
  assert.ok(playCard(s, "p0", "rent_brown_lb_1", false, "brown").success);
  assert.equal(s.pendingAction?.data.allTargets.length, 2);
  console.log("classic monopoly deal: ok");
}

// ---------- Double the Rent ----------
{
  const s = createInitialGameState("TEST", Array.from({ length: 3 }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] })),
    60, "custom", updateCustomRules(DEFAULT_CUSTOM_RULES, { actions: ["double_rent"] }));
  for (const p of s.players) { s.drawPile.push(...p.hand); p.hand = []; p.roles = []; }
  s.drawnThisTurn = true;
  s.maxActions = 3;
  const [a, b, c] = s.players;
  give(s, a, "hand", "action_double_rent_1");
  assert.equal(playCard(s, "p0", "action_double_rent_1").success, false, "needs a rent card");
  give(s, a, "hand", "rent_red_yellow_1");
  assert.equal(playCard(s, "p0", "action_double_rent_1").success, false, "needs a property to charge for");
  give(s, a, "properties", "prop_red_1");
  s.actionsUsed = 2;
  assert.equal(playCard(s, "p0", "action_double_rent_1").success, false, "needs a play left for the rent");
  s.actionsUsed = 0;
  give(s, a, "hand", "action_double_rent_2");
  assert.ok(playCard(s, "p0", "action_double_rent_1").success);
  assert.equal(s.rentMultiplier, 2);
  assert.ok(playCard(s, "p0", "rent_red_yellow_1", false, "red").success);
  assert.equal(s.pendingAction?.amount, 4, "red rent 2M doubled");
  assert.equal(s.rentMultiplier, undefined);
  assert.equal(s.actionsUsed, 2);
  for (const p of [b, c]) assert.ok(payWithCards(s, p.visitorId, []).success);
  // An unused double is gone next turn
  give(s, a, "hand", "rent_red_yellow_2");
  assert.equal(playCard(s, "p0", "action_double_rent_2").success, false, "only 1 play left");
  s.rentMultiplier = 2;
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.rentMultiplier, undefined);
  console.log("double the rent: ok");
}

// ---------- Forfeit: cards go back into the draw pile and the player leaves ----------
{
  // Quitting on someone else's turn
  const s = setup(3);
  const [a, b] = s.players;
  give(s, b, "hand", "money_1g_1"); give(s, b, "bank", "money_5g_1"); give(s, b, "properties", "prop_red_1");
  const total = countCards(s), pile = s.drawPile.length;
  assert.ok(forfeit(s, "p1").success);
  assert.equal(s.players.length, 2);
  assert.ok(!s.players.some(p => p.visitorId === "p1"));
  assert.equal(s.drawPile.length, pile + 3, "quitter's hand, bank and properties go into the draw pile");
  assert.ok(s.drawPile.every(c => !c.assignedColor));
  assert.equal(countCards(s), total);
  assert.equal(s.players[s.currentTurnIndex], a, "still the same player's turn");
  assert.equal(s.status, "playing");
  assert.ok(!forfeit(s, "p1").success, "can't forfeit twice");
  assert.ok(!drawCards(s, "p1").success, "a quitter can't play");
}
{
  // Quitting on your own turn passes it to the next player
  const s = setup(3);
  s.currentTurnIndex = 2;
  assert.ok(forfeit(s, "p2").success);
  assert.equal(s.players[s.currentTurnIndex].visitorId, "p0");
  assert.equal(s.drawnThisTurn, false);
  // Earlier seat leaving keeps the turn with the same person
  const t = setup(4);
  t.currentTurnIndex = 2;
  assert.ok(forfeit(t, "p0").success);
  assert.equal(t.players[t.currentTurnIndex].visitorId, "p2");
}
{
  // Quitting while you owe rent moves on to the next payer; their part is gone from the tracker
  const s = setup(3);
  const [a, b, c] = s.players;
  a.roles = ["luna"]; b.roles = ["hermione"]; c.roles = ["draco"];
  give(s, a, "properties", "prop_red_1"); give(s, a, "hand", "rent_red_yellow_1");
  give(s, c, "bank", "money_5g_1");
  assert.ok(playCard(s, "p0", "rent_red_yellow_1", false, "red").success);
  assert.equal(getWaitingOn(s), "p1");
  assert.ok(forfeit(s, "p1").success);
  assert.equal(getWaitingOn(s), "p2");
  assert.ok(!s.pendingAction?.data.allTargets.includes("p1"));
  // The attacker quitting drops the charge for everyone
  assert.ok(forfeit(s, "p0").success);
  assert.equal(s.status, "finished");
  assert.equal(s.winnerId, "p2", "last player standing wins");
}
{
  // Only practice bots left: the game ends
  const s = setup(3);
  s.players[1].isBot = s.players[2].isBot = true;
  s.players[1].isSleeping = s.players[2].isSleeping = true;
  give(s, s.players[2], "properties", "prop_darkblue_1"); give(s, s.players[2], "properties", "prop_darkblue_2");
  assert.ok(forfeit(s, "p0").success);
  assert.equal(s.status, "finished");
  assert.equal(s.winnerId, "p2", "the bot closest to winning takes it");
}
{
  // Bot games keep going after someone quits mid-game
  for (let g = 0; g < 100; g++) {
    const s = newGame(3 + (g % 3));
    s.players.forEach(p => { p.isSleeping = true; p.isBot = g % 2 === 1; });
    const total = countCards(s);
    let steps = 0;
    while (s.status === "playing" && steps < 5000) {
      if (steps === 20 + g) {
        const quitter = s.players[g % s.players.length].visitorId;
        assert.ok(forfeit(s, quitter).success);
        assert.equal(countCards(s), total);
        steps++;
        continue;
      }
      assert.ok(botStep(s), `bot stuck after a forfeit in game ${g}: ${JSON.stringify(s.pendingAction)}`);
      steps++;
    }
  }
  console.log("forfeit: ok");
}

// ---------- Draw timer: a turn starts with a short draw step, then the full turn length ----------
{
  const s = newGame(3);
  s.players.forEach(p => { p.roles = []; }); // plain players: draw 2, no end-of-turn questions
  assert.ok(inDrawStep(s));
  assert.equal(s.turnTimer, DRAW_SECONDS);
  const p0 = s.players[0];
  const before = p0.hand.length;
  assert.ok(autoDraw(s).success);
  assert.equal(p0.hand.length, before + 2);
  assert.ok(!inDrawStep(s));
  assert.equal(freshTurnTimer(s), 60);
  // Once the plays are used up the clock drops to 20s
  s.actionsUsed = s.maxActions;
  assert.equal(freshTurnTimer(s), PLAYS_USED_UP_SECONDS);
  s.actionsUsed = 0;
  // The next turn starts on the draw timer again
  while (p0.hand.length > 7) p0.hand.pop();
  assert.ok(endTurn(s, p0.visitorId).success);
  assert.ok(inDrawStep(s));
  assert.equal(s.turnTimer, DRAW_SECONDS);
  // Cedric choosing deck or discard pile has a real choice: no draw timer
  const c = newGame(2);
  c.players.forEach(p => { p.roles = []; });
  c.players[1].roles = ["cedric"];
  c.discardPile.push(c.drawPile.pop()!);
  while (c.players[0].hand.length > 7) c.players[0].hand.pop();
  assert.ok(autoDraw(c).success);
  assert.ok(endTurn(c, "p0").success);
  assert.equal(c.pendingAction?.type, "cedric_draw_choice");
  assert.ok(!inDrawStep(c));
  assert.equal(c.turnTimer, 60);
  console.log("draw timer: ok");
}

// ---------- Dropped players are handed to the bot, and get it back ----------
{
  const s = newGame(2);
  const p1 = s.players[1];
  assert.equal(sleepForDisconnect(s, "p1"), false, "a connected player stays in control");
  p1.isConnected = false;
  assert.equal(sleepForDisconnect(s, "p1"), true);
  assert.ok(p1.isSleeping);
  assert.match(s.eventLog.at(-1)!.message, /lost connection/);
  assert.equal(sleepForDisconnect(s, "p1"), false, "only logged once");
  p1.isConnected = true;
  assert.ok(wakeUp(s, "p1").success);
  assert.ok(!p1.isSleeping);
  console.log("disconnect takeover: ok");
}

// ---------- Any-colour wild: joins only a colour you have, alone it has no colour ----------
{
  const s = setup();
  const [a, b] = s.players;
  a.roles = ["luna"]; b.roles = ["luna"];
  give(s, a, "hand", "wild_rainbow_1");
  give(s, a, "hand", "rent_rainbow_1");
  assert.equal(playCard(s, "p0", "wild_rainbow_1", false, "green").success, false, "can't join a colour you don't have");
  assert.ok(playCard(s, "p0", "wild_rainbow_1").success, "it can sit on its own");
  assert.equal(a.properties[0].assignedColor, undefined);
  assert.equal(playCard(s, "p0", "rent_rainbow_1", false, "green").success, false, "no rent from a lone wild");
  assert.equal(flipWild(s, "p0", "wild_rainbow_1", "green").success, false, "still no green to join");
  give(s, a, "properties", "prop_green_1");
  assert.ok(flipWild(s, "p0", "wild_rainbow_1", "green").success, "joins once green is there");
  assert.ok(playCard(s, "p0", "rent_rainbow_1", false, "green").success);
  assert.equal(s.pendingAction?.amount, 4, "green rent counts the wild once it has a real green");
  s.pendingAction = null;
  assert.ok(flipWild(s, "p0", "wild_rainbow_1", null).success, "it can leave its set and sit on its own");
  assert.equal(a.properties.find(x => x.defId === "wild_rainbow_1")!.assignedColor, undefined);
  assert.equal(flipWild(s, "p0", "prop_green_1" as any, null).success, false);
  // A rainbow set with no real card of its colour isn't a set
  const t = setup();
  const [c] = t.players;
  give(t, c, "properties", "wild_rainbow_1", "brown");
  give(t, c, "properties", "wild_rainbow_2", "brown");
  assert.equal(countCompleteSets(c.properties, SET_SIZES), 0, "two wilds alone don't make brown");
  // Losing the real card sends the wild back to no colour
  give(t, c, "properties", "prop_brown_1");
  assert.equal(countCompleteSets(c.properties, SET_SIZES), 1);
  t.drawPile.push(take(t, "prop_brown_1"));
  settleWilds(t);
  assert.ok(c.properties.every(x => x.assignedColor === undefined));
  // Two-colour wilds still count on their own
  give(t, c, "properties", "wild_lb_brown_1", "brown");
  assert.equal(countCompleteSets(c.properties, SET_SIZES), 0);
  assert.ok(flipWild(t, "p0", "wild_rainbow_1", "brown").success, "a two-colour wild is a card of that colour");
  assert.equal(countCompleteSets(c.properties, SET_SIZES), 1);
  console.log("any-colour wild: ok");
}

// ---------- Prime: 120 cards, no roles, the new cards work and can be blocked ----------
{
  const prime = VARIATIONS.prime;
  assert.equal(prime.deck.length, 120, "Monopoly Deal's 101 plus 19 Prime cards");
  assert.equal(prime.roles.length, 0);
  const count = (t: string) => prime.deck.filter(id => CARD_DEF_MAP[id].actionType === t).length;
  assert.equal(count("bank_robber"), 1, "exactly one Bank Robber");
  assert.equal(count("protego"), 4, "four Just Say No");
  for (const t of ["hand_seven", "hand_steal", "chargeback", "reverse", "destroy", "bank_robber"] as const) {
    assert.equal(DEFAULT_CUSTOM_RULES.counts[t], 0, `${t} is off by default in Custom`);
  }

  const primeSetup = (n = 3) => {
    const players = Array.from({ length: n }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
    const s = createInitialGameState("TEST", players, 60, "prime");
    for (const p of s.players) { s.drawPile.push(...p.hand); p.hand = []; }
    s.drawnThisTurn = true;
    return s;
  };

  // Hand 7 draws up to 7
  {
    const s = primeSetup();
    const a = s.players[0];
    give(s, a, "hand", "action_hand_seven_1"); give(s, a, "hand", "money_1g_1");
    assert.ok(playCard(s, "p0", "action_hand_seven_1").success);
    assert.equal(a.hand.length, 7);
  }
  // Hand Steal takes a random card; the target is asked first
  {
    const s = primeSetup();
    const [a, b] = s.players;
    give(s, a, "hand", "action_hand_steal_1"); give(s, b, "hand", "money_5g_1");
    assert.ok(playCard(s, "p0", "action_hand_steal_1").success);
    assert.ok(chooseTarget(s, "p0", "p1").success);
    assert.equal(s.pendingAction?.type, "protego_response");
    assert.ok(declineProtego(s, "p1").success);
    assert.ok(a.hand.some(c => c.defId === "money_5g_1") && b.hand.length === 0);
  }
  // Destroy hits a complete set; Just Say No stops it
  {
    const s = primeSetup();
    const [a, b] = s.players;
    give(s, a, "hand", "action_destroy_1");
    give(s, b, "properties", "prop_brown_1"); give(s, b, "properties", "prop_brown_2");
    assert.ok(playCard(s, "p0", "action_destroy_1").success);
    assert.ok(chooseTarget(s, "p0", "p1", "prop_brown_1").success, "complete sets are fair game");
    assert.ok(declineProtego(s, "p1").success);
    assert.equal(b.properties.length, 1);
    assert.ok(s.discardPile.some(c => c.defId === "prop_brown_1"));
  }
  {
    const s = primeSetup();
    const [a, b] = s.players;
    give(s, a, "hand", "action_bank_robber_1");
    give(s, b, "bank", "money_5g_1"); give(s, b, "bank", "money_3g_1"); give(s, b, "hand", "action_protego_1");
    assert.ok(playCard(s, "p0", "action_bank_robber_1").success);
    assert.ok(chooseTarget(s, "p0", "p1").success);
    assert.ok(playProtego(s, "p1").success);
    assert.ok(declineProtego(s, "p0").success);
    assert.equal(b.bank.length, 2, "Just Say No saved the bank");
    // ...and without one the whole bank goes
    give(s, a, "hand", "action_bank_robber_1");
    assert.ok(playCard(s, "p0", "action_bank_robber_1").success);
    assert.ok(chooseTarget(s, "p0", "p1").success);
    assert.ok(declineProtego(s, "p1").success);
    assert.equal(b.bank.length, 0);
    assert.equal(a.bank.length, 2);
  }
  // Chargeback: cancel your part of a birthday, charge someone else, then the queue carries on
  {
    const s = primeSetup();
    const [a, b, c] = s.players;
    give(s, a, "hand", "action_yule_1");
    give(s, b, "hand", "action_chargeback_1");
    give(s, a, "bank", "money_2g_1"); give(s, c, "bank", "money_2g_2");
    assert.ok(playCard(s, "p0", "action_yule_1").success);
    assert.equal(s.pendingAction?.targetPlayerId, "p1");
    assert.ok(playChargeback(s, "p1").success);
    assert.equal(s.pendingAction?.type, "choose_chargeback");
    assert.equal(getWaitingOn(s), "p1");
    assert.ok(chooseTarget(s, "p1", "p0").success);
    assert.equal(s.pendingAction?.type, "pay_debt");
    assert.equal(s.pendingAction?.targetPlayerId, "p0");
    assert.ok(payWithCards(s, "p0", ["money_2g_1"]).success);
    assert.ok(b.bank.some(x => x.defId === "money_2g_1"), "the birthday player paid instead");
    assert.equal(s.pendingAction?.type, "pay_birthday", "back to the birthday queue");
    assert.equal(s.pendingAction?.targetPlayerId, "p2");
    assert.ok(payWithCards(s, "p2", ["money_2g_2"]).success);
    assert.equal(s.pendingAction, null);
  }
  // Leaving mid-Chargeback hands the birthday on to the next payer
  {
    const s = primeSetup(4);
    const [a, b] = s.players;
    give(s, a, "hand", "action_yule_1"); give(s, b, "hand", "action_chargeback_1");
    assert.ok(playCard(s, "p0", "action_yule_1").success);
    assert.ok(playChargeback(s, "p1").success);
    assert.ok(forfeit(s, "p1").success);
    assert.equal(s.pendingAction?.type, "pay_birthday");
    assert.equal(s.pendingAction?.targetPlayerId, "p2");
  }
  // Reverse on a charge: the attacker pays the same amount
  {
    const s = primeSetup(2);
    const [a, b] = s.players;
    give(s, a, "hand", "action_goblin_1"); give(s, b, "hand", "action_reverse_1");
    give(s, a, "bank", "money_5g_1");
    assert.ok(playCard(s, "p0", "action_goblin_1").success);
    assert.ok(chooseTarget(s, "p0", "p1").success);
    assert.ok(playReverse(s, "p1").success);
    assert.equal(s.pendingAction?.targetPlayerId, "p0");
    assert.equal(s.pendingAction?.amount, 5);
    assert.ok(payWithCards(s, "p0", ["money_5g_1"]).success);
    assert.equal(s.pendingAction, null);
    assert.equal(b.bank.length, 1);
  }
  // Reverse on Sly Deal: the target takes one of the attacker's properties instead, and can't take it back
  {
    const s = primeSetup(3);
    const [a, b] = s.players;
    give(s, a, "hand", "action_accio_1"); give(s, b, "hand", "action_reverse_1");
    give(s, a, "properties", "prop_green_1"); give(s, b, "properties", "prop_brown_1");
    assert.ok(playCard(s, "p0", "action_accio_1").success);
    assert.ok(chooseTarget(s, "p0", "p1", "prop_brown_1").success);
    assert.ok(playReverse(s, "p1").success);
    assert.equal(s.pendingAction?.type, "choose_steal");
    assert.equal(getWaitingOn(s), "p1");
    assert.equal(cancelChoice(s, "p1").success, false);
    assert.equal(chooseTarget(s, "p1", "p2").success, false, "only the attacker");
    assert.ok(chooseTarget(s, "p1", "p0", "prop_green_1").success);
    assert.equal(s.pendingAction?.type, "protego_response");
    assert.equal(s.pendingAction?.targetPlayerId, "p0", "the attacker can Just Say No to it");
    assert.ok(declineProtego(s, "p0").success);
    assert.ok(b.properties.some(x => x.defId === "prop_green_1") && b.properties.some(x => x.defId === "prop_brown_1"));
  }
  // Reverse on Power Outage: the reverser picks which of the attacker's roles to cut
  {
    const s = primeSetup(2);
    const [a, b] = s.players;
    a.roles = ["harry", "luna"]; b.roles = ["draco"];
    a.hand.push({ defId: "action_silencio_1" }); give(s, b, "hand", "action_reverse_1"); // Prime has no Power Outage
    assert.ok(playCard(s, "p0", "action_silencio_1").success);
    assert.ok(chooseTarget(s, "p0", "p1").success);
    assert.ok(playReverse(s, "p1").success);
    assert.equal(s.pendingAction?.type, "choose_silencio");
    assert.ok(chooseTarget(s, "p1", "p0", "role_luna").success);
    assert.ok(declineProtego(s, "p0").success);
    assert.equal(a.silencedRole, "luna");
    assert.ok(roleActive(a, "harry") && !roleActive(a, "luna") && roleActive(b, "draco"));
  }
  // Reverse with nothing to turn back works as a Just Say No
  {
    const s = primeSetup(2);
    const [a, b] = s.players;
    give(s, a, "hand", "action_accio_1"); give(s, b, "hand", "action_reverse_1");
    give(s, b, "properties", "prop_brown_1");
    assert.ok(playCard(s, "p0", "action_accio_1").success);
    assert.ok(chooseTarget(s, "p0", "p1", "prop_brown_1").success);
    assert.ok(playReverse(s, "p1").success);
    assert.equal(s.pendingAction?.type, "protego_response");
    assert.ok(declineProtego(s, "p0").success);
    assert.ok(b.properties.some(x => x.defId === "prop_brown_1"), "blocked");
  }
  // Prime games played by bots keep their cards
  for (let g = 0; g < 40; g++) {
    const players = Array.from({ length: 2 + (g % 3) }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i], isBot: true }));
    const s = createInitialGameState("TEST", players, 60, "prime");
    s.players.forEach(p => { p.isSleeping = true; p.isBot = true; });
    const total = countCards(s);
    for (let i = 0; i < 3000 && s.status === "playing"; i++) {
      assert.ok(botStep(s));
      assert.equal(countCards(s), total);
    }
  }
  console.log("prime: ok");
}

// ---------- Gandu: pays half of any charge, rounded up ----------
{
  const s = setup(3);
  const [a, b, c] = s.players;
  a.roles = []; b.roles = ["gandu"]; c.roles = [];
  give(s, a, "properties", "prop_orange_1"); give(s, a, "properties", "prop_orange_2"); give(s, a, "properties", "prop_orange_3");
  give(s, a, "hand", "rent_pink_orange_1"); give(s, a, "hand", "action_yule_1");
  give(s, b, "bank", "money_5g_1"); give(s, c, "bank", "money_5g_2");
  assert.ok(playCard(s, "p0", "rent_pink_orange_1", false, "orange").success);
  assert.equal(s.pendingAction?.targetPlayerId, "p1");
  assert.equal(s.pendingAction?.amount, 3, "half of 5M rounds up to 3M");
  assert.ok(payWithCards(s, "p1", ["money_5g_1"]).success);
  assert.equal(s.pendingAction?.targetPlayerId, "p2");
  assert.equal(s.pendingAction?.amount, 5, "everyone else pays the full rent");
  assert.ok(payWithCards(s, "p2", ["money_5g_2"]).success);
  // Every charge is halved: It's My Birthday's 2M becomes 1M for Gandu only
  assert.ok(playCard(s, "p0", "action_yule_1").success);
  assert.equal(s.pendingAction?.targetPlayerId, "p1");
  assert.equal(s.pendingAction?.amount, 1, "Gandu pays half of a birthday");
  // 1M stays 1M
  const t = setup(2);
  t.players[1].roles = ["gandu"];
  give(t, t.players[0], "properties", "prop_brown_1"); give(t, t.players[0], "hand", "rent_brown_lb_1");
  assert.ok(playCard(t, "p0", "rent_brown_lb_1", false, "brown").success);
  assert.equal(t.pendingAction?.amount, 1);
  console.log("gandu: ok");
}

// ---------- Tharki: one colour needs one fewer card ----------
{
  const s = setup(2);
  const [a, b] = s.players;
  a.roles = ["tharki"]; b.roles = [];
  give(s, a, "properties", "prop_orange_1"); give(s, a, "properties", "prop_orange_2");
  give(s, a, "properties", "prop_brown_1");
  assert.equal(calculateRent(a, "orange"), 3);
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "tharki_shortcut");
  assert.equal(tharkiShortcutColor(s, "p0", "brown").success, false, "brown already needs only 2");
  assert.ok(tharkiShortcutColor(s, "p0", "orange").success);
  assert.equal(a.shortcutColor, "orange");
  assert.equal(calculateRent(a, "orange"), 5, "a Shortcut set earns full-set rent");
  // Complete now: Sly Deal can't touch it, Deal Breaker can
  s.currentTurnIndex = 1; s.pendingAction = null; s.drawnThisTurn = true;
  give(s, b, "hand", "action_accio_1");
  assert.equal(playCard(s, "p1", "action_accio_1").success, true, "brown is still takeable");
  assert.equal(chooseTarget(s, "p1", "p0", "prop_orange_1").success, false, "orange is a complete set");
  // No answer keeps it; null drops it
  s.currentTurnIndex = 0; s.pendingAction = null; s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(tharkiShortcutColor(s, "p0").success);
  assert.equal(a.shortcutColor, "orange");
  s.currentTurnIndex = 0; s.pendingAction = null; s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(tharkiShortcutColor(s, "p0", null).success);
  assert.equal(a.shortcutColor, undefined);
  // Moving the Shortcut can win the game
  const w = setup(2);
  const t = w.players[0]; t.roles = ["tharki"]; w.players[1].roles = [];
  for (const id of ["prop_brown_1", "prop_brown_2", "prop_darkblue_1", "prop_darkblue_2", "prop_red_1", "prop_red_2"]) give(w, t, "properties", id);
  assert.equal(w.status, "playing");
  assert.ok(endTurn(w, "p0").success);
  assert.ok(tharkiShortcutColor(w, "p0", "red").success);
  assert.equal(w.status, "finished");
  assert.equal(w.winnerId, "p0");
  // Silenced Tharki loses the Shortcut's effect
  a.shortcutColor = "orange"; a.isSilenced = true;
  assert.equal(calculateRent(a, "orange"), 3);
  // 2-card colours can't take a Shortcut, and an old one there does nothing
  a.isSilenced = false; a.shortcutColor = "brown";
  assert.equal(calculateRent(a, "brown"), 1, "one brown on an old Shortcut is still one of two");
  a.shortcutColor = "orange";
  s.currentTurnIndex = 0; s.pendingAction = null; s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p0").success);
  assert.equal(tharkiShortcutColor(s, "p0", "brown").success, false, "brown needs only 2");
  console.log("tharki: ok");
}

// ---------- Kanjar: his friend can't charge him or act against him ----------
{
  const s = setup(3);
  const [a, b, c] = s.players;
  a.roles = ["kanjar"]; b.roles = []; c.roles = [];
  give(s, a, "properties", "prop_brown_1"); give(s, a, "bank", "money_5g_1"); give(s, a, "hand", "money_1g_1");
  assert.ok(endTurn(s, "p0").success);
  assert.equal(s.pendingAction?.type, "kanjar_friend");
  assert.ok(kanjarChooseFriend(s, "p0", "p1").success);
  assert.equal(a.friendId, "p1");
  assert.equal(s.currentTurnIndex, 1);
  s.drawnThisTurn = true;
  // Rent from the friend skips Kanjar
  give(s, b, "properties", "prop_red_1"); give(s, b, "hand", "rent_red_yellow_1");
  give(s, c, "bank", "money_1g_2");
  assert.ok(playCard(s, "p1", "rent_red_yellow_1", false, "red").success);
  assert.equal(s.pendingAction?.targetPlayerId, "p2", "Kanjar is skipped");
  assert.deepEqual(s.pendingAction?.data.results, [{ playerId: "p0", outcome: "friend", amount: 0 }]);
  assert.ok(payWithCards(s, "p2", ["money_1g_2"]).success);
  // Steals, Debt Collector and Hand Steal can't pick him
  give(s, b, "hand", "action_accio_1");
  assert.equal(playCard(s, "p1", "action_accio_1").success, false, "nobody else has a property to take");
  give(s, c, "properties", "prop_green_1");
  assert.ok(playCard(s, "p1", "action_accio_1").success);
  assert.equal(chooseTarget(s, "p1", "p0", "prop_brown_1").success, false);
  assert.ok(chooseTarget(s, "p1", "p2", "prop_green_1").success);
  assert.ok(declineProtego(s, "p2").success);
  give(s, b, "hand", "action_goblin_1");
  assert.ok(playCard(s, "p1", "action_goblin_1").success);
  assert.equal(chooseTarget(s, "p1", "p0").success, false);
  // Someone else can still charge Kanjar
  s.pendingAction = null; s.currentTurnIndex = 2; s.drawnThisTurn = true; s.actionsUsed = 0;
  give(s, c, "hand", "action_goblin_3");
  assert.ok(playCard(s, "p2", "action_goblin_3").success);
  assert.ok(chooseTarget(s, "p2", "p0").success, "only the friend is held back");
  // Kanjar's power is off when silenced
  a.isSilenced = true;
  s.pendingAction = null; s.currentTurnIndex = 1; s.actionsUsed = 0;
  give(s, b, "hand", "action_goblin_2");
  assert.ok(playCard(s, "p1", "action_goblin_2").success);
  assert.ok(chooseTarget(s, "p1", "p0").success, "a silenced Kanjar has no friend");
  a.isSilenced = false;
  // No answer keeps the friend
  s.pendingAction = null; s.currentTurnIndex = 0; s.drawnThisTurn = true;
  assert.ok(endTurn(s, "p0").success);
  assert.ok(kanjarChooseFriend(s, "p0").success);
  assert.equal(a.friendId, "p1");
  // Not dealt one on one; friendships end when it drops to two players
  for (let g = 0; g < 30; g++) {
    const players = Array.from({ length: 2 }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] }));
    const two = createInitialGameState("TEST", players, 60, "gg");
    assert.ok(two.players.every(p => !p.roles.includes("kanjar")));
  }
  assert.ok(forfeit(s, "p2").success);
  assert.equal(a.friendId, undefined);
  console.log("kanjar: ok");
}

// ---------- GG bot games with every GG role keep their cards ----------
for (let g = 0; g < 60; g++) {
  const players = Array.from({ length: 3 + (g % 3) }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i], isBot: true }));
  const s = createInitialGameState("TEST", players, 60, "gg");
  s.players.forEach((p, i) => { p.isSleeping = true; p.isBot = true; p.roles = [(["gandu", "tharki", "kanjar", "lucha", "ganda"] as RoleType[])[i % 5]]; });
  const total = countCards(s);
  for (let i = 0; i < 3000 && s.status === "playing"; i++) {
    assert.ok(botStep(s), `gg bot stuck: ${JSON.stringify(s.pendingAction)}`);
    assert.equal(countCards(s), total);
  }
}
console.log("gg roles bot games: ok");

// ---------- Vegas: start-of-turn gamble, Guess and Draw, All In ----------
{
  const vegasGame = (n: number) => createInitialGameState("TEST", Array.from({ length: n }, (_, i) => ({ visitorId: `p${i}`, seatIndex: i, animal: ANIMALS[i] })), 60, "vegas");
  const withPot = countCards;

  // Every turn opens with the gamble; drawing waits for it
  const s = vegasGame(3);
  assert.equal(s.pendingAction?.type, "vegas_gamble");
  assert.equal(getWaitingOn(s), "p0");
  assert.ok(!drawCards(s, "p0").success, "no drawing before the gamble");

  // Dice: each outcome, many times over
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const g = vegasGame(3);
    assert.ok(vegasGamble(g, "p0", "dice").success);
    const roll = g.gamble!.rolls![0].dice[0];
    if (roll < 3) { seen.add("lose"); assert.equal(g.currentTurnIndex, 1, "1-2 loses the turn"); assert.equal(g.pendingAction?.type, "vegas_gamble"); }
    else {
      assert.equal(g.currentTurnIndex, 0); assert.equal(g.pendingAction, null, "then the draw");
      assert.ok(drawCards(g, "p0").success);
      assert.ok(endTurn(g, "p0").success);
      if (roll > 3) { seen.add("extra"); assert.equal(g.currentTurnIndex, 0, "4-6 plays again"); assert.equal(g.pendingAction?.type, "vegas_gamble"); }
      else { seen.add("keep"); assert.equal(g.currentTurnIndex, 1); }
    }
  }
  assert.equal(seen.size, 3);

  // Duel: the target can Just Say No; otherwise someone takes a card (or a tie)
  for (let i = 0; i < 60; i++) {
    const g = vegasGame(2);
    const total = countCards(g);
    if (i % 2) give(g, g.players[1], "hand", "action_protego_1");
    const hand = g.players[0].hand.length;
    assert.ok(vegasGamble(g, "p0", "duel", "p1").success);
    assert.equal(g.pendingAction?.type, "protego_response");
    assert.equal(getWaitingOn(g), "p1");
    if (i % 2) {
      assert.ok(playProtego(g, "p1").success);
      assert.ok(declineProtego(g, "p0").success);
      assert.equal(g.pendingAction, null, "blocked: p0 goes on to draw");
      assert.equal(g.players[0].hand.length, hand);
    } else {
      assert.ok(declineProtego(g, "p1").success);
      const [a, b] = g.gamble!.rolls!.map(r => r.dice[0]);
      assert.equal(g.players[0].hand.length, a > b ? hand + 1 : a < b ? hand - 1 : hand);
    }
    assert.equal(countCards(g), total);
    assert.ok(drawCards(g, "p0").success);
  }

  // Bet: heads doubles from the house, tails discards the stake
  for (let i = 0; i < 40; i++) {
    const g = vegasGame(2);
    const total = countCards(g);
    const p0 = g.players[0];
    give(g, p0, "bank", "money_3g_1"); give(g, p0, "bank", "money_1g_1");
    assert.ok(!vegasGamble(g, "p0", "bet", undefined, ["money_5g_1"]).success, "only bank money");
    assert.ok(vegasGamble(g, "p0", "bet", undefined, ["money_3g_1"]).success);
    const bank = p0.bank.reduce((n, c) => n + CARD_DEF_MAP[c.defId].value, 0);
    if (g.gamble!.coin === "heads") assert.ok(bank >= 7, "won at least 3M more");
    else { assert.equal(bank, 1); assert.ok(g.discardPile.some(c => c.defId === "money_3g_1")); }
    assert.equal(countCards(g), total);
    assert.equal(g.pendingAction, null);
  }

  // Guess and Draw: right guesses keep coming, a wrong one discards and stops
  {
    const g = vegasGame(2);
    vegasGamble(g, "p0", "duel", "p1"); declineProtego(g, "p1");
    drawCards(g, "p0");
    const p0 = g.players[0];
    give(g, p0, "hand", "action_guess_draw_1");
    assert.ok(playCard(g, "p0", "action_guess_draw_1").success);
    assert.equal(g.pendingAction?.type, "guess_draw");
    g.drawPile.push(take(g, "money_2g_1"), take(g, "prop_red_1"));
    const hand = p0.hand.length;
    assert.ok(guessCard(g, "p0", "property").success);
    assert.equal(p0.hand.length, hand + 1);
    assert.equal(g.pendingAction?.type, "guess_draw");
    assert.ok(guessCard(g, "p0", "action").success);
    assert.equal(p0.hand.length, hand + 1, "wrong guess keeps nothing");
    assert.equal(g.discardPile.at(-1)?.defId, "money_2g_1");
    assert.equal(g.pendingAction, null);
    assert.equal(guessKindOf("rent_red_yellow_1"), "action");
    assert.equal(guessKindOf("wild_rainbow_1"), "property");
  }

  // All In: the stake is the poorest player's worth; blockers sit out; the winner takes the pot
  for (let i = 0; i < 40; i++) {
    const g = vegasGame(3);
    vegasGamble(g, "p0", "dice"); // whatever happens, set the turn up by hand below
    g.currentTurnIndex = 0; g.pendingAction = null; g.drawnThisTurn = true; g.actionsUsed = 0;
    const [a, b, c] = g.players;
    const total = withPot(g);
    give(g, a, "bank", "money_5g_1"); give(g, b, "bank", "money_2g_1"); give(g, b, "properties", "prop_red_1");
    give(g, c, "bank", "money_4g_1");
    give(g, a, "hand", "action_all_in_1");
    assert.ok(playCard(g, "p0", "action_all_in_1").success);
    assert.equal(g.poker!.stake, 4, "the poorest player (p2, 4M) sets the stake");
    assert.equal(g.pendingAction?.type, "pay_poker");
    assert.ok(!playProtego(g, "p0").success, "can't block your own All In");
    assert.ok(payWithCards(g, "p0", ["money_5g_1"]).success);
    if (i % 2) {
      give(g, b, "hand", "action_protego_1");
      assert.ok(playProtego(g, "p1").success);
      assert.ok(declineProtego(g, "p0").success);
    } else {
      assert.ok(payWithCards(g, "p1", ["money_2g_1", "prop_red_1"]).success);
    }
    assert.ok(payWithCards(g, "p2", ["money_4g_1"]).success);
    assert.equal(g.poker, null, "settled");
    assert.equal(g.pendingAction, null);
    const winner = g.players.find(p => p.visitorId === g.gamble!.playerId)!;
    assert.ok(winner.bank.some(c => c.defId === "money_4g_1") && winner.bank.some(c => c.defId === "money_5g_1"));
    if (i % 2 === 0) assert.ok(winner.properties.some(c => c.defId === "prop_red_1"), "properties go to the winner's table");
    assert.equal(withPot(g), total);
  }

  // Bot games in Vegas keep every card
  for (let gi = 0; gi < 80; gi++) {
    const g = vegasGame(2 + (gi % 4));
    g.players.forEach(p => { p.isSleeping = true; p.isBot = gi % 2 === 1; });
    const total = withPot(g);
    for (let i = 0; i < 3000 && g.status === "playing"; i++) {
      assert.ok(botStep(g), `vegas bot stuck: ${JSON.stringify(g.pendingAction)}`);
      assert.equal(withPot(g), total);
    }
  }
  console.log("vegas: ok");
}

console.log("all engine checks passed");

// ---------- Pick cheapest: the smallest total that covers the charge ----------
{
  const opt = (id: string, value: number, keep = 0) => ({ id, value, keep });
  assert.deepEqual(cheapestCover([opt("a", 1), opt("b", 1), opt("c", 2)], 3)?.sort(), ["a", "c"], "owing 3M with 1,1,2 pays 1+2");
  assert.deepEqual(cheapestCover([opt("a", 1), opt("b", 2), opt("c", 5)], 5), ["c"], "an exact 5M beats 1+2+... overpaying");
  assert.deepEqual(cheapestCover([opt("a", 3), opt("p", 2, 1)], 2), ["p"], "a 2M property beats overpaying with 3M");
  assert.deepEqual(cheapestCover([opt("m", 2), opt("p", 2, 1)], 2), ["m"], "bank before property at the same total");
  assert.deepEqual(cheapestCover([opt("set", 2, 2), opt("p", 1, 1), opt("q", 1, 1)], 2)?.sort(), ["p", "q"], "full sets are a last resort");
  assert.equal(cheapestCover([opt("a", 1)], 3), null, "can't cover");
  console.log("cheapest: ok");
}
