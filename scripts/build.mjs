import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const assets = {};
for (const [name, type] of [
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ['connect.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['data.js', 'text/javascript; charset=utf-8'],
  ['logic.js', 'text/javascript; charset=utf-8']
]) assets[`/${name}`] = { body: readFileSync(path.join(root, 'dist', name), 'utf8'), type };

const source = readFileSync(path.join(root, 'worker', 'index.js'), 'utf8');
const built = source.replace('__ASSET_MAP__', JSON.stringify(assets));
mkdirSync(path.join(root, 'dist', 'server'), { recursive: true });
mkdirSync(path.join(root, 'dist', '.openai'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'server', 'index.js'), built);
writeFileSync(path.join(root, 'dist', '.openai', 'hosting.json'), readFileSync(path.join(root, '.openai', 'hosting.json')));
console.log('Built Worker and six UI assets.');
