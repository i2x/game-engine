import { describe, expect, it } from "vitest";
import { createDice } from "../src/dice";

const rollMany = (seed: number, notation: string, times: number) => {
  const dice = createDice(seed);
  return Array.from({ length: times }, () => dice.roll(notation).total);
};

describe("createDice", () => {
  it("gives the same rolls for the same seed", () => {
    expect(rollMany(42, "d6", 50)).toEqual(rollMany(42, "d6", 50));
  });

  it("gives different rolls for different seeds", () => {
    expect(rollMany(1, "d6", 50)).not.toEqual(rollMany(2, "d6", 50));
  });

  it("keeps two games independent even when their rolls are interleaved", () => {
    const alone = rollMany(7, "d6", 20);

    const a = createDice(7);
    const b = createDice(999);
    const interleaved = alone.map(() => {
      b.roll("d6");
      return a.roll("d6").total;
    });

    expect(interleaved).toEqual(alone);
  });

  // Notations taken from the booklet: d6 attacks, d3+1 monster counts,
  // 2d6+6 warrior HP, d6*20 room treasure.
  it.each([
    ["d6", 1, 6],
    ["d3", 1, 3],
    ["d3+1", 2, 4],
    ["2d6+6", 8, 18],
    ["d6*20", 20, 120],
  ])("keeps %s within %i..%i and reaches both ends", (notation, min, max) => {
    const totals = rollMany(123, notation, 2000);
    expect(Math.min(...totals)).toBe(min);
    expect(Math.max(...totals)).toBe(max);
  });

  it("rolls every face of a d6 roughly equally often", () => {
    const totals = rollMany(2026, "d6", 6000);
    for (let face = 1; face <= 6; face++) {
      const count = totals.filter((t) => t === face).length;
      expect(count).toBeGreaterThan(850); // expected 1000 each
      expect(count).toBeLessThan(1150);
    }
  });

  it("returns a readable breakdown of the roll", () => {
    const result = createDice(5).roll("2d6+6");
    expect(result.notation).toBe("2d6+6");
    expect(result.detail).toMatch(/^2d6\+6: \[\d, \d\]\+6 = \d+$/);
    expect(result.detail.endsWith(`= ${result.total}`)).toBe(true);
  });

  it("rejects notation it cannot understand", () => {
    expect(() => createDice(1).roll("banana")).toThrow();
  });
});
