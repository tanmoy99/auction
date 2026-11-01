// Executes the actual route/validation code with a fake Supabase transport. No network or secrets.
import ts from "typescript";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

await mkdir(".cache/routes", { recursive: true });
const modules = {
  fields: "src/lib/fields.ts", types: "src/lib/types.ts",
  "registration-validation": "src/lib/registration-validation.ts",
  "registration-server": "src/lib/registration-server.ts",
  register: "src/app/api/register/[token]/route.ts", join: "src/app/api/join/[token]/route.ts",
};
for (const [name, file] of Object.entries(modules)) {
  let code = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  code = code.replaceAll('"@/lib/', '"./').replace(/"\.\/(fields|types|registration-validation|registration-server|supabase-admin)"/g, '"./$1.mjs"');
  await writeFile(`.cache/routes/${name}.mjs`, code);
}
await writeFile(".cache/routes/supabase-admin.mjs", `export const supabaseAdmin=()=>globalThis.registrationFixture.admin;
export const userFromRequest=async()=>globalThis.registrationFixture.user;
export const accessOf=async()=>({active:!globalThis.registrationFixture.pausedUser});`);
const register = (await import(pathToFileURL(path.resolve(".cache/routes/register.mjs")))).POST;
const join = (await import(pathToFileURL(path.resolve(".cache/routes/join.mjs")))).POST;
const token = "00000000-0000-4000-8000-000000000020";
const ctx = { params: Promise.resolve({ token }) };
const json = (data) => new Request(`http://localhost/api/register/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const valid = { "Your name": ["Ravi"], "Mobile number": ["98765 43210"], Age: ["24"] };
function fixture(options = {}) {
  const state = { calls: [], removed: [], uploads: [], user: null, ...options };
  state.admin = {
    from(table) {
      return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() {
          return { data: table === "team_links" ? { team_id: "team", tournament_id: "tournament", teams: { owner_user_id: "owner" } } : { id: "tournament", registration_open: !state.closed, suspended: !!state.suspended } };
        },
        async insert(row) { state.calls.push({ table, row }); return { error: state.ledgerError ? { message: "private database failure" } : null }; },
      };
    },
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === "registration_allow") return { data: !state.limited };
      if (name === "team_link_info") return { data: { open: !state.closed, full: false, team: "Royals" } };
      if (state.writeError) return { error: state.writeError };
      return { data: name === "register_player" ? { id: "saved", duplicate: !!state.duplicate } : "saved" };
    },
    storage: { from() { return {
      getPublicUrl(p) { return { data: { publicUrl: `https://example.invalid/${p}` } }; },
      async upload(p) { state.uploads.push(p); return { error: state.storageError ? { message: "private storage failure" } : null }; },
      async remove(paths) { state.removed.push(...paths); return { error: null }; },
    }; } },
  };
  globalThis.registrationFixture = state;
  return state;
}
function photoForm() {
  const body = new FormData(); body.set("Name", "Ravi"); body.set("Phone", "9876543210");
  body.set("photo", new File([new Uint8Array([255, 216, 255, 224])], "photo.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost", { method: "POST", body });
}
test("Google Form fields reach one atomic registration RPC with canonical phone", async () => {
  const state = fixture(); const response = await register(json(valid), ctx);
  assert.equal(response.status, 200);
  const calls = state.calls.filter(c => c.name === "register_player"); assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_player.phone, "+919876543210"); assert.equal(calls[0].args.p_player.name, "Ravi");
  assert.ok(!state.calls.some(c => ["players", "player_contacts"].includes(c.table)));
});
test("missing phone and malformed age fail before player writes", async () => {
  for (const data of [{ Name: "Ravi" }, { ...valid, Age: "twenty" }, { ...valid, Age: "-24" }]) {
    const state = fixture(); assert.equal((await register(json(data), ctx)).status, 400);
    assert.ok(!state.calls.some(c => c.name === "register_player"));
  }
});
test("closed and suspended tournaments reject registrations", async () => {
  for (const options of [{ closed: true }, { suspended: true }]) { fixture(options); assert.equal((await register(json(valid), ctx)).status, 403); }
});
test("rate limiting stops the submission before storage and player writes", async () => {
  const state = fixture({ limited: true }); assert.equal((await register(photoForm(), ctx)).status, 429); assert.equal(state.uploads.length, 0);
});
test("photo storage failure never reports complete success", async () => {
  const state = fixture({ storageError: true }); const response = await register(photoForm(), ctx);
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("private storage failure"));
  assert.ok(!state.calls.some(c => c.name === "register_player"));
});
test("confirmed database rollback cleans up its photo and hides internal errors", async () => {
  const state = fixture({ writeError: { code: "23514", message: "private contact table failure" } }); const response = await register(photoForm(), ctx);
  assert.equal(response.status, 503); assert.equal(state.removed.length, 1); assert.ok(!(await response.text()).includes("private contact table"));
});
test("ambiguous transport failures retain recoverable upload instead of deleting a possibly committed photo", async () => {
  const state = fixture({ writeError: { code: "", message: "response lost" } });
  assert.equal((await register(photoForm(), ctx)).status, 503); assert.equal(state.removed.length, 0);
  assert.ok(state.calls.some(c => c.table === "registration_uploads"));
});
test("duplicate submission cleans up only the newly uploaded photo", async () => {
  const state = fixture({ duplicate: true }); const response = await register(photoForm(), ctx);
  assert.equal((await response.json()).duplicate, true); assert.deepEqual(state.removed, state.uploads);
});
test("public team join requires a phone and owner exemption requires an active owner", async () => {
  fixture(); assert.equal((await join(json({ Name: "Ravi" }), ctx)).status, 400);
  fixture({ user: { id: "owner" } }); const request = json({ Name: "Ravi" }); request.headers.set("authorization", "Bearer test");
  assert.equal((await join(request, ctx)).status, 200);
  fixture({ user: { id: "owner" }, pausedUser: true }); const paused = json(valid); paused.headers.set("authorization", "Bearer test");
  assert.equal((await join(paused, ctx)).status, 403);
});
