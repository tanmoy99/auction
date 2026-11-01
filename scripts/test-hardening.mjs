import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, photoExtension, readRegistration, validatePlayer } from "../src/lib/registration-validation.ts";
import { ActionQueue } from "../src/lib/action-queue.ts";
import { publicShareUrl, qrMatrix } from "../src/lib/qr.ts";
import jsQR from "jsqr";

test("Indian mobiles normalise consistently without arbitrary suffix truncation", () => {
  for (const number of ["9876543210", "+91 98765 43210", "09876543210"]) assert.equal(normalisePhone(number), "+919876543210");
  for (const number of [null, "", "1234567890", "+44 9876543210", "abc9876543210", "91919876543210"])
    assert.throws(() => normalisePhone(number));
  assert.equal(normalisePhone(null, false), null);
});
test("player field limits and unsafe photo URLs are rejected", () => {
  const p = {
    name: "Ravi",
    phone: "9876543210",
    age: 22,
    role: "Bowler",
    city: null,
    batting_style: null,
    bowling_style: null,
    photo_url: null,
  };
  assert.equal(validatePlayer(p).phone, "+919876543210");
  for (const patch of [
    { name: "" },
    { name: "a".repeat(81) },
    { age: 101 },
    { role: "Unknown" },
    { city: "a".repeat(121) },
    { photo_url: "javascript:alert(1)" },
  ])
    assert.throws(() => validatePlayer({ ...p, ...patch }));
});
test("photo validation rejects spoofed, unsupported and oversized files", async () => {
  assert.equal(await photoExtension(new File([new Uint8Array([255, 216, 255, 224])], "photo.jpg", { type: "image/jpeg" })), "jpg");
  await assert.rejects(photoExtension(new File(["not an image"], "a.jpg", { type: "image/jpeg" })));
  await assert.rejects(photoExtension(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })));
  await assert.rejects(photoExtension(new File([new Uint8Array(2097153)], "a.jpg", { type: "image/jpeg" })));
});
test("JSON and Google Form arrays work; malformed and oversized bodies fail", async () => {
  const request = (body) => new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body });
  const parsed = await readRegistration(request(JSON.stringify({ "Your name": ["Ravi"], Phone: "9876543210" })));
  assert.deepEqual(parsed.record["Your name"], ["Ravi"]);
  await assert.rejects(readRegistration(request("{")));
  await assert.rejects(readRegistration(request("[]")));
  await assert.rejects(readRegistration(request(JSON.stringify({ Name: "x".repeat(3000) }))));
  await assert.rejects(readRegistration(request("x".repeat(2200000))));
});
const entry = (id, kind = "event") => ({ id, revision: 0, kind, seq: 1, data: {}, live: {}, events: [] });
test("rapid taps and Undo are persisted and sent serially", async () => {
  const sent = [];
  let release;
  let saved = [];
  const gate = new Promise((resolve) => (release = resolve));
  const queue = new ActionQueue(
    [],
    (rows) => {
      saved = rows;
    },
    async (row) => {
      sent.push(row.id);
      if (row.id === "a") await gate;
    },
  );
  queue.enqueue(entry("a"));
  const flush = queue.flush();
  queue.enqueue(entry("b"));
  queue.enqueue(entry("undo", "undo"));
  await queue.flush();
  assert.deepEqual(sent, ["a"]);
  assert.equal(saved.length, 3);
  release();
  await flush;
  assert.deepEqual(sent, ["a", "b", "undo"]);
  assert.equal(queue.snapshot.status, "Saved");
});
test("ambiguous failure and refresh preserve the original action ID for retry", async () => {
  let saved = [];
  const ids = [];
  const queue = new ActionQueue(
    [],
    (rows) => {
      saved = structuredClone(rows);
    },
    async (row) => {
      ids.push(row.id);
      throw Error("network response lost");
    },
  );
  queue.enqueue(entry("same-id"));
  await queue.flush();
  assert.equal(saved.length, 1);
  const restored = new ActionQueue(
    saved,
    (rows) => {
      saved = rows;
    },
    async (row) => {
      ids.push(row.id);
    },
  );
  assert.equal(restored.snapshot.status, "Review required");
  await restored.flush();
  assert.deepEqual(ids, ["same-id", "same-id"]);
  assert.equal(saved.length, 0);
});
test("offline and conflict retain recoverable input; storage failure prevents enqueue", async () => {
  const queue = new ActionQueue(
    [],
    () => {},
    async () => {
      throw Error("Score changed");
    },
  );
  queue.enqueue(entry("a"));
  await queue.flush(false);
  assert.equal(queue.snapshot.status, "Offline");
  await queue.flush();
  assert.equal(queue.snapshot.entries.length, 1);
  assert.equal(queue.snapshot.status, "Review required");
  const full = new ActionQueue(
    [],
    () => {
      throw Error("quota");
    },
    async () => {},
  );
  assert.throws(() => full.enqueue(entry("x")));
  assert.equal(full.snapshot.entries.length, 0);
});

test("independent QR decoder recovers the exact public destinations", () => {
  for (const page of ["register", "fixtures", "match", "live"]) {
    const text = publicShareUrl("https://cricmate.example", `/${page}/00000000-0000-4000-8000-000000000010`);
    const matrix = qrMatrix(text),
      scale = 8,
      size = (matrix.length + 8) * scale;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    matrix.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark)
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const p = (((y + 4) * scale + dy) * size + (x + 4) * scale + dx) * 4;
              rgba[p] = rgba[p + 1] = rgba[p + 2] = 0;
            }
      }),
    );
    assert.equal(jsQR(rgba, size, size)?.data, text);
  }
  for (const path of [
    "/score/00000000-0000-4000-8000-000000000010#pin=1234",
    "https://evil.example/match/00000000-0000-4000-8000-000000000010",
    "/fixtures/00000000-0000-4000-8000-000000000010?secret=x",
  ])
    assert.throws(() => publicShareUrl("https://cricmate.example", path));
  assert.throws(() => qrMatrix("x".repeat(135)));
});
