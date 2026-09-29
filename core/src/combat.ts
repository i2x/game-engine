import type { Dice, RollResult } from "./dice";
import type { Damage, Ruleset } from "./ruleset";
import { rollOn } from "./table";

// ---------------------------------------------------------------------------
// State. Plain JSON only: no classes, functions or Maps, so it can be saved,
// sent anywhere, and replayed.
// ---------------------------------------------------------------------------

export type Side = "party" | "monsters";

export interface Combatant {
  id: string;
  /** The class or monster in the ruleset this was made from. */
  def: string;
  side: Side;
  name: string;
  tags: string[];
  tn: number;
  hp: number;
  maxHp: number;
}

export interface CombatState {
  round: number;
  /** Which side acts first and which second this round (decided by a coin flip). */
  order: [Side, Side];
  /** 0 while the first side in `order` acts, 1 while the second does. */
  turn: 0 | 1;
  /** Party members who have already acted this turn. */
  acted: string[];
  /** Party first, in the order they were created, which is also the order they act in. */
  combatants: Combatant[];
  winner: Side | null;
}

// ---------------------------------------------------------------------------
// Choices the player can make, and what happened as a result.
// ---------------------------------------------------------------------------

export type Action =
  | { type: "attack"; actor: string; target: string }
  | { type: "wait"; actor: string };

export type CombatEvent =
  | { type: "combat-started"; party: string[]; monsters: string[]; count: RollResult }
  | { type: "round-started"; round: number; first: Side; coin: RollResult }
  | { type: "attack"; attacker: string; target: string; roll: RollResult; tn: number; hit: false }
  | {
      type: "attack";
      attacker: string;
      target: string;
      roll: RollResult;
      tn: number;
      hit: true;
      damage: number;
      damageRoll: RollResult;
    }
  | { type: "wait"; actor: string }
  | { type: "sacrificed"; id: string }
  | { type: "died"; id: string }
  | { type: "combat-ended"; winner: Side };

/** A new state plus everything that happened on the way to it. */
export interface Step {
  state: CombatState;
  events: CombatEvent[];
}

// ---------------------------------------------------------------------------
// The three functions everything else (UI, simulator, tests) is built on.
// ---------------------------------------------------------------------------

/**
 * Put a party and a room of monsters into a fight. Runs until the first decision the player
 * has to make, so if the monsters win the coin flip they have already attacked.
 */
export function startCombat(ruleset: Ruleset, partyClassIds: string[], monsterId: string, dice: Dice): Step {
  const counts = new Map<string, number>();
  const nextId = (def: string) => {
    const n = (counts.get(def) ?? 0) + 1;
    counts.set(def, n);
    return `${def}-${n}`;
  };

  const party = partyClassIds.map((classId): Combatant => {
    const def = ruleset.classes[classId];
    if (!def) throw new Error(`Unknown class "${classId}"`);
    const { name, tags, tn, hp } = def;
    return { id: nextId(classId), def: classId, side: "party", name, tags, tn, hp, maxHp: hp };
  });

  const monsterDef = ruleset.monsters[monsterId];
  if (!monsterDef) throw new Error(`Unknown monster "${monsterId}"`);
  const count = dice.roll(monsterDef.count);
  const monsters = Array.from({ length: count.total }, (): Combatant => {
    const { name, tags, tn, hp } = monsterDef;
    return { id: nextId(monsterId), def: monsterId, side: "monsters", name, tags, tn, hp, maxHp: hp };
  });

  const state: CombatState = {
    round: 0,
    order: ["party", "monsters"],
    turn: 0,
    acted: [],
    combatants: [...party, ...monsters],
    winner: null,
  };
  const events: CombatEvent[] = [
    { type: "combat-started", party: party.map((c) => c.id), monsters: monsters.map((c) => c.id), count },
  ];
  checkForWinner(state, events); // a count like "d3-1" can roll an empty room
  if (state.winner === null) {
    startRound(state, dice, events);
    advance(state, ruleset, dice, events);
  }
  return { state, events };
}

/** What the player may do right now: one choice for the party member whose turn it is. */
export function getAvailableActions(state: CombatState): Action[] {
  const actor = currentActor(state);
  if (!actor) return [];
  const attacks = living(state, "monsters").map(
    (target): Action => ({ type: "attack", actor: actor.id, target: target.id }),
  );
  return [...attacks, { type: "wait", actor: actor.id }];
}

