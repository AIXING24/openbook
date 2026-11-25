import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {massiveCurlConfig, requestMassiveJson} from '../scripts/massive-http.mjs';

const key = 'synthetic-test-key-not-a-credential';
test('system client configuration restricts host, scheme and header injection', () => {
  const value = massiveCurlConfig('/v1/open-close/NVDA/2026-11-24?adjusted=false', key);
  assert.ok(value.includes('url = "https://api.massive.com/v1/'));
  for (const path of ['https://bad.invalid', '//bad.invalid/v1', '/v1/\nheader=x', '/v1/"', '/v1/\\']) assert.throws(() => massiveCurlConfig(path, key));
  assert.throws(() => massiveCurlConfig('/v1/test', key + '\n'));
});

test('system client puts credentials in stdin only and keeps TLS and redirects safe', async () => {
  let configuration;
  const runner = (binary, args, options, complete) => {
    assert.equal(binary, '/usr/bin/curl');
    assert.equal(args[0], '--disable');
    assert.ok(!args.join(' ').includes(key));
    assert.ok(!args.includes('--insecure') && !args.includes('-k') && !args.includes('--location') && !args.includes('-L'));
    assert.equal(options.maxBuffer, 1024 * 1024);
    const stdin = new EventEmitter();
    stdin.end = value => {configuration = value; complete(null, '{"status":"OK"}\n200');};
    return {stdin};
  };
  assert.deepEqual(await requestMassiveJson('/v1/test', key, runner), {httpStatus: 200, payload: {status: 'OK'}});
  assert.ok(configuration.includes('Authorization: Bearer ' + key));
});

test('system client ignores error bodies and suppresses raw process errors', async () => {
  for (const [error, stdout, expected] of [[null, 'private error body\n403', {httpStatus: 403}], [new Error(key), '', null], [null, 'invalid JSON\n200', null], [null, '{}\ninvalid', null]]) {
    const runner = (binary, args, options, complete) => {
      const stdin = new EventEmitter();
      stdin.end = () => complete(error, stdout);
      return {stdin};
    };
    if (expected) assert.deepEqual(await requestMassiveJson('/v1/test', key, runner), expected);
    else await assert.rejects(requestMassiveJson('/v1/test', key, runner), failure => !failure.message.includes(key));
  }
});
