import assert from "node:assert/strict";
import { test } from "node:test";
import { holdFolder } from "../server/instance.js";
import { tempSite } from "./helpers.js";

test("a second server on the same folder is refused, another folder is not", { skip: process.platform !== "win32" }, async () => {
  const one = tempSite();
  const two = tempSite();
  try {
    assert.equal(await holdFolder(one.root), true);
    assert.equal(await holdFolder(one.root), false);
    assert.equal(await holdFolder(one.root.toUpperCase()), false);
    assert.equal(await holdFolder(two.root), true);
  } finally {
    one.cleanup();
    two.cleanup();
  }
});
