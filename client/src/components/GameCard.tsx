import type { CSSProperties, ReactNode } from "react";
import type { CardDef, PropertyColor } from "@shared/schema";
import { SET_STYLE, SET_SIZES, RENT_TABLE } from "@shared/schema";
import { CARD_DEF_MAP } from "@shared/cardDefs";
import { CARD_ART, RENT_ART } from "@/lib/cardArt";
import "./game-card.css";

// Pixel widths for each size. The card picks its level of detail from its own
// width: full at 120px and up, compact from 64px, colour-and-value chip below.
export const CARD_WIDTHS = { xs: 32, sm: 64, md: 96, lg: 148, xl: 180 } as const;
export type CardSize = keyof typeof CARD_WIDTHS;

const METALS: Record<number, [string, string]> = {
  1: ["#9c5f36", "Bronze"],
  2: ["#7f8891", "Silver"],
  3: ["#b48a22", "Gold"],
  4: ["#2b7d53", "Emerald"],
  5: ["#2d5aa8", "Sapphire"],
  10: ["#6f4699", "Amethyst"],
};

const TARGET_LABEL = { self: "You", one: "1 player", all: "All players", reaction: "Reaction" } as const;

const GROUND = '<path class="ground" d="M5 33h38"/>';

function Art({ svg, ground = false }: { svg?: string; ground?: boolean }) {
  if (!svg) return <div className="art" />;
  return (
    <div className="art">
      <svg viewBox="0 0 48 36" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg + (ground ? GROUND : "") }} />
    </div>
  );
}

function Coin({ value }: { value: number }) {
  if (value <= 0) return null;
  return <div className="coin">{value}<small>G</small></div>;
}

function Band({ kicker, name, short, className = "", style }: { kicker: string; name: string; short?: string; className?: string; style?: CSSProperties }) {
  return (
    <header className={`band ${className}`} style={style}>
      <span className="kicker">{kicker}</span>
      <span className="name">{name}</span>
      <span className="short">{short ?? name}</span>
    </header>
  );
}

const setVars = (c: PropertyColor) => ({
  "--set": SET_STYLE[c].fill,
  "--on": SET_STYLE[c].on,
  "--tint": SET_STYLE[c].tint,
  "--glyph": SET_STYLE[c].ink,
}) as CSSProperties;

const rentLine = (c: PropertyColor) => `${RENT_TABLE[c].join(" · ")}G`;
const firstWord = (c: PropertyColor) => SET_STYLE[c].label.split(" ")[0];

function Pips({ count }: { count: number }) {
  return <span className="pips">{Array.from({ length: count }, (_, i) => <i key={i} />)}</span>;
}

function PropertyFace({ def }: { def: CardDef }) {
  const c = def.color!;
  const set = SET_STYLE[c];
  const size = SET_SIZES[c];
  const rent = RENT_TABLE[c];
  return (
    <div className="gc-face t-property" style={setVars(c)}>
      <Coin value={def.value} />
      <Band kicker={set.label} name={def.name} short={def.shortName} />
      <Art svg={CARD_ART[def.name]} ground />
      <div className="body">
        <ul className="ladder">
          {rent.map((r, i) => (
            <li key={i} className={i === rent.length - 1 ? "full" : ""}>
              <span className="dots">{Array.from({ length: size }, (_, j) => <i key={j} className={j <= i ? "on" : ""} />)}</span>
              <span>{r}G</span>
            </li>
          ))}
        </ul>
      </div>
      <footer className="foot"><span className="ftxt">Property</span><Pips count={size} /></footer>
    </div>
  );
}

function WildFace({ def }: { def: CardDef }) {
  if (def.wildColors === "rainbow") {
    return (
      <div className="gc-face t-property" style={{ "--set": "var(--ink)", "--on": "#fff", "--tint": "#efe7f5", "--glyph": "#5d3f93" } as CSSProperties}>
        <Band kicker="Wild" name={def.name} short={def.shortName} className="gc-rainbow gc-rainbow-text" style={{ paddingLeft: "6cqw" }} />
        <Art svg={CARD_ART[def.name]} />
        <div className="body"><p className="text">{def.text}</p></div>
        <footer className="foot"><span className="ftxt">Can't be banked</span><span>Any</span></footer>
      </div>
    );
  }
  const [a, b] = def.wildColors as [PropertyColor, PropertyColor];
  const half = (c: PropertyColor, pos: "top" | "bot") => (
    <div className={`half ${pos}`} style={{ "--hset": SET_STYLE[c].fill, "--hon": SET_STYLE[c].on } as CSSProperties}>
      <Coin value={def.value} />
      <span className="kicker">Wild</span>
      <span className="name">{SET_STYLE[c].label}</span>
      <span className="short">{firstWord(c)}</span>
      <span className="mini">{rentLine(c)}</span>
    </div>
  );
  return (
    <div className="gc-face t-wild">
      {half(a, "top")}
      {half(b, "bot")}
      <span className="seal">Wild</span>
    </div>
  );
}

