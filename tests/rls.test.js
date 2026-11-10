// Runs supabase/schema.sql in a real Postgres (PGlite) and checks the role rules:
// a Viewer cannot write anything even "through the console", an Editor can only add, only the owner is Admin.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const OWNER = 'constancechan.cc@gmail.com';
let db;

// Minimal stand-in for what Supabase provides: roles + auth.jwt()
const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public to anon, authenticated;
  create schema auth; grant usage on schema auth to anon, authenticated;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
`;

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')); // re-runnable
  await db.exec(`insert into app_users values ('editor@gmail.com','editor'), ('viewer@gmail.com','viewer');
    insert into listings (id, day, data) values ('L1', '2026-11-09', '{"title":"Taman Molek"}');
    insert into requests (id, day, data) values ('R1', '2026-11-09', '{"raw":"WTB"}');
    insert into meta (id, data) values ('importLog', '{"runs":[]}'), ('driveState', '{"files":{}}');`);
});

/** Run SQL as a signed-in user (or anonymous when email is null). Returns rows, or throws. */
async function as(email, sql, { provider = 'google' } = {}) {
  const claims = email ? { email, app_metadata: { provider, providers: [provider] } } : {};
  await db.exec(`reset role; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role ${email ? 'authenticated' : 'anon'};`);
  try {
    const r = await db.query(sql);
    return r;
  } finally {
    await db.exec('reset role;');
  }
}
const rows = async (email, sql, o) => (await as(email, sql, o)).rows;
const count = async (email, table) => (await rows(email, `select count(*)::int as n from ${table}`))[0].n;

test('roles: owner is the only admin; unknown, anonymous and e-mail/password users get none', async () => {
  assert.equal((await rows(OWNER, 'select app_role() r'))[0].r, 'admin');
  assert.equal((await rows('editor@gmail.com', 'select app_role() r'))[0].r, 'editor');
  assert.equal((await rows('viewer@gmail.com', 'select app_role() r'))[0].r, 'viewer');
  assert.equal((await rows('stranger@gmail.com', 'select app_role() r'))[0].r, 'none');
  assert.equal((await rows(OWNER, 'select app_role() r', { provider: 'email' }))[0].r, 'none');
});

test('strangers and anonymous visitors see nothing', async () => {
  assert.equal(await count('stranger@gmail.com', 'listings'), 0);
  assert.equal(await count('stranger@gmail.com', 'requests'), 0);
  await assert.rejects(as(null, 'select * from listings'));
});

test('ACCEPT: a Viewer can read but cannot write anything', async () => {
  assert.equal(await count('viewer@gmail.com', 'listings'), 1);
  await assert.rejects(as('viewer@gmail.com', `insert into listings (id, day, data) values ('L9', '2026-11-09', '{}')`), /row-level security/);
  await assert.rejects(as('viewer@gmail.com', `insert into seen values ('h9', '2026-11-09')`), /row-level security/);
  await assert.rejects(as('viewer@gmail.com', `insert into app_users values ('me@gmail.com', 'editor')`), /row-level security/);
  // updates / deletes silently touch 0 rows under RLS
  assert.equal((await as('viewer@gmail.com', `update listings set data = '{}'`)).affectedRows, 0);
  assert.equal((await as('viewer@gmail.com', `delete from listings`)).affectedRows, 0);
  assert.equal((await as('viewer@gmail.com', `update app_users set role = 'editor' where email = 'viewer@gmail.com'`)).affectedRows, 0);
  assert.equal(await count(OWNER, 'listings'), 1);
});

test('an Editor can add (and skip duplicates) but not change, delete or manage users', async () => {
  const ins = await as('editor@gmail.com', `insert into listings (id, day, data) values ('L2', '2026-11-09', '{}'), ('L1', '2026-11-09', '{}') on conflict (id) do nothing returning id`);
  assert.deepEqual(ins.rows.map((r) => r.id), ['L2']);
  await as('editor@gmail.com', `insert into seen values ('h1', '2026-11-09') on conflict do nothing`);
  await assert.rejects(as('editor@gmail.com', `insert into requests (id, day, status, data) values ('R2', '2026-11-09', 'closed', '{}')`), /row-level security/);
  assert.equal((await as('editor@gmail.com', `update listings set data = '{}' where id = 'L1'`)).affectedRows, 0);
  assert.equal((await as('editor@gmail.com', `delete from listings`)).affectedRows, 0);
  assert.equal((await as('editor@gmail.com', `delete from seen`)).affectedRows, 0);
  await assert.rejects(as('editor@gmail.com', `insert into app_users values ('x@gmail.com', 'viewer')`), /row-level security/);
});

test('admin can manage everything but can never create a second admin', async () => {
  assert.equal((await as(OWNER, `update requests set status = 'closed' where id = 'R1'`)).affectedRows, 1);
  await as(OWNER, `insert into app_users values ('new@gmail.com', 'viewer')`);
  await assert.rejects(as(OWNER, `insert into app_users values ('boss@gmail.com', 'admin')`), /check/);
  assert.equal((await as(OWNER, `delete from listings where id = 'L2'`)).affectedRows, 1);
  await as(OWNER, `insert into meta (id, data) values ('branding', '{"logo":""}')`);
  await assert.rejects(as(OWNER, `insert into meta (id, data) values ('other', '{}')`), /row-level security/);
  await as(OWNER, `insert into meta (id, data) values ('groupSources', '{"map":{}}')`);
  assert.equal((await as('editor@gmail.com', `update meta set data = '{}' where id = 'groupSources'`)).affectedRows, 0);
});

test('users can only see their own allowlist row; driveState stays server-only', async () => {
  assert.deepEqual((await rows('viewer@gmail.com', 'select email from app_users')).map((r) => r.email), ['viewer@gmail.com']);
  assert.ok((await rows(OWNER, 'select email from app_users')).length >= 2);
  assert.deepEqual((await rows('viewer@gmail.com', 'select id from meta order by id')).map((r) => r.id), ['branding', 'groupSources', 'importLog']);
});
