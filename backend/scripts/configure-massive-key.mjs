import {openSync, writeFileSync, closeSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function saveMassiveKey(file, key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('Invalid API key format; nothing saved.');
  const descriptor = openSync(file, 'wx', 0o600);
  try {
    writeFileSync(descriptor, JSON.stringify({MASSIVE_API_KEY: key}) + '\n');
  } finally {
    closeSync(descriptor);
  }
}

export function readHiddenKey(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) return Promise.reject(new Error('Use an interactive terminal; do not pass the key as a command argument.'));
  output.write('Paste the Massive API key (hidden), then press Enter. Ctrl+C cancels: ');
  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let key = '';
    const finish = error => {
      input.removeListener('data', receive);
      input.removeListener('end', ended);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(key);
      key = '';
    };
    const ended = () => finish(new Error('Input ended; nothing saved.'));
    const receive = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Cancelled; nothing saved.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') key = key.slice(0, -1);
        else key += character;
        if (key.length > 256) return finish(new Error('Input too long; nothing saved.'));
      }
    };
    input.setRawMode(true);
    input.on('data', receive);
    input.once('end', ended);
    input.resume();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    saveMassiveKey(new URL('../.massive-secrets.local.json', import.meta.url), await readHiddenKey());
    console.log('API key saved locally with owner-only permissions. No network request or deployment performed.');
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Local secret already exists; it was not overwritten.' : 'API key setup failed or was cancelled; no key was printed.');
    process.exitCode = 1;
  }
}
