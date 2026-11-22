import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'parse5';
import ts from 'typescript';

function jsComments(source, path = 'source.js') {
  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.jsx$/.test(path) ? ts.ScriptKind.JSX
    : /\.ts$/.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const positions = new Set();
  const jsxText = [];
  function visit(node) {
    if (ts.isJsxText(node)) jsxText.push([node.pos, node.end]);
    if (node.kind === ts.SyntaxKind.SingleLineCommentTrivia || node.kind === ts.SyntaxKind.MultiLineCommentTrivia) positions.add(node.getStart(ast));
    for (const range of [
      ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
    ]) positions.add(range.pos);
    for (const child of node.getChildren(ast)) visit(child);
  }
  visit(ast);
  return [...positions].filter(position => !jsxText.some(([start, end]) => start <= position && position < end));
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

function htmlCommentCount(source) {
  let count = 0;
  function visit(node) {
    if (node.nodeName === '#comment') count++;
    if (node.nodeName === 'script') {
      for (const child of node.childNodes ?? []) count += jsComments(child.value ?? '').length;
    }
    if (node.nodeName === 'style') {
      for (const child of node.childNodes ?? []) count += [...(child.value ?? '').matchAll(/\/\*/g)].length;
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(source));
  return count;
}

assert.equal(jsComments('const url = "https://site.test/a"; const s = `/* text */`;').length, 0);
assert.equal(jsComments('const x = 1; // comment').length, 1);
assert.equal(jsComments('try {} catch { /* comment */ }').length, 1);
assert.equal(jsComments('const Box = () => <div>{/* comment */}</div>;', 'source.tsx').length, 1);
assert.equal(jsComments('const Box = () => <div> // text </div>;', 'source.jsx').length, 0);
assert.equal(hashComments('uses: actions/checkout@hash # old').length, 1);
assert.equal(hashComments('url: "https://site.test/#x"').length, 0);
assert.equal(htmlCommentCount('<script>const x = 1;</script \t\n bar><div><!-- comment --></div>'), 1);
assert.equal(htmlCommentCount('<script>const x = 1; // comment</script>'), 1);

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
for (const path of paths) {
  const kind = /\.(?:cjs|mjs|js|jsx|ts|tsx)$/.test(path) ? 'js'
    : /\.(?:yml|yaml|sh|py)$/.test(path) || path === '.gitignore' || path.endsWith('.env.example') ? 'hash'
    : /\.css$/.test(path) ? 'css'
    : /\.html$/.test(path) ? 'html' : null;
  if (!kind) continue;
  const source = readFileSync(path, 'utf8');
  if (path === 'graphify-out/graph.html') {
    const count = htmlCommentCount(source);
    if (count > 23) failures.push(`${path}: generated comment debt grew from 23 to ${count}`);
    continue;
  }
  const positions = kind === 'js' ? jsComments(source, path)
    : kind === 'hash' ? hashComments(source)
    : kind === 'css' ? [...source.matchAll(/\/\*/g)].map(match => source.slice(0, match.index).split('\n').length)
    : Array.from({ length: htmlCommentCount(source) }, (_, index) => index + 1);
  for (const position of positions) {
    const line = kind === 'js' ? source.slice(0, position).split('\n').length : position;
    failures.push(`${path}:${line}: comment is forbidden`);
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Comment ratchet passed: zero source comments; generated report <= 23.');
