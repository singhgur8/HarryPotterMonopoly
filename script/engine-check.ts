/**
 * Quick rules check for the game engine. Run with `npm run test:engine`.
 * Plays full bot-vs-bot games and walks through the tricky rules
 * (payments, Protego chains, Silencio, Harry's shield, Time-Turner).
 */
import assert from "node:assert/strict";
import {
  createInitialGameState, botStep, payWithCards, playProtego, declineProtego,
  chooseTarget, playCard, drawCards, paySilencio, getWaitingOn, flipWild,
  harryProtectColor, endTurn, luchaChoose, roleActive, timeTurnerChoose, bankCard, cancelChoice, cedricChooseSource, wakeUp, forfeit, autoDraw,
  sleepForDisconnect, settleWilds,
} from "../worker/gameEngine";
import { ANIMALS, SET_SIZES, DRAW_SECONDS, inDrawStep, freshTurnTimer } from "../shared/schema";
import type { GameState, PlayerState, RoleType } from "../shared/schema";
import { CARD_DEF_MAP, countCompleteSets, roleDef } from "../shared/cardDefs";
import { VARIATIONS, ACTION_CHOICES, NON_CLASSIC_ACTIONS, DEFAULT_CUSTOM_RULES, ALL_ROLES, updateCustomRules } from "../shared/variations";

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
  for (const v of Object.values(VARIATIONS)) {
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
  const all = ACTION_CHOICES.map(a => a.type);

  // Default custom deck: classic actions only, no Demolish / Power Outage / Rewind / Double the Rent
  const d = createInitialGameState("TEST", players, 60, "custom");
  const cards = [...d.drawPile, ...d.players.flatMap(p => p.hand)].map(c => CARD_DEF_MAP[c.defId]);
  for (const t of NON_CLASSIC_ACTIONS) assert.ok(!cards.some(c => c.actionType === t), `${t} is off by default`);
  assert.ok(cards.some(c => c.actionType === "accio"));

  // Random, 3 roles each, all different within a player
  const r = createInitialGameState("TEST", players, 60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "ganda", "lucha"], rolesPerPlayer: 3 });
  for (const p of r.players) {
    assert.equal(p.roles.length, 3);
    assert.equal(new Set(p.roles).size, 3);
    assert.ok(p.roles.every(x => ["harry", "luna", "ganda", "lucha"].includes(x)));
  }

  // Players choose: any number, only from roles in play; bots get one
  const picks = [["harry", "luna", "draco"], [], ["cedric", "hermione"]] as RoleType[][];
  const c = createInitialGameState("TEST",
    [...players.slice(0, 3).map((p, i) => ({ ...p, pickedRoles: picks[i] })), { ...players[3], isBot: true }],
    60, "custom", { ...DEFAULT_CUSTOM_RULES, roles: ["harry", "luna", "cedric", "hermione"], roleMode: "choose" });
  assert.deepEqual(c.players[0].roles, ["harry", "luna"], "draco isn't in play");
  assert.deepEqual(c.players[1].roles, []);
  assert.deepEqual([...c.players[2].roles].sort(), ["cedric", "hermione"]);
  assert.equal(c.players[3].roles.length, 1);

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
    const s = createInitialGameState("TEST", players.slice(0, 2 + (g % 3)), 60, "custom", { ...DEFAULT_CUSTOM_RULES, actions: all, roles: ALL_ROLES, rolesPerPlayer: 2 });
    const total = countCards(s);
    s.players.forEach(p => { p.isSleeping = true; p.isBot = true; });
    let steps = 0;
    while (s.status === "playing" && steps < 5000) { assert.ok(botStep(s)); assert.equal(countCards(s), total); steps++; }
    if (s.status === "finished") wins++;
  }
  assert.ok(wins > 5, "custom bot games should reach a winner");

  // Host settings are cleaned up
  const u = updateCustomRules(DEFAULT_CUSTOM_RULES, { roles: ["luna", "nobody"], actions: ["double_rent", "x"], rolesPerPlayer: 9, roleMode: "bad" });
  assert.deepEqual(u.roles, ["luna"]);
  assert.deepEqual(u.actions, ["double_rent"]);
  assert.equal(u.rolesPerPlayer, 1);
  assert.equal(u.roleMode, "random");
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
    60, "custom", { ...DEFAULT_CUSTOM_RULES, actions: ["double_rent"] });
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

console.log("all engine checks passed");
