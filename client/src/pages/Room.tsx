import { useState, useMemo, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { useGameSocket } from "@/lib/useWebSocket";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getCardImage, getCardName, getCardDef, groupPropertiesByColor, groupBankCards, totalBankValue, COLOR_MAP } from "@/lib/cardUtils";
import { CARD_DEF_MAP } from "@shared/cardDefs";
import { SET_SIZES, PROPERTY_COLORS } from "@shared/schema";
import type { GameCard, PlayerState, PropertyColor, PendingAction, EventLogEntry } from "@shared/schema";

// ========== ROOM CONTEXT ==========
interface RoomContextType {
  gameState: any;
  myVisitorId: string | null;
  myAnimal: any;
  connected: boolean;
  send: (type: string, payload?: any) => void;
}

const RoomContext = createContext<RoomContextType>({
  gameState: null,
  myVisitorId: null,
  myAnimal: null,
  connected: false,
  send: () => {},
});

function useRoom() {
  return useContext(RoomContext);
}

// ========== CARD COMPONENT ==========
function CardImg({ defId, size = "md", onClick, className = "", glow = false, stacked }: {
  defId: string;
  size?: "sm" | "md" | "lg" | "xl";
  onClick?: () => void;
  className?: string;
  glow?: boolean;
  stacked?: number;
}) {
  const src = getCardImage(defId);
  const isHidden = defId === "__hidden__";
  const sizeClasses = {
    sm: "w-16 h-24",
    md: "w-24 h-36",
    lg: "w-32 h-48",
    xl: "w-40 h-60",
  };

  if (isHidden) {
    return (
      <div className={`${sizeClasses[size]} rounded-lg bg-gradient-to-br from-indigo-900 to-purple-900 border-2 border-indigo-700 flex items-center justify-center flex-shrink-0 ${className}`}>
        <span className="text-2xl">⚡</span>
      </div>
    );
  }

  return (
    <div className={`relative inline-block flex-shrink-0 ${onClick ? "cursor-pointer" : ""} ${className}`} onClick={onClick}>
      <img
        src={src}
        alt={getCardName(defId)}
        className={`${sizeClasses[size]} object-cover rounded-lg transition-transform ${onClick ? "hover:scale-105 hover:-translate-y-1" : ""} ${glow ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
        draggable={false}
      />
      {stacked && stacked > 1 && (
        <Badge className="absolute -top-1 -right-1 text-[10px] px-1.5 min-w-0 bg-primary text-primary-foreground">
          x{stacked}
        </Badge>
      )}
    </div>
  );
}

// ========== LOBBY ==========
function LobbyView() {
  const { gameState, myVisitorId, myAnimal, connected, send } = useRoom();
  const { toast } = useToast();

  if (!gameState || !myVisitorId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <div className="animate-pulse text-4xl">⚡</div>
          <p className="text-muted-foreground">Connecting...</p>
        </div>
      </div>
    );
  }

  const seats = gameState.seats || [];
  const isHost = gameState.hostVisitorId === myVisitorId;
  const mySeat = seats.findIndex((s: any) => s?.visitorId === myVisitorId);
  const isSeated = mySeat >= 0;
  const allReady = seats.filter(Boolean).length >= 2 && seats.filter(Boolean).every((s: any) => s.isReady);
  const speedLabels: Record<number, string> = { 30: "Fast", 60: "Normal", 90: "Relaxed" };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4" data-testid="lobby-page">
      <div className="text-center space-y-2 mb-8">
        <h1 className="text-xl font-bold">Room {gameState.roomCode}</h1>
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">{myAnimal?.emoji}</span>
          <span className="text-sm font-medium">{myAnimal?.name}</span>
          {!connected && <Badge variant="destructive" className="text-xs">Disconnected</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3 mb-8 max-w-2xl w-full">
        {Array.from({ length: 5 }, (_, i) => {
          const seat = seats[i];
          const isMySpot = seat?.visitorId === myVisitorId;
          return (
            <button
              key={i}
              onClick={() => {
                if (!seat && !isSeated) send("sit_down", { seatIndex: i });
                else if (isMySpot) send("stand_up");
              }}
              className={`relative rounded-xl p-4 text-center transition-all border-2 ${
                seat ? (isMySpot ? "border-primary bg-primary/10" : "border-border bg-card")
                  : "border-dashed border-muted-foreground/30 bg-muted/30 hover:bg-muted/50 cursor-pointer"
              }`}
              data-testid={`seat-${i}`}
            >
              {seat ? (
                <div className="space-y-1">
                  <div className="text-3xl">{seat.animal.emoji}</div>
                  <div className="text-xs font-medium truncate">{seat.animal.name}</div>
                  {seat.isHost && <Badge variant="secondary" className="text-[10px]">Host</Badge>}
                  {seat.isReady && <Badge className="text-[10px] bg-emerald-500 text-white">Ready</Badge>}
                </div>
              ) : (
                <div className="text-muted-foreground/50">
                  <div className="text-2xl">+</div>
                  <div className="text-[10px]">Seat {i + 1}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-3 w-full max-w-xs">
        {isSeated && (
          <Button
            onClick={() => send("toggle_ready")}
            variant={seats[mySeat]?.isReady ? "secondary" : "default"}
            className="w-full h-11"
            data-testid="button-ready"
          >
            {seats[mySeat]?.isReady ? "Unready" : "Ready Up"}
          </Button>
        )}
        {isHost && (
          <>
            <div className="flex gap-2 justify-center">
              {[30, 60, 90].map((speed) => (
                <Button
                  key={speed}
                  variant={gameState.gameSpeed === speed ? "default" : "outline"}
                  size="sm"
                  onClick={() => send("set_game_speed", { speed })}
                >
                  {speedLabels[speed]}
                </Button>
              ))}
            </div>
            <Button onClick={() => send("start_game")} disabled={!allReady} className="w-full h-11 font-semibold" data-testid="button-start-game">
              Start Game
            </Button>
            {!allReady && <p className="text-xs text-muted-foreground text-center">Need 2+ ready players</p>}
          </>
        )}
      </div>

      <div className="mt-8 text-center">
        <p className="text-xs text-muted-foreground mb-1">Share this link to invite players</p>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            toast({ title: "Copied", description: "Link copied to clipboard" });
          }}
          className="text-sm text-primary hover:underline cursor-pointer"
        >
          Copy Invite Link
        </button>
      </div>
    </div>
  );
}

// ========== GAME BOARD ==========
function GameView() {
  const { gameState, myVisitorId, connected, send } = useRoom();
  const { toast } = useToast();
  const [inspectPlayer, setInspectPlayer] = useState<PlayerState | null>(null);
  const [eventLogOpen, setEventLogOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [colorPicker, setColorPicker] = useState<{ open: boolean; cardDefId: string; colors: PropertyColor[]; purpose: string }>({
    open: false, cardDefId: "", colors: [], purpose: "play"
  });

  const prevChatLen = useRef(0);
  useEffect(() => {
    const len = gameState?.chatMessages?.length ?? 0;
    if (!chatOpen && len > prevChatLen.current) setChatUnread(p => p + (len - prevChatLen.current));
    prevChatLen.current = len;
  }, [gameState?.chatMessages?.length, chatOpen]);
  useEffect(() => { if (chatOpen) setChatUnread(0); }, [chatOpen]);

  if (!gameState || !myVisitorId || !gameState.players) return null;

  const players: PlayerState[] = gameState.players;
  const me = players.find(p => p.visitorId === myVisitorId);
  const currentPlayer = players[gameState.currentTurnIndex];
  const isMyTurn = currentPlayer?.visitorId === myVisitorId;
  const opponents = players.filter(p => p.visitorId !== myVisitorId);
  const pending = gameState.pendingAction as PendingAction | null;
  const opponentLayout = opponents.length === 1 ? "grid-cols-1" : "grid-cols-2";

  // Modal conditions
  const showPayment = pending && ["pay_rent", "pay_debt", "pay_birthday"].includes(pending.type) && pending.targetPlayerId === myVisitorId;
  const showProtego = pending && pending.type === "protego_response" && pending.targetPlayerId === myVisitorId;
  const showTarget = pending && ["choose_steal", "choose_swap", "choose_steal_set", "choose_reducto", "choose_silencio", "pay_debt"].includes(pending.type) && pending.sourcePlayerId === myVisitorId && pending.targetPlayerId === myVisitorId;
  const showDiscard = pending && pending.type === "discard_excess" && pending.targetPlayerId === myVisitorId;
  const showTimeTurner = pending && pending.type === "time_turner_play" && pending.targetPlayerId === myVisitorId;
  const showCedric = pending && pending.type === "cedric_draw_choice" && pending.targetPlayerId === myVisitorId;
  const showHarry = pending && pending.type === "harry_protect" && pending.targetPlayerId === myVisitorId;

  function handlePlay(cardDefId: string) {
    const def = CARD_DEF_MAP[cardDefId];
    if (!def) return;
    if (def.type === "wild") {
      const colors = def.wildColors === "rainbow" ? [...PROPERTY_COLORS] : (Array.isArray(def.wildColors) ? def.wildColors as PropertyColor[] : []);
      setColorPicker({ open: true, cardDefId, colors, purpose: def.wildColors === "rainbow" ? "rainbow" : "play" });
      return;
    }
    if (def.type === "rent") {
      if (def.rentColors === "rainbow") {
        const myColors = new Set<PropertyColor>();
        me?.properties.forEach(c => { const col = c.assignedColor || CARD_DEF_MAP[c.defId]?.color; if (col) myColors.add(col); });
        setColorPicker({ open: true, cardDefId, colors: Array.from(myColors), purpose: "rent" });
      } else if (Array.isArray(def.rentColors)) {
        setColorPicker({ open: true, cardDefId, colors: def.rentColors as PropertyColor[], purpose: "rent" });
      }
      return;
    }
    send("play_card", { cardDefId });
  }

  function handleColorSelect(color: PropertyColor) {
    if (colorPicker.purpose === "flip") send("flip_wild", { cardDefId: colorPicker.cardDefId, newColor: color });
    else if (colorPicker.purpose === "harry") send("harry_protect_color", { color });
    else send("play_card", { cardDefId: colorPicker.cardDefId, targetColor: color });
    setColorPicker({ ...colorPicker, open: false });
  }

  const hasDrawn = gameState.drawnThisTurn === true;
  const canPlay = isMyTurn && !pending && hasDrawn && gameState.actionsUsed < gameState.maxActions;

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden" data-testid="game-board">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold">⚡ {gameState.roomCode}</span>
          {!connected && <Badge variant="destructive" className="text-[10px]">Offline</Badge>}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="text-sm">Turn: <span className="font-semibold text-foreground">{currentPlayer?.animal.emoji} {currentPlayer?.animal.name}</span></span>
          <span className="text-sm">{gameState.actionsUsed}/{gameState.maxActions}</span>
          <span className={`font-mono tabular-nums ${gameState.turnTimer <= 10 ? "text-destructive font-bold" : ""}`}>
            {Math.floor(gameState.turnTimer / 60)}:{String(gameState.turnTimer % 60).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: my properties + bank */}
        <div className="w-80 border-r flex flex-col overflow-y-auto bg-card/30 p-3 shrink-0">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">My Properties</h3>
          {me && (() => {
            const propGroups = groupPropertiesByColor(me.properties);
            if (propGroups.size === 0) return <p className="text-xs text-muted-foreground py-2">No properties yet</p>;
            return Array.from(propGroups.entries()).map(([color, cards]) => {
              const complete = cards.length >= SET_SIZES[color];
              return (
                <div key={color} className="mb-3">
                  <div className="flex items-center gap-1 mb-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${COLOR_MAP[color]?.bg}`} />
                    <span className="text-[11px] font-medium">{COLOR_MAP[color]?.label}</span>
                    <span className="text-[10px] text-muted-foreground">{cards.length}/{SET_SIZES[color]}</span>
                    {complete && <span className="text-[10px]">✅</span>}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {cards.map((card, i) => {
                      const def = CARD_DEF_MAP[card.defId];
                      return (
                        <CardImg
                          key={i}
                          defId={card.defId}
                          size="md"
                          onClick={def?.type === "wild" ? () => {
                            const cols = def.wildColors === "rainbow" ? [...PROPERTY_COLORS] : (Array.isArray(def.wildColors) ? def.wildColors as PropertyColor[] : []);
                            setColorPicker({ open: true, cardDefId: card.defId, colors: cols, purpose: "flip" });
                          } : undefined}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
          <div className="mt-auto pt-3 border-t">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Bank ({me ? totalBankValue(me.bank) : 0}G)
            </h3>
            <div className="flex gap-1 flex-wrap">
              {me && groupBankCards(me.bank).map((g, i) => <CardImg key={i} defId={g.defId} size="sm" stacked={g.count} />)}
            </div>
          </div>
          {me?.role && (
            <div className="mt-2 pt-2 border-t text-[11px]">
              <span className="font-semibold">{me.role.charAt(0).toUpperCase() + me.role.slice(1)}</span>
              {me.isSilenced && <Badge variant="destructive" className="text-[9px] ml-1">Silenced</Badge>}
              {me.protectedColor && <span className="ml-1 text-muted-foreground">🛡️{COLOR_MAP[me.protectedColor]?.label}</span>}
            </div>
          )}
        </div>

        {/* Center */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className={`grid ${opponentLayout} gap-2 p-3 flex-1 overflow-y-auto auto-rows-min`}>
            {opponents.map(opp => (
              <div
                key={opp.visitorId}
                className={`rounded-xl p-3 border-2 transition-all cursor-pointer hover:bg-accent/50 ${
                  opp.visitorId === currentPlayer?.visitorId ? "border-primary bg-primary/5" : "border-border bg-card"
                } ${opp.isSleeping ? "opacity-50" : ""} ${!opp.isConnected ? "opacity-40" : ""}`}
                onClick={() => setInspectPlayer(opp)}
                data-testid={`player-panel-${opp.seatIndex}`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{opp.animal.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{opp.animal.name}</span>
                      {opp.visitorId === currentPlayer?.visitorId && <Badge className="text-[9px] px-1 bg-primary text-primary-foreground animate-pulse">Turn</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {opp.role && <span className={opp.isSilenced ? "line-through" : ""}>{opp.role.charAt(0).toUpperCase() + opp.role.slice(1)}</span>}
                      <span>🏦{totalBankValue(opp.bank)}G</span>
                      <span>🃏{opp.hand.length}</span>
                      {opp.protectedColor && <span>🛡️{COLOR_MAP[opp.protectedColor]?.label}</span>}
                    </div>
                  </div>
                  {opp.isSleeping && <span>💤</span>}
                </div>
                {/* Mini property badges */}
                <div className="flex flex-wrap gap-1 mb-1">
                  {(() => {
                    const pg = groupPropertiesByColor(opp.properties);
                    return Array.from(pg.entries()).map(([color, cards]) => (
                      <div key={color} className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${COLOR_MAP[color]?.bg} text-white ${cards.length >= SET_SIZES[color] ? "ring-1 ring-yellow-400" : ""}`}>
                        {cards.length}/{SET_SIZES[color]}
                      </div>
                    ));
                  })()}
                </div>
                {/* Mini bank */}
                <div className="flex gap-0.5 overflow-hidden">
                  {groupBankCards(opp.bank).slice(0, 5).map((g, i) => <CardImg key={i} defId={g.defId} size="sm" stacked={g.count} />)}
                </div>
              </div>
            ))}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-center gap-3 py-2 border-t bg-card/50 shrink-0">
            {isMyTurn && !hasDrawn && !pending && !showCedric && (
              <Button onClick={() => send("draw_cards")} data-testid="button-draw">Draw Cards</Button>
            )}
            {isMyTurn && hasDrawn && !pending && (
              <Button onClick={() => send("end_turn")} variant="secondary" data-testid="button-end-turn">
                End Turn ({gameState.actionsUsed}/{gameState.maxActions})
              </Button>
            )}
            {showCedric && (
              <>
                <Button onClick={() => send("cedric_choose_source", { source: "deck" })}>Draw from Deck</Button>
                <Button variant="secondary" onClick={() => send("cedric_choose_source", { source: "discard" })}>Draw from Discard</Button>
              </>
            )}
            {showHarry && (
              <>
                <Button onClick={() => {
                  const myColors = new Set<PropertyColor>();
                  me?.properties.forEach(c => { const col = c.assignedColor || CARD_DEF_MAP[c.defId]?.color; if (col) myColors.add(col); });
                  setColorPicker({ open: true, cardDefId: "", colors: Array.from(myColors), purpose: "harry" });
                }}>Protect a Color</Button>
                <Button variant="secondary" onClick={() => send("harry_protect_color", {})}>Skip</Button>
              </>
            )}
            {showProtego && me && (
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-destructive">Action incoming!</span>
                {me.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego") && (
                  <Button onClick={() => send("play_protego")}>🛡️ Protego</Button>
                )}
                <Button variant="secondary" onClick={() => send("decline_protego")}>Accept</Button>
              </div>
            )}
            {!isMyTurn && !pending && (
              <span className="text-xs text-muted-foreground">Waiting for {currentPlayer?.animal.name}...</span>
            )}
          </div>
        </div>

        {/* Right: event log + chat */}
        <div className="w-64 border-l flex flex-col overflow-hidden bg-card/30 p-2 shrink-0">
          <Collapsible open={eventLogOpen} onOpenChange={setEventLogOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-7">
                Events <Badge variant="secondary" className="text-[10px]">{(gameState.eventLog || []).length}</Badge>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ScrollArea className="h-56 border rounded-lg p-1.5 bg-muted/30 text-xs">
                {(gameState.eventLog || []).map((evt: EventLogEntry) => (
                  <div key={evt.id} className="flex items-start gap-1.5 py-0.5">
                    <span>{evt.playerEmoji}</span>
                    <span className="flex-1"><b>{evt.playerName}</b> {evt.message}</span>
                    {evt.cardImage && <img src={`/cards/${evt.cardImage}`} alt="" className="w-8 h-12 rounded object-cover" />}
                  </div>
                ))}
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={chatOpen} onOpenChange={setChatOpen} className="mt-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs h-7">
                Chat
                {chatUnread > 0 && !chatOpen && <Badge className="text-[10px] bg-primary text-primary-foreground">{chatUnread}</Badge>}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border rounded-lg bg-muted/30">
                <ScrollArea className="h-36 p-1.5 text-xs">
                  {(gameState.chatMessages || []).map((msg: any) => (
                    <div key={msg.id} className="py-0.5">
                      {msg.playerEmoji} <b>{msg.playerName}:</b> {msg.message}
                    </div>
                  ))}
                </ScrollArea>
                <div className="flex gap-1 p-1 border-t">
                  <Input
                    placeholder="Type..."
                    className="h-6 text-[11px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                        send("send_chat", { message: (e.target as HTMLInputElement).value.trim() });
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Sleep controls */}
          {gameState.turnTimer <= 0 && currentPlayer?.visitorId !== myVisitorId && !currentPlayer?.isSleeping && (
            <Button variant="outline" size="sm" className="mt-auto text-[10px]" onClick={() => send("put_to_sleep", { targetPlayerId: currentPlayer?.visitorId })}>
              💤 Put to Sleep
            </Button>
          )}
          {me?.isSleeping && (
            <Button className="mt-auto" onClick={() => send("wake_up")}>Wake Up</Button>
          )}
        </div>
      </div>

      {/* My hand */}
      {me && (
        <HandBar hand={me.hand} onPlay={handlePlay} onBank={(id) => send("bank_card", { cardDefId: id })} canPlay={canPlay} />
      )}

      {/* Winner */}
      {gameState.winnerId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-8 text-center space-y-4 max-w-sm">
            <div className="text-6xl">🏆</div>
            <h2 className="text-xl font-bold">{players.find(p => p.visitorId === gameState.winnerId)?.animal.name} Wins!</h2>
          </div>
        </div>
      )}

      {/* Inspect modal */}
      {inspectPlayer && (
        <Dialog open={!!inspectPlayer} onOpenChange={() => setInspectPlayer(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="text-2xl">{inspectPlayer.animal.emoji}</span>
                {inspectPlayer.animal.name}'s Board
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Properties</h4>
                {(() => {
                  const pg = groupPropertiesByColor(inspectPlayer.properties);
                  if (pg.size === 0) return <p className="text-xs text-muted-foreground">None</p>;
                  return Array.from(pg.entries()).map(([color, cards]) => (
                    <div key={color} className="mb-2">
                      <div className="flex items-center gap-1 mb-1">
                        <div className={`w-3 h-3 rounded-full ${COLOR_MAP[color]?.bg}`} />
                        <span className="text-xs font-medium">{COLOR_MAP[color]?.label} {cards.length}/{SET_SIZES[color]} {cards.length >= SET_SIZES[color] ? "✅" : ""}</span>
                      </div>
                      <div className="flex gap-1 flex-wrap">{cards.map((c, j) => <CardImg key={j} defId={c.defId} size="md" />)}</div>
                    </div>
                  ));
                })()}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">Bank ({totalBankValue(inspectPlayer.bank)}G)</h4>
                <div className="flex gap-1 flex-wrap">{groupBankCards(inspectPlayer.bank).map((g, i) => <CardImg key={i} defId={g.defId} size="sm" stacked={g.count} />)}</div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Color picker */}
      {colorPicker.open && (
        <Dialog open={true} onOpenChange={() => setColorPicker({ ...colorPicker, open: false })}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {colorPicker.purpose === "flip" ? "Flip to..." : colorPicker.purpose === "harry" ? "Protect..." : colorPicker.purpose === "rent" ? "Charge rent for..." : "Choose color"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {colorPicker.colors.map(c => (
                <Button key={c} variant="outline" className="h-12 gap-2" onClick={() => handleColorSelect(c)}>
                  <div className={`w-4 h-4 rounded-full ${COLOR_MAP[c]?.bg}`} /> {COLOR_MAP[c]?.label}
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Payment modal */}
      {showPayment && me && pending && (
        <PaymentDialog pending={pending} player={me} send={send} />
      )}

      {/* Target selection */}
      {showTarget && pending && (
        <TargetDialog pending={pending} players={players} myVisitorId={myVisitorId!} send={send} />
      )}

      {/* Discard */}
      {showDiscard && me && pending && (
        <DiscardDialog hand={me.hand} mustDiscard={pending.data?.mustDiscard ?? 0} send={send} />
      )}

      {/* Time-Turner */}
      {showTimeTurner && (
        <TimeTurnerDialog discardPile={gameState.discardPile || []} send={send} myVisitorId={myVisitorId!} />
      )}
    </div>
  );
}

// ========== HAND BAR ==========
function HandBar({ hand, onPlay, onBank, canPlay }: {
  hand: GameCard[];
  onPlay: (defId: string) => void;
  onBank: (defId: string) => void;
  canPlay: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="bg-card border-t-2 border-border p-2 shrink-0 relative z-30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hand</span>
        <Badge variant="outline" className="text-[10px]">{hand.length}</Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ overflow: 'visible' }}>
        {hand.map((card, i) => {
          const def = getCardDef(card.defId);
          const isSel = selected === `${card.defId}-${i}`;
          return (
            <div key={`${card.defId}-${i}`} className="relative flex-shrink-0" style={{ zIndex: isSel ? 50 : 1 }}>
              <CardImg
                defId={card.defId}
                size="lg"
                onClick={() => canPlay && setSelected(isSel ? null : `${card.defId}-${i}`)}
                glow={isSel}
                className={isSel ? "-translate-y-3 transition-transform" : "transition-transform"}
              />
              {isSel && canPlay && def && def.type !== "role" && (
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex gap-1.5 z-50">
                  <Button size="sm" className="text-xs h-8 px-3 shadow-lg" onClick={(e) => { e.stopPropagation(); onPlay(card.defId); setSelected(null); }} data-testid="button-play-card">
                    Play
                  </Button>
                  {(def.value ?? 0) > 0 && (
                    <Button size="sm" variant="outline" className="text-xs h-8 px-3 shadow-lg" onClick={(e) => { e.stopPropagation(); onBank(card.defId); setSelected(null); }} data-testid="button-bank-card">
                      Bank
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {hand.length === 0 && <p className="text-xs text-muted-foreground py-6">Empty hand</p>}
      </div>
    </div>
  );
}

// ========== PAYMENT DIALOG ==========
function PaymentDialog({ pending, player, send }: { pending: PendingAction; player: PlayerState; send: (t: string, p?: any) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const amount = pending.amount ?? 0;
  const selectedValue = selected.reduce((s, id) => s + (CARD_DEF_MAP[id]?.value ?? 0), 0);
  const hasProtego = player.hand.some(c => CARD_DEF_MAP[c.defId]?.actionType === "protego");
  const allCards = [...player.bank, ...player.properties];

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Pay {amount}G</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Selected: {selectedValue}G / {amount}G</p>
        {player.bank.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">Bank</h4>
            <div className="flex gap-1 flex-wrap">
              {player.bank.map((c, i) => (
                <CardImg key={i} defId={c.defId} size="sm" onClick={() => setSelected(p => p.includes(c.defId) ? p.filter(x => x !== c.defId) : [...p, c.defId])} glow={selected.includes(c.defId)} />
              ))}
            </div>
          </div>
        )}
        {player.properties.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">Properties</h4>
            <div className="flex gap-1 flex-wrap">
              {player.properties.map((c, i) => (
                <CardImg key={i} defId={c.defId} size="sm" onClick={() => setSelected(p => p.includes(c.defId) ? p.filter(x => x !== c.defId) : [...p, c.defId])} glow={selected.includes(c.defId)} />
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          {hasProtego && <Button variant="outline" className="flex-1" onClick={() => send("play_protego")}>🛡️ Protego</Button>}
          <Button className="flex-1" disabled={selectedValue < amount && allCards.length > 0} onClick={() => { send("pay_with_cards", { cardDefIds: selected }); setSelected([]); }}>
            Pay {selectedValue}G
          </Button>
          {allCards.length === 0 && <Button variant="secondary" className="flex-1" onClick={() => send("pay_with_cards", { cardDefIds: [] })}>Nothing to pay</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========== TARGET DIALOG ==========
function TargetDialog({ pending, players, myVisitorId, send }: { pending: PendingAction; players: PlayerState[]; myVisitorId: string; send: (t: string, p?: any) => void }) {
  const [tp, setTp] = useState<string | null>(null);
  const targets = players.filter(p => p.visitorId !== myVisitorId);
  const labels: Record<string, string> = {
    choose_steal: "Choose a property to steal",
    choose_swap: "Choose properties to swap",
    choose_steal_set: "Choose a complete set",
    choose_reducto: "Choose a card to destroy",
    choose_silencio: "Choose who to silence",
    pay_debt: "Choose who owes 5G",
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{labels[pending.type] || "Choose target"}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {targets.map(p => (
            <div key={p.visitorId} className="space-y-1">
              <Button variant={tp === p.visitorId ? "default" : "outline"} className="w-full justify-start gap-2" onClick={() => {
                setTp(p.visitorId);
                if (["choose_silencio", "pay_debt"].includes(pending.type)) send("choose_target", { targetPlayerId: p.visitorId });
              }}>
                {p.animal.emoji} {p.animal.name}
              </Button>
              {tp === p.visitorId && ["choose_steal", "choose_reducto", "choose_swap"].includes(pending.type) && (
                <div className="ml-4 flex gap-1 flex-wrap">
                  {p.properties.map((c, i) => <CardImg key={i} defId={c.defId} size="sm" onClick={() => send("choose_target", { targetPlayerId: p.visitorId, targetCardDefId: c.defId })} />)}
                  {pending.type === "choose_reducto" && p.bank.map((c, i) => <CardImg key={`b${i}`} defId={c.defId} size="sm" onClick={() => send("choose_target", { targetPlayerId: p.visitorId, targetCardDefId: c.defId })} />)}
                </div>
              )}
              {tp === p.visitorId && pending.type === "choose_steal_set" && (
                <div className="ml-4 flex gap-1 flex-wrap">
                  {(Object.keys(SET_SIZES) as PropertyColor[]).map(color => {
                    const count = p.properties.filter(c => (c.assignedColor || CARD_DEF_MAP[c.defId]?.color) === color).length;
                    if (count < SET_SIZES[color]) return null;
                    return (
                      <Button key={color} size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => send("choose_target", { targetPlayerId: p.visitorId, targetCardDefId: color })}>
                        <div className={`w-3 h-3 rounded-full ${COLOR_MAP[color]?.bg}`} /> {COLOR_MAP[color]?.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========== DISCARD DIALOG ==========
function DiscardDialog({ hand, mustDiscard, send }: { hand: GameCard[]; mustDiscard: number; send: (t: string, p?: any) => void }) {
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Discard {mustDiscard} cards</DialogTitle></DialogHeader>
        <div className="flex gap-2 flex-wrap">{hand.map((c, i) => (
          <CardImg key={i} defId={c.defId} size="md" onClick={() => setSelected(p => p.includes(c.defId) ? p.filter(x => x !== c.defId) : p.length < mustDiscard ? [...p, c.defId] : p)} glow={selected.includes(c.defId)} />
        ))}</div>
        <Button disabled={selected.length !== mustDiscard} onClick={() => { send("discard_cards", { cardDefIds: selected }); setSelected([]); }}>
          Discard {selected.length}/{mustDiscard}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ========== TIME-TURNER DIALOG ==========
function TimeTurnerDialog({ discardPile, send, myVisitorId }: { discardPile: GameCard[]; send: (t: string, p?: any) => void; myVisitorId: string }) {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent onPointerDownOutside={(e) => e.preventDefault()} className="max-w-lg">
        <DialogHeader><DialogTitle>Time-Turner: pick from discard</DialogTitle></DialogHeader>
        <div className="flex gap-2 flex-wrap max-h-60 overflow-y-auto">
          {discardPile.filter(c => c.defId !== "__hidden__").map((c, i) => (
            <CardImg key={i} defId={c.defId} size="md" onClick={() => send("choose_target", { targetPlayerId: myVisitorId, targetCardDefId: c.defId })} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========== MAIN ROOM COMPONENT ==========
export default function Room({ roomCode }: { roomCode: string }) {
  const socket = useGameSocket(roomCode);
  const { toast } = useToast();

  useEffect(() => {
    if (socket.lastError) {
      toast({ title: "Error", description: socket.lastError, variant: "destructive" });
    }
  }, [socket.lastError, toast]);

  return (
    <RoomContext.Provider value={socket}>
      {socket.gameState?.status === "playing" || socket.gameState?.players ? <GameView /> : <LobbyView />}
    </RoomContext.Provider>
  );
}
