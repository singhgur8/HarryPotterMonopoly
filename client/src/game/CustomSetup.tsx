import type { ActionType, CustomRules, RoleType } from "@shared/schema";
import { ACTION_CHOICES, ALL_ROLES, NON_CLASSIC_ACTIONS, DEFAULT_CUSTOM_RULES, customDeck } from "@shared/variations";
import { roleInfo } from "./helpers";

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter(x => x !== item) : [...list, item]);

/** The host's settings for a Custom game: roles in play, how they're handed out, and action cards. */
export function CustomSetup({ rules, isHost, send }: { rules: CustomRules; isHost: boolean; send: (type: any, payload?: any) => void }) {
  const set = (change: Partial<CustomRules>) => send("set_custom_rules", change);
  const deckSize = customDeck(rules).length;
  const isDefault = JSON.stringify(rules) === JSON.stringify(DEFAULT_CUSTOM_RULES);

  return (
    <details className="hp-custom" open>
      <summary>
        <span className="hp-label">Custom rules{isHost ? "" : " · set by the host"}</span>
        <span className="hp-muted">
          {rules.roles.length} role{rules.roles.length === 1 ? "" : "s"} · {rules.roleMode === "choose" ? "players choose" : `${rules.rolesPerPlayer} dealt each`} · {rules.actions.length} action cards · {deckSize}-card deck
        </span>
      </summary>

      <section>
        <div className="hp-cstep"><span>1</span><b>Roles in play</b></div>
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

      <section>
        <div className="hp-cstep"><span>2</span><b>Handing out roles</b></div>
        <div className="hp-seg">
          <button aria-pressed={rules.roleMode === "random"} disabled={!isHost} onClick={() => set({ roleMode: "random" })} data-testid="custom-mode-random">Dealt at random</button>
          <button aria-pressed={rules.roleMode === "choose"} disabled={!isHost} onClick={() => set({ roleMode: "choose" })} data-testid="custom-mode-choose">Players choose</button>
        </div>
        {rules.roleMode === "random" ? (
          <div className="hp-row" style={{ gap: 10 }}>
            <span style={{ fontSize: 13 }}>Roles each</span>
            <div className="hp-stepper">
              <button disabled={!isHost || rules.rolesPerPlayer <= 1} onClick={() => set({ rolesPerPlayer: rules.rolesPerPlayer - 1 })} aria-label="Fewer roles each">−</button>
              <b data-testid="custom-roles-each">{rules.rolesPerPlayer}</b>
              <button disabled={!isHost || rules.rolesPerPlayer >= rules.roles.length} onClick={() => set({ rolesPerPlayer: rules.rolesPerPlayer + 1 })} aria-label="More roles each">+</button>
            </div>
          </div>
        ) : (
          <span className="hp-muted" style={{ fontSize: 13 }}>Each player picks as many roles as they like below. Bots get one at random.</span>
        )}
      </section>

      <section>
        <div className="hp-cstep"><span>3</span><b>Action cards</b></div>
        <div className="hp-opts">
          {ACTION_CHOICES.map(a => (
            <button key={a.type} className="hp-opt" aria-pressed={rules.actions.includes(a.type)} disabled={!isHost} onClick={() => set({ actions: toggle(rules.actions, a.type) as ActionType[] })} data-testid={`custom-action-${a.type}`}>
              <b>{a.name} <small>×{a.copies}</small>{NON_CLASSIC_ACTIONS.includes(a.type) && <em className="hp-chip wait">Extra</em>}</b>
              <span>{a.text}</span>
            </button>
          ))}
        </div>
        <span className="hp-muted" style={{ fontSize: 13 }}>Money, properties, wilds and rent cards are always in the deck.</span>
      </section>

      {isHost && !isDefault && (
        <button className="hp-linkbtn" style={{ justifySelf: "start", fontSize: 13 }} onClick={() => set(DEFAULT_CUSTOM_RULES)}>Reset to the defaults</button>
      )}
    </details>
  );
}

/** A seated player's own role picks, when the host lets players choose. */
export function PickRoles({ rules, picked, send }: { rules: CustomRules; picked: RoleType[]; send: (type: any, payload?: any) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="hp-label">Your roles · pick as many as you like</div>
      {rules.roles.length === 0
        ? <span className="hp-muted" style={{ fontSize: 13 }}>The host hasn't put any roles in play.</span>
        : (
          <div className="hp-opts">
            {rules.roles.map(r => {
              const info = roleInfo(r);
              return (
                <button key={r} className="hp-opt" aria-pressed={picked.includes(r)} onClick={() => send("pick_roles", { roles: toggle(picked, r) })} data-testid={`pick-role-${r}`}>
                  <b>{info?.name}</b>
                  <span>{info?.power}</span>
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}
