import { describe, expect, it } from "vitest";
import dungeonFloorYaml from "../../rulesets/dungeon-floor.yaml?raw";
import {
  applyAction,
  currentActor,
  getAvailableActions,
  startCombat,
  type Action,
  type CombatEvent,
  type CombatState,
} from "../src/combat";
import { createDice, type Dice } from "../src/dice";
import { parseRulesetYaml } from "../src/ruleset";

const ruleset = parseRulesetYaml(dungeonFloorYaml);
const PARTY = ["knight", "mercenary", "nomad", "knave", "emerald-mage", "cleric-of-parrish"];

/** Play a whole fight, choosing with `choose` (default: attack the first monster listed). */
function playOut(seed: number, monster: string, choose = (actions: Action[]) => actions[0]!) {
  const dice = createDice(seed);
  let { state, events } = startCombat(ruleset, PARTY, monster, dice);
  const all = [...events];
  for (let i = 0; i < 1000 && state.winner === null; i++) {
    ({ state, events } = applyAction(state, choose(getAvailableActions(state)), ruleset, dice));
    all.push(...events);
  }
  return { state, events: all };
}

const attacks = (events: CombatEvent[]) =>
  events.filter((e): e is Extract<CombatEvent, { type: "attack" }> => e.type === "attack");

describe("startCombat", () => {
  it("builds the party from the ruleset, in the order given", () => {
    const { state } = startCombat(ruleset, PARTY, "minotaur", createDice(1));
    const party = state.combatants.filter((c) => c.side === "party");
    expect(party.map((c) => c.id)).toEqual([
      "knight-1", "mercenary-1", "nomad-1", "knave-1", "emerald-mage-1", "cleric-of-parrish-1",
    ]);
    expect(party[0]).toMatchObject({ name: "Knight", tn: 5, maxHp: 14 });
  });

  it("rolls how many monsters are in the room", () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const { state } = startCombat(ruleset, PARTY, "skeletons", createDice(seed));
      counts.add(state.combatants.filter((c) => c.side === "monsters").length);
    }
    expect([...counts].sort((a, b) => a - b)).toEqual([4, 5, 6, 7, 8, 9]); // d6+3
  });

  it("gives duplicate classes their own ids", () => {
    const { state } = startCombat(ruleset, ["knight", "knight"], "minotaur", createDice(1));
    expect(state.combatants.slice(0, 2).map((c) => c.id)).toEqual(["knight-1", "knight-2"]);
  });

  it("rejects ids that are not in the ruleset", () => {
    expect(() => startCombat(ruleset, ["wizard"], "minotaur", createDice(1))).toThrow('Unknown class "wizard"');
    expect(() => startCombat(ruleset, PARTY, "dragon", createDice(1))).toThrow('Unknown monster "dragon"');
  });

  it("keeps state as plain JSON", () => {
    const { state } = startCombat(ruleset, PARTY, "goblins", createDice(1));
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe("getAvailableActions", () => {
  it("offers the next party member an attack on each living monster, or waiting", () => {
    const { state } = startCombat(ruleset, PARTY, "goblins", createDice(3));
    const actor = currentActor(state)!;
    const monsters = state.combatants.filter((c) => c.side === "monsters" && c.hp > 0);

    expect(getAvailableActions(state)).toEqual([
      ...monsters.map((m) => ({ type: "attack", actor: actor.id, target: m.id })),
      { type: "wait", actor: actor.id },
    ]);
  });

  it("offers nothing once the fight is over", () => {
    const { state } = playOut(1, "goblins");
    expect(state.winner).not.toBeNull();
    expect(getAvailableActions(state)).toEqual([]);
  });
});

describe("applyAction", () => {
  it("refuses actions that are not currently legal", () => {
    const dice = createDice(4);
    const { state } = startCombat(ruleset, PARTY, "goblins", dice);
    const notMyTurn: Action = { type: "wait", actor: "cleric-of-parrish-1" };
    const noSuchTarget: Action = { type: "attack", actor: currentActor(state)!.id, target: "dragon-1" };
    expect(() => applyAction(state, notMyTurn, ruleset, dice)).toThrow("Not a legal action");
    expect(() => applyAction(state, noSuchTarget, ruleset, dice)).toThrow("Not a legal action");
  });

  it("does not change the state it was given", () => {
    const dice = createDice(5);
    const { state } = startCombat(ruleset, PARTY, "skeletons", dice);
    const before = JSON.stringify(state);
    applyAction(state, getAvailableActions(state)[0]!, ruleset, dice);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("lets a 1 HP character attack, but they die doing it", () => {
    const dice = createDice(6);
    const start = startCombat(ruleset, PARTY, "skeletons", dice).state;
    // State is plain data, so a test can set up any situation directly.
    const state: CombatState = JSON.parse(JSON.stringify(start));
    const actor = state.combatants.find((c) => c.id === currentActor(state)!.id)!;
    actor.hp = 1;

    const { state: after, events } = applyAction(state, getAvailableActions(state)[0]!, ruleset, dice);
    expect(events).toContainEqual({ type: "sacrificed", id: actor.id });
    expect(after.combatants.find((c) => c.id === actor.id)!.hp).toBe(0);
  });
});

describe("a whole fight", () => {
  it("is the same every time for the same seed and choices", () => {
    expect(playOut(42, "minotaur").events).toEqual(playOut(42, "minotaur").events);
  });

  it("always ends with a winner", () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const monster of ["minotaur", "skeletons", "goblins"]) {
        const { state, events } = playOut(seed, monster);
        expect(state.winner).not.toBeNull();
        expect(events.at(-1)).toEqual({ type: "combat-ended", winner: state.winner });
      }
    }
  });

  it("hits exactly when the d6 is at least the target's TN, and HP never goes below 0", () => {
    for (let seed = 0; seed < 20; seed++) {
      const { state, events } = playOut(seed, "skeletons");
      for (const attack of attacks(events)) {
        expect(attack.hit).toBe(attack.roll.total >= attack.tn);
      }
      for (const c of state.combatants) expect(c.hp).toBeGreaterThanOrEqual(0);
    }
  });

  it("never lets anyone attack or be attacked after they died", () => {
    for (let seed = 0; seed < 50; seed++) {
      const dead = new Set<string>();
      for (const event of playOut(seed, "minotaur").events) {
        if (event.type === "attack") {
          expect(dead.has(event.attacker)).toBe(false);
          expect(dead.has(event.target)).toBe(false);
        }
        if (event.type === "died") dead.add(event.id);
      }
    }
  });

  it("gives every living party member exactly one choice per round, in party order", () => {
    const dice = createDice(8);
    let { state } = startCombat(ruleset, PARTY, "skeletons", dice);
    // Everyone waits, so nobody dies during the party's turn.
    const expected = state.combatants.filter((c) => c.side === "party" && c.hp > 0).map((c) => c.id);
    const actors: string[] = [];
    const round = state.round;
    while (state.winner === null && state.round === round && currentActor(state)) {
      const actor = currentActor(state)!.id;
      actors.push(actor);
      ({ state } = applyAction(state, { type: "wait", actor }, ruleset, dice));
    }
    expect(actors).toEqual(expected);
  });

  it("flips a coin each round for who goes first, and both sides go first sometimes", () => {
    const firsts = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      for (const event of playOut(seed, "skeletons").events) {
        if (event.type === "round-started") firsts.add(event.first);
      }
    }
    expect(firsts).toEqual(new Set(["party", "monsters"]));
  });
});
