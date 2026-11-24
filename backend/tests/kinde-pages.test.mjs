import test from 'node:test';
import assert from 'node:assert/strict';
import pages from '../kinde-pages.mjs';
import {runtime} from './runtime.mjs';
test('Pages candidate rejects unconfigured authentication and keeps existing mock isolation',async t=>{
  const r=await runtime();t.after(()=>r.close());
  const env={DB:r.db,VALIDATION_MODE:'mock-only'};
  assert.equal((await pages.fetch(new Request('https://pilot.example/'),env,{})).status,200);
  for(const path of ['/auth/test','/auth/complete','/api/session/me'])assert.equal((await pages.fetch(new Request('https://pilot.example'+path),env,{})).status,503);
  assert.equal((await pages.fetch(new Request('https://pilot.example/state'),env,{})).status,401);
  Object.assign(env,{AUTH_MODE:'kinde-test-only',AUTH_ALLOWED_EMAILS:'["alice@example.test"]',AUTH_ISSUER:'https://test.kinde.com',AUTH_CLIENT_ID:'test-public-client-id',AUTH_API_ORIGIN:'https://pilot.example',ASSETS:{fetch:async request=>new Response('// fixed asset '+new URL(request.url).pathname)}});
  assert.equal((await pages.fetch(new Request('https://alias.example/auth/test'),env,{})).status,403);
  const page=await pages.fetch(new Request('https://pilot.example/auth/test'),env,{});assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.ok(!(await page.text()).includes('alice@example.test'));
  assert.equal((await pages.fetch(new Request('https://pilot.example/api/session/me'),env,{})).status,401);
  assert.equal((await pages.fetch(new Request('https://pilot.example/auth/test-client.mjs'),env,{})).status,200);
  assert.equal((await pages.fetch(new Request('https://pilot.example/auth/arbitrary-file'),env,{})).status,404);
});
