import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("temporary activation is hidden unless separately enabled and exactly bearer-authorized", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    require.cache[require.resolve('server-only')] = { exports: {} };
    const { authorizeSharedSetup } = await import('./lib/shared/setup.ts');
    const token = 'a'.repeat(64), env = { BOOKENDS_SETUP_ENABLED: '1', BOOKENDS_SETUP_TOKEN: token };
    const request = auth => new Request('https://bookends.example/api/shared/setup', { method: 'POST', headers: auth ? { Authorization: auth } : {} });
    const denied = error => error.status === 404;
    assert.doesNotThrow(() => authorizeSharedSetup(request('Bearer ' + token), env));
    for (const header of [undefined, token, 'Bearer ' + 'b'.repeat(64), 'Bearer short']) assert.throws(() => authorizeSharedSetup(request(header), env), denied);
    assert.throws(() => authorizeSharedSetup(request('Bearer ' + token), { ...env, BOOKENDS_SETUP_ENABLED: '0' }), denied);
    assert.throws(() => authorizeSharedSetup(request('Bearer ' + token), { ...env, BOOKENDS_SETUP_TOKEN: '' }), denied);
    process.stdout.write('pass');
  `], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "pass");
});

test("activation applies real migrations, provisions a restricted login, retries safely, and rejects changed history or elevated roles", () => {
  const run = spawnSync(process.execPath, ["--import", "tsx", "tests/helpers/shared-setup-fixture.ts"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "provisioning-passed");
});
