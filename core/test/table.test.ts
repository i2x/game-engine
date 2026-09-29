import { describe, expect, it } from "vitest";
import { createDice } from "../src/dice";
import { defineTable, rollOn } from "../src/table";

// Examples from the booklet.
const minotaurDamage = defineTable("minotaur-damage", {
  roll: "d6",
  results: [2, 3, 4, 5, 6, 7],
});

const ancestry = defineTable("ancestry", {
  roll: "d6",
  results: { "1-4": "human", "5-6": "demi-human" },
});

const demiHuman = defineTable("demi-human", {
  roll: "d6",
  results: { "1-3": "dwarf", "4-5": "burrower", "6": "elf" },
});

describe("rollOn", () => {
  it("reads a list table by position: a roll of n gives entry n", () => {
    const dice = createDice(1);
    for (let i = 0; i < 200; i++) {
      const { roll, value } = rollOn(dice, minotaurDamage);
      expect(value).toBe(roll.total + 1); // {2,3,4,5,6,7} is just roll + 1
    }
  });

  it("reads a range table: 1-4 human, 5-6 demi-human", () => {
    const dice = createDice(2);
    for (let i = 0; i < 200; i++) {
      const { roll, value } = rollOn(dice, ancestry);
      expect(value).toBe(roll.total <= 4 ? "human" : "demi-human");
    }
  });

  it("reaches every row of a table", () => {
    const dice = createDice(3);
    const seen = new Set(Array.from({ length: 300 }, () => rollOn(dice, demiHuman).value));
    expect(seen).toEqual(new Set(["dwarf", "burrower", "elf"]));
  });

  it("reports which table was rolled and what the dice showed, for the event log", () => {
    const result = rollOn(createDice(4), ancestry);
    expect(result.table).toBe("ancestry");
    expect(result.roll.notation).toBe("d6");
  });

  it("starts a list at the lowest possible roll, so 2d6 lists begin at 2", () => {
    const table = defineTable("2d6", {
      roll: "2d6",
      results: ["two", "3", "4", "5", "6", "7", "8", "9", "10", "11", "twelve"],
    });
    const dice = createDice(5);
    const values = new Set(Array.from({ length: 2000 }, () => rollOn(dice, table).value));
    expect(values.has("two")).toBe(true);
    expect(values.has("twelve")).toBe(true);
  });

  it("gives the same results for the same seed", () => {
    const run = () => {
      const dice = createDice(99);
      return Array.from({ length: 30 }, () => rollOn(dice, demiHuman).value);
    };
    expect(run()).toEqual(run());
  });
});

describe("defineTable catches mistakes in game data", () => {
  it("rejects a gap", () => {
    expect(() =>
      defineTable("gap", { roll: "d6", results: { "1-3": "a", "5-6": "b" } }),
    ).toThrow('Table "gap": no result for a roll of 4');
  });

  it("rejects an overlap", () => {
    expect(() =>
      defineTable("overlap", { roll: "d6", results: { "1-4": "a", "4-6": "b" } }),
    ).toThrow("2 results for a roll of 4");
  });

  it("rejects a list that is too short for its dice", () => {
    expect(() => defineTable("short", { roll: "d6", results: [1, 2, 3, 4, 5] })).toThrow(
      "no result for a roll of 6",
    );
  });

  it("rejects results that can never be rolled", () => {
    expect(() =>
      defineTable("too-high", { roll: "d6", results: { "1-6": "a", "7": "b" } }),
    ).toThrow("7 can never be rolled on d6 (1-6)");
  });

  it("rejects keys that are not rolls", () => {
    expect(() => defineTable("bad-key", { roll: "d6", results: { "one": "a" } })).toThrow(
      '"one" is not a roll or range',
    );
  });

  it("does not disturb the dice of a game in progress", () => {
    const alone = createDice(7);
    const expected = Array.from({ length: 10 }, () => alone.roll("d6").total);

    const dice = createDice(7);
    const actual = expected.map(() => {
      defineTable("loaded-mid-game", { roll: "2d6", results: { "2-12": "x" } });
      return dice.roll("d6").total;
    });

    expect(actual).toEqual(expected);
  });
});
