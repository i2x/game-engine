import { describe, expect, it } from "vitest";
import dungeonFloorYaml from "../../rulesets/dungeon-floor.yaml?raw";
import { createDice } from "../src/dice";
import { loadRuleset, parseRulesetYaml, RulesetError } from "../src/ruleset";
import { rollOn } from "../src/table";

describe("the Dungeon Floor ruleset file", () => {
  const ruleset = parseRulesetYaml(dungeonFloorYaml);

  it("loads the human classes", () => {
    expect(Object.keys(ruleset.classes)).toHaveLength(6);
    expect(ruleset.classes.knight).toMatchObject({
      id: "knight",
      tags: ["human", "warrior"],
      tn: 5,
      hp: 14,
      damage: { kind: "dice", notation: "d6+1" },
      spells: 0,
    });
    expect(ruleset.classes["emerald-mage"]?.spells).toBe(5);
  });

  it("loads monsters with their damage tables", () => {
    const minotaur = ruleset.monsters.minotaur!;
    expect(minotaur).toMatchObject({ tn: 6, hp: 10, count: "1" });
    if (minotaur.damage.kind !== "table") throw new Error("expected a damage table");
    const table = minotaur.damage.table;

    const dice = createDice(1);
    const hits = Array.from({ length: 300 }, () => rollOn(dice, table).value);
    expect(Math.min(...hits)).toBe(2);
    expect(Math.max(...hits)).toBe(7);
  });

  it("fills in defaults for fields a file leaves out", () => {
    expect(ruleset.monsters.minotaur?.tags).toEqual([]);
  });
});

describe("loadRuleset catches mistakes", () => {
  const valid = () => ({
    name: "Test",
    classes: { hero: { name: "Hero", tn: 5, hp: 10, damage: "d6" } },
    monsters: { rat: { name: "Rat", count: "d3", tn: 3, hp: 1, damage: "d2" } },
  });

  const problemsOf = (data: unknown): string[] => {
    try {
      loadRuleset(data);
    } catch (error) {
      if (error instanceof RulesetError) return error.problems;
      throw error;
    }
    throw new Error("expected the ruleset to be rejected");
  };

  it("accepts a small valid ruleset", () => {
    expect(() => loadRuleset(valid())).not.toThrow();
  });

  it("reports every problem at once, each with where it is", () => {
    const data = valid();
    Object.assign(data.classes.hero, { hp: -3, damage: "banana" });
    Object.assign(data.monsters.rat, { hitpoints: 1 });

    const problems = problemsOf(data);
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.startsWith("classes.hero.hp:"))).toBe(true);
    expect(problems).toContain('classes.hero.damage: "banana" is not valid dice notation');
    expect(problems.some((p) => p.startsWith("monsters.rat:") && p.includes("hitpoints"))).toBe(true);
  });

  it("reports a missing field", () => {
    const data = valid();
    delete (data.monsters.rat as Partial<typeof data.monsters.rat>).count;
    expect(problemsOf(data).some((p) => p.startsWith("monsters.rat.count:"))).toBe(true);
  });

  it("reports a damage table with a gap", () => {
    const data = valid();
    Object.assign(data.monsters.rat, { damage: { roll: "d6", results: { "1-3": 1, "5-6": 2 } } });
    expect(problemsOf(data)).toEqual([
      'monsters.rat.damage: Table "monsters.rat.damage": no result for a roll of 4',
    ]);
  });

  it("reports broken YAML", () => {
    expect(() => parseRulesetYaml("classes: [unclosed")).toThrow();
  });
});
