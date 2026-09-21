/**
 * Generate TypeScript types from the JSON Schema.
 *
 * Pydantic models -> (export_schema.py) -> JSON Schema -> (here) -> TS types.
 * One path keeps the backend, the frontend and the AI looking at the same
 * definitions at all times.
 *
 *   npm run gen   (from the repository root; schema generation runs with it)
 */
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = resolve(here, "../generated");
const outDir = resolve(here, "../src/generated");

const BANNER = `/* eslint-disable */
/**
 * This file is generated. Do not edit it by hand.
 * Source: backend/app/models/*.py
 * Regenerate: npm run gen
 */`;

// Generate a single file from _all.schema.json, which bundles every model.
// Per-model generation duplicates $defs such as Tag and Section in every file,
// and re-exporting them through the barrel then collides.
const SOURCE = "_all.schema.json";

const available = (await readdir(schemaDir)).filter((f) => f.endsWith(".schema.json"));
if (!available.includes(SOURCE)) {
  console.error(
    `${SOURCE} not found. Run \`npm run gen:schema\` first.`,
  );
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

let ts = await compileFromFile(join(schemaDir, SOURCE), {
  bannerComment: BANNER,
  additionalProperties: false,
  style: { singleQuote: false, semi: true },
  declareExternallyReferenced: true,
  enableConstEnums: false,
});

// _AllModels itself is a generation-only container, so it is not exported.
ts = ts.replace(/export interface AllModels \{[\s\S]*?\n\}\n/, "");
ts = dedupeNumberedAliases(ts);
ts = interfacesToTypeAliases(ts);

/**
 * Rewrite `export interface X { ... }` as `export type X = { ... };`.
 *
 * React Flow requires a node's or edge's `data` to be a `Record<string, unknown>`.
 * TypeScript gives an implicit index signature to type aliases only, never to
 * interfaces, so without this the schema types could not go into data.
 * aliases, so without this the schema types could not go into data.
 */
function interfacesToTypeAliases(source) {
  let converted = 0;
  const out = source.replace(
    /^export interface (\w+) \{$([\s\S]*?)^\}$/gm,
    (_full, name, body) => {
      converted += 1;
      return `export type ${name} = {${body}};`;
    },
  );
  if (converted > 0) console.log(`  converted ${converted} interfaces to type aliases`);
  return out;
}

/**
 * When several fields reference the same enum, numbered duplicates like
 * `Origin1`-`Origin5` appear (because the $refs carry defaults).
 * Only those identical to the base are removed, with references repointed.
 */
function dedupeNumberedAliases(source) {
  // Also catch unions spanning lines (export type GroupStyle =\n  | "account" ...;)
  const declRe = /^export type (\w+) = ([\s\S]*?);$/gm;
  const normalize = (body) => body.replace(/\s+/g, " ").trim();

  const baseBodies = new Map();
  for (const [, name, body] of source.matchAll(declRe)) {
    if (!/\d$/.test(name)) baseBodies.set(name, normalize(body));
  }

  const rename = new Map();
  let out = source.replace(declRe, (decl, name, body) => {
    const numbered = /^(\w+?)(\d+)$/.exec(name);
    if (numbered && baseBodies.get(numbered[1]) === normalize(body)) {
      rename.set(name, numbered[1]);
      return "";
    }
    return decl;
  });

  for (const [from, to] of rename) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  if (rename.size > 0) {
    console.log(`  merged duplicate aliases: ${[...rename.keys()].join(", ")}`);
  }
  return out.replace(/\n{3,}/g, "\n\n");
}

await writeFile(join(outDir, "models.ts"), ts, "utf8");
await writeFile(
  join(outDir, "index.ts"),
  [BANNER, "", 'export * from "./models.js";', ""].join("\n"),
  "utf8",
);

const exported = [...ts.matchAll(/^export (?:interface|type) (\w+)/gm)].length;
console.log(`  src/generated/models.ts (${exported} types)`);
console.log(`  src/generated/index.ts`);
