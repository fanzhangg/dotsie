/* A trip's own tables, in its TripRoom's SQLite. Each trip gets the changes it hasn't had yet, in order, one transaction
   each, and remembers how far it has got (the `schema` table). To change the tables, add a change at the end; never edit
   one that has shipped, since trips that already had it won't run it again. No Workers APIs, so the tests run it on
   Node's SQLite. */

// What the changes need of the database: SqlStorage's exec (a type only, so Node runs this file as it is)
export type Sql = Pick<SqlStorage, 'exec'>;

const columns = (sql: Sql, table: string) => new Set(sql.exec<{ name: string }>(`pragma table_info(${table})`).toArray().map(c => c.name));

export const SCHEMA: ((sql: Sql) => void)[] = [
  // 1. Everything up to when trips started counting their changes: the tables as they launched, and the columns added
  //    to them since, each only where a trip doesn't have it yet, so a trip stored by any version before gets them all.
  sql => {
    sql.exec(`
      create table if not exists trip (id text primary key, name text not null, created_by text not null, invite text not null, deleted_at integer);
      create table if not exists members (id text primary key, name text not null, image text, identity integer not null, joined_at integer not null);
      create table if not exists stops (
        id text primary key, name text not null, address text not null, lat real not null, lng real not null,
        time text not null, note text not null, done integer not null, by text not null, updated_at integer not null
      );`);
    const stops = columns(sql, 'stops'), trip = columns(sql, 'trip');
    const added: [Set<string>, string, string, string][] = [
      // stop types, hotel nights, check-out time and how you get there
      [stops, 'stops', 'kind', "text not null default ''"],
      [stops, 'stops', 'nights', 'integer'],
      [stops, 'stops', 'checkout', 'text'],
      [stops, 'stops', 'travel', "text not null default 'drive'"],
      [stops, 'stops', 'back', "text not null default '{}'"],
      // links, and the Wikidata item of a stop added from a sight
      [stops, 'stops', 'links', "text not null default '[]'"],
      [stops, 'stops', 'wikidata', 'text'],
      // a time zone other than the place's own, and how long you're there
      [stops, 'stops', 'tz', 'text'],
      [stops, 'stops', 'duration', 'integer'],
      // the D1 copy's revision, and when the trip was last edited (null for a trip last edited before, whose D1 row has it)
      [trip, 'trip', 'rev', 'integer not null default 0'],
      [trip, 'trip', 'edited_at', 'integer'],
    ];
    for (const [has, table, name, type] of added) if (!has.has(name)) sql.exec(`alter table ${table} add column ${name} ${type}`);
  },
  // 2. What nothing reads any more: the folders stops were grouped in for a day (2026-11-06), and done, which the app
  //    stopped showing. An older client may still send done; cleanStop checks it and drops it.
  sql => {
    sql.exec('drop table if exists folders');
    const stops = columns(sql, 'stops');
    if (stops.has('folder')) sql.exec('alter table stops drop column folder');
    if (stops.has('done')) sql.exec('alter table stops drop column done');
  },
];

// Bring a trip's tables up to date. `transaction` runs a change as one transaction (the TripRoom's transactionSync).
export function migrate(sql: Sql, transaction: (fn: () => void) => void) {
  sql.exec('create table if not exists schema (id integer primary key check (id = 1), version integer not null)');
  let version = sql.exec<{ version: number }>('select version from schema').toArray()[0]?.version ?? 0;
  for (; version < SCHEMA.length; version++) {
    const next = version + 1;
    transaction(() => {
      SCHEMA[version](sql);
      sql.exec('insert into schema (id, version) values (1, ?) on conflict (id) do update set version = excluded.version', next);
    });
  }
}
