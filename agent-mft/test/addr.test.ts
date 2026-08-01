import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAddr, decodeAddr, isValidAddr, displayAddr } from "../src/addr.ts";

test("encode/decode roundtrip", () => {
  for (const seq of [0, 1, 2, 100, 9999, 123456, 1_000_000_000]) {
    const addr = encodeAddr(seq);
    assert.equal(decodeAddr(addr), seq, `roundtrip ${seq}`);
  }
});

test("addresses are monotonic-ish and short", () => {
  const a = encodeAddr(1);
  const b = encodeAddr(2);
  assert.ok(a.length >= 4, `addr ${a} too short`);
  assert.ok(b.length >= 4);
  assert.notEqual(a, b);
});

test("first address is not all zeros", () => {
  assert.notEqual(encodeAddr(0), "0000");
  assert.ok(!encodeAddr(0).startsWith("0"));
});

test("decode rejects garbage", () => {
  assert.equal(decodeAddr(""), null);
  assert.equal(decodeAddr("!!!!"), null);
  assert.equal(decodeAddr("#A1F3"), null); // no hash allowed here (query layer handles it)
  assert.equal(decodeAddr("0".repeat(20)), null); // overlong → unsafe int
});

test("isValidAddr / displayAddr", () => {
  assert.ok(isValidAddr("a1f3"));
  assert.ok(isValidAddr("A1F3"));
  assert.ok(!isValidAddr(""));
  assert.ok(!isValidAddr("abc123xyz"));
  assert.equal(displayAddr("a1f3"), "#A1F3");
});
