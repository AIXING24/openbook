import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, statSync, rmSync, symlinkSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {saveMassiveKey, readHiddenKey} from '../scripts/configure-massive-key.mjs';

const fixtureKey = 'synthetic-test-key-not-a-credential';
function setup(context) {
  const directory = mkdtempSync(join(tmpdir(), 'gaintrace-key-test-'));
  context.after(() => rmSync(directory, {recursive: true, force: true}));
  return join(directory, 'secret.local.json');
}

test('Massive key setup saves only in a new owner-readable local file', context => {
  const file = setup(context);
  saveMassiveKey(file, fixtureKey);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {MASSIVE_API_KEY: fixtureKey});
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('Massive key setup does not overwrite an existing file', context => {
  const file = setup(context);
  writeFileSync(file, 'existing-content');
  assert.throws(() => saveMassiveKey(file, fixtureKey), {code: 'EEXIST'});
  assert.equal(readFileSync(file, 'utf8'), 'existing-content');
});

test('Massive key setup does not follow a symlink', context => {
  const file = setup(context), target = file + '-target';
  writeFileSync(target, 'unchanged');
  symlinkSync(target, file);
  assert.throws(() => saveMassiveKey(file, fixtureKey), {code: 'EEXIST'});
  assert.equal(readFileSync(target, 'utf8'), 'unchanged');
});

test('Massive key setup rejects invalid values without writing', context => {
  const file = setup(context);
  for (const key of [undefined, '', 'short', fixtureKey + '\n', 'Bearer ' + fixtureKey, 'a'.repeat(257)]) {
    assert.throws(() => saveMassiveKey(file, key), /Invalid API key format/);
    assert.equal(existsSync(file), false);
  }
});

test('Massive key setup rejects non-interactive input', async () => {
  await assert.rejects(readHiddenKey({isTTY: false}, {isTTY: false}), /interactive terminal/);
});

function terminal() {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = raw => {input.isRaw = raw;};
  input.resume = () => {};
  input.pause = () => {};
  const messages = [];
  const output = {isTTY: true, write: message => messages.push(message)};
  return {input, output, messages};
}

test('hidden input never echoes the key and restores terminal mode', async () => {
  const {input, output, messages} = terminal();
  const result = readHiddenKey(input, output);
  assert.equal(input.isRaw, true);
  input.emit('data', Buffer.from(fixtureKey + '\r'));
  assert.equal(await result, fixtureKey);
  assert.equal(input.isRaw, false);
  assert.equal(input.listenerCount('data'), 0);
  assert.equal(input.listenerCount('end'), 0);
  assert.equal(messages.join('').includes(fixtureKey), false);
});

test('hidden input cancellation and overflow restore terminal mode', async () => {
  for (const data of [fixtureKey + '\u0003', fixtureKey + '\u0004', 'a'.repeat(257)]) {
    const {input, output} = terminal();
    const result = readHiddenKey(input, output);
    input.emit('data', Buffer.from(data));
    await assert.rejects(result, /Cancelled|too long/);
    assert.equal(input.isRaw, false);
    assert.equal(input.listenerCount('data'), 0);
  }
});

test('hidden input supports corrections without exposing characters', async () => {
  const {input, output} = terminal();
  const result = readHiddenKey(input, output);
  input.emit('data', Buffer.from(fixtureKey + 'x\u007f\r'));
  assert.equal(await result, fixtureKey);
});

test('hidden input handles end of input and preserves previous raw mode', async () => {
  const {input, output} = terminal();
  input.isRaw = true;
  const result = readHiddenKey(input, output);
  input.emit('end');
  await assert.rejects(result, /Input ended/);
  assert.equal(input.isRaw, true);
});
