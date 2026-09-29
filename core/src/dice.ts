import { DiceRoll, NumberGenerator } from "@dice-roller/rpg-dice-roller";
import { MersenneTwister19937 } from "random-js";

/** The outcome of one roll, kept as data so the UI and the event log can show it later. */
export interface RollResult {
  notation: string;
  total: number;
  /** Human-readable breakdown, e.g. "2d6+6: [3, 5]+6 = 14". */
  detail: string;
}

export interface Dice {
  readonly seed: number;
  /** Roll dice notation such as "d6", "d3+1", "2d6+6" or "d6*20". */
  roll(notation: string): RollResult;
}

/**
 * Create a dice roller for one game. The same seed always produces the same sequence of rolls,
 * which is what makes replays, tests and simulations reproducible.
 */
export function createDice(seed: number): Dice {
  const engine = MersenneTwister19937.seed(seed);

  return {
    seed,
    roll(notation) {
      // The library shares one global number generator, so point it at this game's own engine
      // before every roll. Otherwise two games running side by side would steal each other's numbers.
      NumberGenerator.generator.engine = engine;
      const result = new DiceRoll(notation);
      return { notation, total: result.total, detail: result.output };
    },
  };
}
