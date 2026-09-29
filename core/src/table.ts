import { rollRange, type Dice, type RollResult } from "./dice";

/**
 * A random table as it is written in game data. Two forms, matching the booklet:
 *
 *   List:   { roll: "d6", results: [2, 3, 4, 5, 6, 7] }
 *           The first entry is the lowest possible roll (1 on a d6, 2 on 2d6).
 *
 *   Ranges: { roll: "d6", results: { "1-4": "human", "5-6": "demi-human" } }
 */
export interface TableSpec<T> {
  roll: string;
  results: T[] | Record<string, T>;
}

interface Row<T> {
  min: number;
  max: number;
  value: T;
}

export interface Table<T> {
  readonly name: string;
  readonly notation: string;
  readonly rows: readonly Row<T>[];
}

/** One roll on a table: which table, what the dice showed, and what it produced. */
export interface TableRoll<T> {
  table: string;
  roll: RollResult;
  value: T;
}

/**
 * Turn a spec into a table, and check that every possible roll has exactly one result.
 * Mistakes in game data are reported here, when the data is loaded, not in the middle of play.
 */
export function defineTable<T>(name: string, spec: TableSpec<T>): Table<T> {
  const { min, max } = rollRange(spec.roll);
  const rows = Array.isArray(spec.results)
    ? spec.results.map((value, i) => ({ min: min + i, max: min + i, value }))
    : Object.entries(spec.results).map(([key, value]) => ({ ...parseRange(name, key), value }));

  const problems: string[] = [];
  for (let n = min; n <= max; n++) {
    const matches = rows.filter((row) => row.min <= n && n <= row.max).length;
    if (matches === 0) problems.push(`no result for a roll of ${n}`);
    if (matches > 1) problems.push(`${matches} results for a roll of ${n}`);
  }
  for (const row of rows) {
    if (row.min < min || row.max > max) {
      problems.push(`${formatRange(row)} can never be rolled on ${spec.roll} (${min}-${max})`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Table "${name}": ${problems.join("; ")}`);
  }

  return { name, notation: spec.roll, rows };
}

/** Roll the table's dice and look up the result. */
export function rollOn<T>(dice: Dice, table: Table<T>): TableRoll<T> {
  const roll = dice.roll(table.notation);
  const row = table.rows.find((r) => r.min <= roll.total && roll.total <= r.max);
  if (!row) {
    // defineTable guarantees full coverage, so reaching this means a bug in the engine itself.
    throw new Error(`Table "${table.name}": no result for a roll of ${roll.total}`);
  }
  return { table: table.name, roll, value: row.value };
}

function parseRange(tableName: string, key: string): { min: number; max: number } {
  const match = /^(\d+)(?:-(\d+))?$/.exec(key.trim());
  if (!match) {
    throw new Error(`Table "${tableName}": "${key}" is not a roll or range like "3" or "1-4"`);
  }
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  if (max < min) {
    throw new Error(`Table "${tableName}": range "${key}" runs backwards`);
  }
  return { min, max };
}

function formatRange({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min}` : `${min}-${max}`;
}
