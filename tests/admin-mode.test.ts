import { test } from "node:test";
import assert from "node:assert/strict";
import { localAdministrationEnabled } from "../lib/admin/mode";

test("local administration requires an explicit mode and never replaces production administration", () => {
  assert.equal(localAdministrationEnabled({}), false);
  assert.equal(localAdministrationEnabled({ BOOKENDS_ADMIN_MODE: "local" }), true);
  assert.equal(localAdministrationEnabled({ BOOKENDS_ADMIN_MODE: "local", BOOKENDS_MODE: "demo" }), true);
  assert.equal(localAdministrationEnabled({ BOOKENDS_ADMIN_MODE: "local", BOOKENDS_MODE: "production" }), false);
  assert.equal(localAdministrationEnabled({ BOOKENDS_ADMIN_MODE: "protected" }), false);
  assert.equal(localAdministrationEnabled({ BOOKENDS_ADMIN_MODE: "other" }), false);
});
