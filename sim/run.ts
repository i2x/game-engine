// Run many fights with no UI and print how they went.
//
//   npm run sim                            every monster, 10,000 fights each
//   npm run sim -- minotaur                one monster
//   npm run sim -- minotaur --games 500 --seed 7 --policy careful

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { applyAction, getAvailableActions, startCombat, type Action, type CombatState } from "../core/src/combat";
import { createDice, type Dice } from "../core/src/dice";
import { parseRulesetYaml, type Ruleset } from "../core/src/ruleset";

const PARTY = ["knight", "mercenary", "nomad", "knave", "emerald-mage", "cleric-of-parrish"];

/** How the simulated player chooses. Kept apart from the game's dice so choosing never changes the rolls. */
type Policy = (state: CombatState, actions: Action[], dice: Dice) => Action;

const pickRandomAttack = (actions: Action[], dice: Dice): Action => {
  const attacks = actions.filter((a) => a.type === "attack");
  return attacks[dice.roll(`d${attacks.length}`).total - 1]!;
};

const POLICIES: Record<string, Policy> = {
  /** Always attack a random monster, even at 1 HP (which costs the attacker their life). */
  reckless: (_state, actions, dice) => pickRandomAttack(actions, dice),
  /** Same, but a character on 1 HP waits instead of sacrificing themselves. */
  careful: (state, actions, dice) => {
    const actor = state.combatants.find((c) => c.id === actions[0]!.actor)!;
    return actor.hp === 1 ? actions.find((a) => a.type === "wait")! : pickRandomAttack(actions, dice);
  },
};

interface FightResult {
  won: boolean;
  deaths: number;
  rounds: number;
}

function fight(ruleset: Ruleset, monster: string, seed: number, policy: Policy): FightResult {
  const dice = createDice(seed);
  const choices = createDice(seed + 1_000_000_007);
  let { state } = startCombat(ruleset, PARTY, monster, dice);
  while (state.winner === null) {
    const action = policy(state, getAvailableActions(state), choices);
    ({ state } = applyAction(state, action, ruleset, dice));
  }
  return {
    won: state.winner === "party",
    deaths: state.combatants.filter((c) => c.side === "party" && c.hp === 0).length,
    rounds: state.round,
  };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      games: { type: "string", default: "10000" },
      seed: { type: "string", default: "1" },
      policy: { type: "string", default: "reckless" },
      ruleset: { type: "string", default: "rulesets/dungeon-floor.yaml" },
    },
  });

  const ruleset = parseRulesetYaml(readFileSync(values.ruleset, "utf8"));
  const games = Number(values.games);
  const firstSeed = Number(values.seed);
  const policy = POLICIES[values.policy];
  if (!policy) throw new Error(`Unknown policy "${values.policy}". Try: ${Object.keys(POLICIES).join(", ")}`);

  const monsters = positionals.length > 0 ? positionals : Object.keys(ruleset.monsters);
  console.log(`${ruleset.name} — ${games.toLocaleString()} fights per monster, policy "${values.policy}", seeds ${firstSeed}..${firstSeed + games - 1}\n`);
  console.log("monster        win rate   losses   avg deaths   avg rounds   worst deaths");

  const started = performance.now();
  for (const monster of monsters) {
    const results = Array.from({ length: games }, (_, i) => fight(ruleset, monster, firstSeed + i, policy));
    const average = (pick: (r: FightResult) => number) => results.reduce((sum, r) => sum + pick(r), 0) / games;
    console.log(
      monster.padEnd(14),
      `${(average((r) => (r.won ? 1 : 0)) * 100).toFixed(1)}%`.padStart(8),
      // Win rate rounds 9,999 wins in 10,000 up to 100.0%, so show the losses as a plain count too.
      String(results.filter((r) => !r.won).length).padStart(8),
      average((r) => r.deaths).toFixed(2).padStart(12),
      average((r) => r.rounds).toFixed(1).padStart(12),
      String(Math.max(...results.map((r) => r.deaths))).padStart(14),
    );
  }
  console.log(`\n(${((performance.now() - started) / 1000).toFixed(1)}s)`);
}

main();
