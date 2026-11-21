import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function jsComments(source) {
  const ast = ts.createSourceFile('source.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const positions = new Set();
  function visit(node) {
    if (node.kind === ts.SyntaxKind.SingleLineCommentTrivia || node.kind === ts.SyntaxKind.MultiLineCommentTrivia) positions.add(node.getStart(ast));
    for (const range of [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ]) positions.add(range.pos);
    for (const child of node.getChildren(ast)) visit(child);
  }
  visit(ast);
  return [...positions];
}

function hashComments(source) {
  return source.split('\n').flatMap((line, index) => {
    if (index === 0 && line.startsWith('#!')) return [];
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quote) {
        if (char === quote && line[i - 1] !== '\\') quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return [`${index + 1}`];
    }
    return [];
  });
}

assert.equal(jsComments('const url = "https://site.test/a"; const s = `/* text */`;').length, 0);
assert.equal(jsComments('const x = 1; // comment').length, 1);
assert.equal(jsComments('try {} catch { /* comment */ }').length, 1);
assert.equal(hashComments('uses: actions/checkout@hash # old').length, 1);
assert.equal(hashComments('url: "https://site.test/#x"').length, 0);

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const path of paths) {
  const kind = /\.(?:js|mjs)$/.test(path) ? 'js'
    : /\.(?:yml|yaml|sh|py)$/.test(path) ? 'hash'
    : /\.css$/.test(path) ? 'css'
    : /\.html$/.test(path) ? 'html' : null;
  if (!kind) continue;
  const source = readFileSync(path, 'utf8');
  if (path === 'graphify-out/graph.html') {
    let count = [...source.matchAll(/<!--/g)].length;
    for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, match[1]);
      for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) count++;
      }
    }
    if (count > 23) failures.push(`${path}: generated comment debt grew from 23 to ${count}`);
    continue;
  }
  const positions = kind === 'js' ? jsComments(source)
    : kind === 'hash' ? hashComments(source)
    : [...source.matchAll(kind === 'css' ? /\/\*/g : /<!--/g)].map(match => source.slice(0, match.index).split('\n').length);
  for (const position of positions) {
    const line = kind === 'js' ? source.slice(0, position).split('\n').length : position;
    failures.push(`${path}:${line}: comment is forbidden`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Comment ratchet passed: zero source comments; generated report <= 23.');
