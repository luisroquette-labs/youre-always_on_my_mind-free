import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const h1Count = (html.match(/<h1\b/g) || []).length;
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const tabs = [...html.matchAll(/role="tab"/g)].length;
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1].split('?', 1)[0])
  .filter((ref) => ref && !/^(?:#|https?:|data:|mailto:)/.test(ref));

if (h1Count !== 1) throw new Error(`Expected one H1, found ${h1Count}`);
if (ids.length !== new Set(ids).size) throw new Error('Duplicate IDs found');
if (tabs !== 3) throw new Error(`Expected three memory tabs, found ${tabs}`);
if (!ids.includes('memory-panel')) throw new Error('Memory panel is missing');
await Promise.all(refs.map((ref) => access(resolve(root, ref))));
console.log(`Site validation passed: one H1, ${ids.length} unique IDs, three memory tabs, no missing assets`);
