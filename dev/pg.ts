// Local Postgres (PGlite, real Postgres compiled to WASM) with the same migrations
// as production plus a small stand-in for the parts Supabase provides (auth schema, roles).
// Used by the local backend and by the database tests.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, password text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- minimal stand-in for Supabase Storage (enough for the storage migration's bucket and policies)
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
`;

export interface Claims { role: 'anon' | 'authenticated' | 'service_role'; sub?: string }

export class LocalDb {
  constructor(public pg: PGlite) {}

  static async create(dataDir?: string): Promise<LocalDb> {
    const pg = new PGlite(dataDir);
    await pg.waitReady;
    const done = await pg.query<{ n: number }>(
      `select count(*)::int n from pg_namespace where nspname = 'auth'`,
    );
    if (done.rows[0].n === 0) {
      await pg.exec(SUPABASE_SHIM);
      const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
        await pg.exec(readFileSync(join(dir, f), 'utf8'));
      }
    }
    return new LocalDb(pg);
  }

  /** Calls public.<fn>(named args) the way PostgREST does: as the caller's role, with their JWT claims. */
  async rpc(fn: string, args: Record<string, unknown>, claims: Claims): Promise<unknown> {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new RpcError('bad_function', 404);
    const keys = Object.keys(args).filter((k) => /^p(_[a-z0-9_]+)?$/.test(k));
    const params = keys.map((k) => {
      const v = args[k];
      if (v === null || v === undefined) return null;
      if (Array.isArray(v)) return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    return this.pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await tx.exec(`set local role ${claims.role}`);
      try {
        const res = await tx.query<{ r: unknown }>(call, params);
        return res.rows[0]?.r ?? null;
      } catch (e) {
        const err = e as { message?: string; code?: string; detail?: string };
        if (err.code === '42501') throw new RpcError('permission denied for function ' + fn, 401, err.code);
        if (err.code === '42883') throw new RpcError(err.message ?? 'no function', 404, 'PGRST202');
        throw new RpcError(err.message ?? 'error', 400, err.code, err.detail);
      }
    });
  }
}

export class RpcError extends Error {
  constructor(message: string, public status = 400, public code?: string, public detail?: string) {
    super(message);
  }
}
