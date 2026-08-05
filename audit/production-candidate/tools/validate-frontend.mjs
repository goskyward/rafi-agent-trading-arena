import fs from "node:fs";
import vm from "node:vm";

const file = process.argv[2];
if (!file) throw new Error("usage: node validate-frontend.mjs <index.html>");
const html = fs.readFileSync(file, "utf8");
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[1]))
  .map((m) => m[2])
  .filter((source) => source.trim());
const syntaxErrors = [];
for (let i = 0; i < scripts.length; i += 1) {
  try { new vm.Script(scripts[i], { filename: `${file}#script-${i + 1}` }); }
  catch (error) { syntaxErrors.push(String(error.message)); }
}
const result = { file, bytes: Buffer.byteLength(html), ids: ids.length, duplicateIds: duplicates, inlineScripts: scripts.length, syntaxErrors };
console.log(JSON.stringify(result, null, 2));
if (duplicates.length || syntaxErrors.length) process.exitCode = 1;
