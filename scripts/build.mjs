import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const parts = ['p1.html', 'core.js', 'data.js', 'pnl.js', 'ui.js', 'p4.html'];
const sources = await Promise.all(parts.map(name => readFile(new URL('parts/' + name, root), 'utf8')));
await writeFile(new URL('index.html', root), sources.join(''));
