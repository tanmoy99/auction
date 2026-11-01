import ts from "typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
await mkdir(".cache/tests", { recursive: true });
await mkdir("artifacts", { recursive: true });
const source = await readFile("src/lib/result-card.tsx", "utf8");
const output = ts
  .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace('"next/og"', '"next/og.js"');
await writeFile(".cache/tests/result-card.mjs", output);
const { resultCard } = await import(pathToFileURL(path.resolve(".cache/tests/result-card.mjs")));
for (const [name, teams, result, detail, sponsors] of [
  ["result", "Riverside Royals v Lakeside Lions", "Royals won by 18 runs", "162/6 · 144/9", []],
  [
    "long-result",
    "The Extraordinary Riverside Community Cricket Association v The Remarkable Lakeside Sporting Association",
    "The Extraordinary Riverside Community Cricket Association won by an innings and 125 runs",
    "Inn 1: 350/8d · Inn 2: 125/10 · Inn 3: 100/10",
    ["Community Hardware and Sporting Supplies", "The Neighbourhood Cafe"],
  ],
]) {
  const response = resultCard("Riverside Community Cup", teams, result, detail, sponsors);
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 800);
  await writeFile(`artifacts/${name}.png`, png);
}
console.log("2 result-card PNG exports passed, including long names and Test innings");
