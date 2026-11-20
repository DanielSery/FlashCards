import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const NOT_SERVED_TO_THE_APP = [/^\.git/, /^\.vcela\//, /^tests\//, /^README\.md$/, /^sw\.js$/, /^vendor\/.*\.LICENSE\.txt$/, /^Packages$/];

function repoFiles(dir = root) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    if (NOT_SERVED_TO_THE_APP.some(re => re.test(rel))) return [];
    return statSync(full).isDirectory() ? repoFiles(full) : [rel];
  });
}

function precached() {
  const source = readFileSync(join(root, 'sw.js'), 'utf8');
  const list = source.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
  return [...list.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]);
}

test('the service worker precaches every file the app serves', () => {
  // Arrange
  const assets = new Set(precached());

  // Act
  const missing = repoFiles().filter(f => !assets.has(f));
  const stale = [...assets].filter(f => f && !repoFiles().includes(f));

  // Assert
  assert.deepEqual(missing, [], 'add these to ASSETS in sw.js');
  assert.deepEqual(stale, [], 'these ASSETS entries do not exist');
});

test('every icon the manifest and page reference is precached', () => {
  // Arrange
  const assets = new Set(precached());
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const html = readFileSync(join(root, 'index.html'), 'utf8');

  // Act
  const referenced = [
    ...manifest.icons.map(i => i.src),
    ...[...html.matchAll(/(?:href|src)="([^"#?]+)"/g)].map(m => m[1]),
  ].filter(p => !/^https?:/.test(p));

  // Assert
  assert.deepEqual(referenced.filter(p => !assets.has(p)), []);
});
