import type { CustomRules, RoleType, TemplateId } from "@shared/schema";
import { MAX_COPIES } from "@shared/cardDefs";
import { ACTION_CHOICES, ALL_ROLES, MONEY_CHOICES, MAX_SETS_TO_WIN, MIN_SETS_TO_WIN, VARIATIONS, VARIATION_IDS, customDeck, customFrom, isTemplateId } from "@shared/variations";
import { roleInfo } from "./helpers";

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);
const TEMPLATES = VARIATION_IDS.filter(isTemplateId);
const same = (a: CustomRules, b: CustomRules) => JSON.stringify({ ...a, roles: [...a.roles].sort() }) === JSON.stringify({ ...b, roles: [...b.roles].sort() });

/** A − n + control. */
function Stepper({ value, min, max, disabled, label, onChange, testId }: {
  value: number; min: number; max: number; disabled: boolean; label: string; onChange: (n: number) => void; testId?: string;
}) {
  return (
    <div className="hp-cstepper">
      <button disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>−</button>
      <b data-testid={testId}>{value}</b>
      <button disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>+</button>
    </div>
  );
}

/** The host's settings for a Custom game: where it starts from, roles, card counts and the win condition. */
export function CustomSetup({ rules, isHost, send }: { rules: CustomRules; isHost: boolean; send: (type: any, payload?: any) => void }) {
  const set = (change: Record<string, unknown>) => send("set_custom_rules", change);
  const setCount = (key: string, n: number) => set({ countKey: key, count: n });
  const deckSize = customDeck(rules).length;
  const actionCards = ACTION_CHOICES.reduce((n, a) => n + (rules.counts[a.type] ?? 0), 0);
  const moneyCards = MONEY_CHOICES.reduce((n, v) => n + (rules.counts[`money_${v}`] ?? 0), 0);
  const changed = !same(rules, customFrom(rules.template));
  const each = `${rules.rolesPerPlayer} role${rules.rolesPerPlayer === 1 ? "" : "s"} each`;

  return (
    <details className="hp-custom" open={isHost}>
      <summary>
        <span className="hp-label">Custom rules{isHost ? "" : " · set by the host"}</span>
        <span className="hp-muted">
          {VARIATIONS[rules.template].name}{changed ? ", changed" : ""} · {rules.roles.length ? `${each}, ${rules.roleMode === "choose" ? "players choose" : "dealt at random"}` : "no roles"} · {actionCards} action cards · {deckSize}-card deck · {rules.setsToWin} set{rules.setsToWin === 1 ? "" : "s"} to win
        </span>
      </summary>

      <section>
        <div className="hp-cstep"><span>1</span><b>Start from</b></div>
        <div className="hp-seg">
          {TEMPLATES.map((id: TemplateId) => (
            <button key={id} aria-pressed={rules.template === id} disabled={!isHost} onClick={() => set({ useTemplate: id })} data-testid={`custom-template-${id}`}>
              {VARIATIONS[id].name}
            </button>
          ))}
        </div>
        <span className="hp-muted" style={{ fontSize: 13 }}>
          Picks that version's roles, cards and rules. Change anything below from there.
          {isHost && changed && <> <button className="hp-linkbtn" style={{ fontSize: 13 }} onClick={() => set({ useTemplate: rules.template })}>Undo my changes</button></>}
        </span>
      </section>

      <section>
        <div className="hp-cstep"><span>2</span><b>Roles in play</b></div>
        <div className="hp-opts">
          {ALL_ROLES.map(r => {
            const info = roleInfo(r);
            return (
              <button key={r} className="hp-opt" aria-pressed={rules.roles.includes(r)} disabled={!isHost} onClick={() => set({ roles: toggle(rules.roles, r) })} data-testid={`custom-role-${r}`}>
                <b>{info?.name}</b>
                <span>{info?.power}</span>
              </button>
            );
          })}
        </div>
        {rules.roles.length === 0 && <span className="hp-muted" style={{ fontSize: 13 }}>No roles: everyone plays without a power.</span>}
      </section>

      {rules.roles.length > 0 && (
        <section>
          <div className="hp-cstep"><span>3</span><b>Handing out roles</b></div>
          <div className="hp-seg">
            <button aria-pressed={rules.roleMode === "random"} disabled={!isHost} onClick={() => set({ roleMode: "random" })} data-testid="custom-mode-random">Dealt at random</button>
            <button aria-pressed={rules.roleMode === "choose"} disabled={!isHost} onClick={() => set({ roleMode: "choose" })} data-testid="custom-mode-choose">Players choose</button>
          </div>
          <div className="hp-row" style={{ gap: 10 }}>
            <span style={{ fontSize: 13 }}>Roles each</span>
            <Stepper value={rules.rolesPerPlayer} min={1} max={rules.roles.length} disabled={!isHost} label="roles each" onChange={n => set({ rolesPerPlayer: n })} testId="custom-roles-each" />
          </div>
          <span className="hp-muted" style={{ fontSize: 13 }}>
            {rules.roleMode === "choose"
              ? `Every player picks their own ${rules.rolesPerPlayer === 1 ? "role" : `${rules.rolesPerPlayer} roles`}, and two players can pick the same one. Anything left unpicked, and bots' roles, are dealt at random.`
              : "No role repeats until every role in play has been dealt."}
          </span>
        </section>
      )}

      <section>
        <div className="hp-cstep"><span>{rules.roles.length > 0 ? 4 : 3}</span><b>Cards</b></div>
        <details className="hp-cards">
          <summary data-testid="custom-cards-toggle">{actionCards} action cards and {moneyCards} money cards · tap to change how many</summary>
        <div className="hp-opts">
          {ACTION_CHOICES.map(a => {
            const n = rules.counts[a.type] ?? 0;
            return (
              <div key={a.type} className="hp-copt" data-on={n > 0} data-testid={`custom-action-${a.type}`}>
                <div><b>{a.name}</b><span>{a.text}</span></div>
                <Stepper value={n} min={0} max={MAX_COPIES} disabled={!isHost} label={`${a.name} cards`} onChange={v => setCount(a.type, v)} />
              </div>
            );
          })}
        </div>
        <div className="hp-label" style={{ marginTop: 4 }}>Money</div>
        <div className="hp-money">
          {MONEY_CHOICES.map(v => (
            <div key={v} className="hp-copt" data-on={(rules.counts[`money_${v}`] ?? 0) > 0}>
              <b>{v}M</b>
              <Stepper value={rules.counts[`money_${v}`] ?? 0} min={0} max={MAX_COPIES} disabled={!isHost} label={`${v}M cards`} onChange={n => setCount(`money_${v}`, n)} testId={`custom-money-${v}`} />
            </div>
          ))}
        </div>
        </details>
        <span className="hp-muted" style={{ fontSize: 13 }}>Properties, wilds and rent cards come from {VARIATIONS[rules.template].name}.</span>
      </section>

      <section>
        <div className="hp-cstep"><span>{rules.roles.length > 0 ? 5 : 4}</span><b>How to win</b></div>
        <div className="hp-row" style={{ gap: 10 }}>
          <span style={{ fontSize: 13 }}>Complete sets to win</span>
          <Stepper value={rules.setsToWin} min={MIN_SETS_TO_WIN} max={MAX_SETS_TO_WIN} disabled={!isHost} label="sets to win" onChange={n => set({ setsToWin: n })} testId="custom-sets-to-win" />
        </div>
      </section>
    </details>
  );
}

/** A seated player's own role picks, when the host lets players choose. */
export function PickRoles({ rules, picked, send }: { rules: CustomRules; picked: RoleType[]; send: (type: any, payload?: any) => void }) {
  const n = rules.rolesPerPlayer;
  // At the limit, a new pick replaces the oldest one
  const pick = (r: RoleType) => send("pick_roles", { roles: picked.includes(r) ? picked.filter(x => x !== r) : [...picked, r].slice(-n) });
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="hp-label">Your roles · pick {n === 1 ? "one" : `up to ${n}`} · {picked.length} of {n} picked</div>
      <div className="hp-opts">
        {rules.roles.map(r => {
          const info = roleInfo(r);
          return (
            <button key={r} className="hp-opt" aria-pressed={picked.includes(r)} onClick={() => pick(r)} data-testid={`pick-role-${r}`}>
              <b>{info?.name}</b>
              <span>{info?.power}</span>
            </button>
          );
        })}
      </div>
      {picked.length < n && <span className="hp-muted" style={{ fontSize: 13 }}>Anything you leave unpicked is dealt at random.</span>}
    </div>
  );
}
