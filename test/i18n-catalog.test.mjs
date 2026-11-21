import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalog, translate } from "../dashboard/i18n.js";

assert.equal(translate("en", "Memories"), "Memories");
assert.equal(translate("pt", "Memories"), "Memórias");
assert.equal(translate("pt", "Safe cleanup"), "Limpeza segura");
assert.equal(translate("pt", "{n} memories", { n: 2 }), "2 memórias");
assert.equal(translate("pt", "Independent project, not affiliated with claude-mem."), "Projeto independente, sem afiliação com o claude-mem.");
assert.equal(translate("en", "Not in the catalog"), "Not in the catalog");

const html = readFileSync(new URL("../dashboard/index.html", import.meta.url), "utf8");
assert.match(html, /lang="en"/);
assert.doesNotMatch(html, /lang="pt-BR"/);
const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]);
assert.ok(keys.length > 40);
const missing = keys.filter((key) => !(key in catalog.pt));
assert.deepEqual(missing, []);

process.stdout.write("English-default locale catalog tests passed.\n");