/** Carry out one choice, then keep playing until the next choice is needed or the fight ends. */
export function applyAction(state: CombatState, action: Action, ruleset: Ruleset, dice: Dice): Step {
  if (!getAvailableActions(state).some((legal) => sameAction(legal, action))) {
    throw new Error(`Not a legal action right now: ${JSON.stringify(action)}`);
  }

  // Never change the state we were given; callers may keep it for undo or replays.
  const next: CombatState = JSON.parse(JSON.stringify(state));
  const events: CombatEvent[] = [];
  const actor = find(next, action.actor);

  if (action.type === "attack") {
    // Booklet: a character at 1 HP "cannot attack without sacrificing themselves".
    const sacrifice = actor.hp === 1;
    resolveAttack(ruleset, dice, actor, find(next, action.target), events);
    if (sacrifice) {
      actor.hp = 0;
      events.push({ type: "sacrificed", id: actor.id }, { type: "died", id: actor.id });
    }
    // Decide the winner only once the whole action has played out, so a sacrifice that
    // kills the last monster is still recorded before the fight ends.
    checkForWinner(next, events);
  } else {
    events.push({ type: "wait", actor: actor.id });
  }

  next.acted.push(actor.id);
  advance(next, ruleset, dice, events);
  return { state: next, events };
}

/** The party member who must choose next, if it is the party's turn. */
export function currentActor(state: CombatState): Combatant | undefined {
  if (state.winner !== null || state.order[state.turn] !== "party") return undefined;
  return living(state, "party").find((c) => !state.acted.includes(c.id));
}

// ---------------------------------------------------------------------------
// Rules.
// ---------------------------------------------------------------------------

/** Move the fight forward through everything that needs no decision. */
function advance(state: CombatState, ruleset: Ruleset, dice: Dice, events: CombatEvent[]): void {
  while (state.winner === null) {
    const side = state.order[state.turn];
    if (side === "party" && currentActor(state)) return; // waiting for the player
    if (side === "monsters") {
      monstersAttack(state, ruleset, dice, events);
      if (state.winner !== null) return;
    }

    // This side is done.
    if (state.turn === 0) {
      state.turn = 1;
      state.acted = [];
    } else {
      startRound(state, dice, events);
    }
  }
}

function startRound(state: CombatState, dice: Dice, events: CombatEvent[]): void {
  // Booklet: "Roll to see who goes first before each round, or flip a coin."
  const coin = dice.roll("d2");
  state.round += 1;
  state.order = coin.total === 1 ? ["party", "monsters"] : ["monsters", "party"];
  state.turn = 0;
  state.acted = [];
  events.push({ type: "round-started", round: state.round, first: state.order[0], coin });
}

/** Booklet: monsters have no order on their turn. Each one picks a random living party member. */
function monstersAttack(state: CombatState, ruleset: Ruleset, dice: Dice, events: CombatEvent[]): void {
  for (const monster of living(state, "monsters")) {
    const targets = living(state, "party");
    if (targets.length === 0) return;
    const pick = dice.roll(`d${targets.length}`).total - 1;
    resolveAttack(ruleset, dice, monster, targets[pick]!, events);
    checkForWinner(state, events);
    if (state.winner !== null) return;
  }
}

function resolveAttack(
  ruleset: Ruleset,
  dice: Dice,
  attacker: Combatant,
  target: Combatant,
  events: CombatEvent[],
): void {
  // Booklet: the target number is "what an opponent must roll on a d6" to hit. We read that as
  // "at least the TN", otherwise a TN 6 monster could never be hit.
  const roll = dice.roll("d6");
  const base = { type: "attack", attacker: attacker.id, target: target.id, roll, tn: target.tn } as const;
  if (roll.total < target.tn) {
    events.push({ ...base, hit: false });
    return;
  }

  const { damage, damageRoll } = rollDamage(dice, damageOf(ruleset, attacker));
  target.hp = Math.max(0, target.hp - damage);
  events.push({ ...base, hit: true, damage, damageRoll });
  if (target.hp === 0) events.push({ type: "died", id: target.id });
}

function rollDamage(dice: Dice, damage: Damage): { damage: number; damageRoll: RollResult } {
  if (damage.kind === "dice") {
    const roll = dice.roll(damage.notation);
    return { damage: roll.total, damageRoll: roll };
  }
  const result = rollOn(dice, damage.table);
  return { damage: result.value, damageRoll: result.roll };
}

function damageOf(ruleset: Ruleset, combatant: Combatant): Damage {
  const def = combatant.side === "party" ? ruleset.classes[combatant.def] : ruleset.monsters[combatant.def];
  if (!def) throw new Error(`"${combatant.id}" refers to "${combatant.def}", which is not in the ruleset`);
  return def.damage;
}

function checkForWinner(state: CombatState, events: CombatEvent[]): void {
  if (state.winner !== null) return;
  if (living(state, "monsters").length === 0) state.winner = "party";
  else if (living(state, "party").length === 0) state.winner = "monsters";
  else return;
  events.push({ type: "combat-ended", winner: state.winner });
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function living(state: CombatState, side: Side): Combatant[] {
  return state.combatants.filter((c) => c.side === side && c.hp > 0);
}

function find(state: CombatState, id: string): Combatant {
  const combatant = state.combatants.find((c) => c.id === id);
  if (!combatant) throw new Error(`No combatant "${id}"`);
  return combatant;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type || a.actor !== b.actor) return false;
  return a.type !== "attack" || (b.type === "attack" && a.target === b.target);
}