function RentFace({ def }: { def: CardDef }) {
  const any = def.rentColors === "rainbow";
  const pair = any ? null : (def.rentColors as [PropertyColor, PropertyColor]);
  const label = pair ? `${SET_STYLE[pair[0]].label} / ${SET_STYLE[pair[1]].label}` : "Any colour";
  const short = pair ? `${firstWord(pair[0])} / ${firstWord(pair[1])}` : "Any";
  const bandStyle = pair ? { background: `linear-gradient(135deg, ${SET_STYLE[pair[0]].fill} 50%, ${SET_STYLE[pair[1]].fill} 50%)` } : undefined;
  return (
    <div className="gc-face t-rent" style={{ "--set": "var(--ink)", "--on": "#fff", "--tint": "var(--paper-2)", "--glyph": "var(--ink)" } as CSSProperties}>
      <Coin value={def.value} />
      <Band kicker="Rent" name={label} short={short} className={`gc-rainbow-text ${any ? "gc-rainbow" : ""}`} style={bandStyle} />
      <Art svg={RENT_ART} />
      <div className="body">
        <p className="text">
          {any ? "Every other player pays you rent for any one colour you own." : "Every other player pays you rent for one of these colours."}
        </p>
        {pair && (
          <div className="rentmini">
            {pair.map((c) => <div key={c}><b style={{ background: SET_STYLE[c].fill }} />{SET_STYLE[c].label} {rentLine(c)}</div>)}
          </div>
        )}
      </div>
      <footer className="foot"><span className="ftxt">Rent</span><span>All players</span></footer>
    </div>
  );
}

function ActionFace({ def }: { def: CardDef }) {
  return (
    <div className="gc-face t-action" style={{ "--set": "var(--ink)", "--on": "var(--gold-hi)" } as CSSProperties}>
      <Coin value={def.value} />
      <Band kicker="Action" name={def.name} short={def.shortName} />
      <Art svg={CARD_ART[def.name]} />
      <div className="body"><p className="text">{def.text}</p></div>
      <footer className="foot">
        <span className="ftxt">Action</span>
        {def.target && <span className="chip-tag">{TARGET_LABEL[def.target]}</span>}
      </footer>
    </div>
  );
}

function MoneyFace({ def }: { def: CardDef }) {
  const [fill, metal] = METALS[def.value] ?? ["#7f8891", "Money"];
  return (
    <div className="gc-face t-money" style={{ "--set": fill, "--on": "#fff" } as CSSProperties}>
      <Coin value={def.value} />
      <div className="art">
        <div>
          <div className="num">{def.value}</div>
          <div className="unit">{def.value === 1 ? "Galleon" : "Galleons"}</div>
        </div>
      </div>
      <footer className="foot"><span className="ftxt">Money</span><span>{metal}</span></footer>
    </div>
  );
}

function RoleFace({ def }: { def: CardDef }) {
  return (
    <div className="gc-face t-role" style={{ "--set": "var(--plum)", "--on": "var(--gold-hi)" } as CSSProperties}>
      <Band kicker="Role" name={def.name} short={def.shortName} style={{ paddingLeft: "6cqw" }} />
      <Art svg={CARD_ART[def.name]} />
      <div className="body"><p className="text">{def.text ?? def.rolePower}</p></div>
      <footer className="foot"><span className="ftxt">Role</span><span>Not in the deck</span></footer>
    </div>
  );
}

function BackFace() {
  return <div className="gc-face t-back"><div className="crest">W</div></div>;
}

export function CardFace({ defId }: { defId: string }) {
  const def = CARD_DEF_MAP[defId];
  if (!def) return <BackFace />;
  switch (def.type) {
    case "property": return <PropertyFace def={def} />;
    case "wild": return <WildFace def={def} />;
    case "rent": return <RentFace def={def} />;
    case "action": return <ActionFace def={def} />;
    case "money": return <MoneyFace def={def} />;
    case "role": return <RoleFace def={def} />;
  }
}

// A card at a fixed size. Unknown ids (including "__hidden__") show the card back.
export function GameCard({ defId, size = "md", label, children }: { defId: string; size?: CardSize; label?: string; children?: ReactNode }) {
  return (
    <div className="gc" style={{ "--w": `${CARD_WIDTHS[size]}px` } as CSSProperties} role="img" aria-label={label}>
      <CardFace defId={defId} />
      {children}
    </div>
  );
}
