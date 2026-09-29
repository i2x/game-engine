import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { rollRange } from "./dice";
import { defineTable, type Table } from "./table";

// ---------------------------------------------------------------------------
// What a ruleset file may contain. Objects are strict, so a typo such as
// "hitpoints:" is reported instead of being silently ignored.
// ---------------------------------------------------------------------------

const notation = z.string().refine(isValidNotation, {
  error: (issue) => `"${String(issue.input)}" is not valid dice notation`,
});

/** Plain dice ("d6+1"), or a table read by a roll ("d6 → {2, 3, 4, 5, 6, 7}"). */
const damageSpec = z.union([
  notation,
  z.strictObject({
    roll: notation,
    results: z.union([z.array(z.number().int()), z.record(z.string(), z.number().int())]),
  }),
]);

const classSpec = z.strictObject({
  name: z.string(),
  /** Free-form labels such as "human" or "cleric"; rules will refer to these later. */
  tags: z.array(z.string()).default([]),
  tn: z.number().int().min(1),
  hp: z.number().int().positive(),
  damage: damageSpec,
  spells: z.number().int().min(0).default(0),
});

const monsterSpec = z.strictObject({
  name: z.string(),
  tags: z.array(z.string()).default([]),
  /** How many appear in a room, e.g. "d3+1". */
  count: notation,
  tn: z.number().int().min(1),
  hp: z.number().int().positive(),
  damage: damageSpec,
});

const rulesetSpec = z.strictObject({
  name: z.string(),
  classes: z.record(z.string(), classSpec),
  monsters: z.record(z.string(), monsterSpec),
});

// ---------------------------------------------------------------------------
// What the engine works with after loading.
// ---------------------------------------------------------------------------

export type Damage =
  | { kind: "dice"; notation: string }
  | { kind: "table"; table: Table<number> };

export interface ClassDef {
  id: string;
  name: string;
  tags: string[];
  tn: number;
  hp: number;
  damage: Damage;
  spells: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  tags: string[];
  count: string;
  tn: number;
  hp: number;
  damage: Damage;
}

export interface Ruleset {
  name: string;
  classes: Record<string, ClassDef>;
  monsters: Record<string, MonsterDef>;
}

/** Every problem found in a ruleset, reported together so they can all be fixed in one pass. */
export class RulesetError extends Error {
  constructor(readonly problems: string[]) {
    super(`Ruleset has ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "RulesetError";
  }
}

export function parseRulesetYaml(text: string): Ruleset {
  return loadRuleset(parseYaml(text));
}

/** Check raw data (already parsed from YAML or JSON) and turn it into a ruleset the engine can use. */
export function loadRuleset(data: unknown): Ruleset {
  // Pass 1: is everything the right shape?
  const parsed = rulesetSpec.safeParse(data);
  if (!parsed.success) {
    throw new RulesetError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`),
    );
  }

  // Pass 2: do the tables cover every roll? Needs the ids, so it runs after the shape check.
  const problems: string[] = [];
  const compileDamage = (path: string, spec: z.infer<typeof damageSpec>): Damage => {
    if (typeof spec === "string") return { kind: "dice", notation: spec };
    try {
      return { kind: "table", table: defineTable(path, spec) };
    } catch (error) {
      problems.push(`${path}: ${(error as Error).message}`);
      return { kind: "dice", notation: "0" }; // placeholder; the load fails below anyway
    }
  };

  const { name, classes, monsters } = parsed.data;
  const ruleset: Ruleset = {
    name,
    classes: mapValues(classes, (id, spec) => ({
      id,
      ...spec,
      damage: compileDamage(`classes.${id}.damage`, spec.damage),
    })),
    monsters: mapValues(monsters, (id, spec) => ({
      id,
      ...spec,
      damage: compileDamage(`monsters.${id}.damage`, spec.damage),
    })),
  };

  if (problems.length > 0) throw new RulesetError(problems);
  return ruleset;
}

function isValidNotation(value: string): boolean {
  try {
    rollRange(value);
    return true;
  } catch {
    return false;
  }
}

function mapValues<A, B>(record: Record<string, A>, fn: (id: string, value: A) => B): Record<string, B> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [id, fn(id, value)]));
}
