/* D1's copy of one trip (see "The D1 copy" in trip.ts): the statements that write it, as SQL and values, so the tests
   run them on SQLite the way D1 does. D1 runs a batch as one transaction. */

export type TripCopy = {
  id: string; name: string; inviteHash: string; first: string | null; last: string | null; preview: string;
  deletedAt: number | null; editedAt: number | null; rev: number; members: { id: string; joined: number }[];
};

export function copyStatements(c: TripCopy): [string, unknown[]][] {
  const members = JSON.stringify(c.members);
  // The members change only if this copy won: its rev is the row's now
  const won = 'exists (select 1 from trips where id = ?1 and rev = ?3)';
  return [
    // A copy older than the row's is ignored. A trip last edited before TripRooms kept when (editedAt null) keeps D1's.
    // This runs on every change to every trip, so it's written to cost D1 one row: an update, and an insert only for a
    // row that isn't there yet, rather than an upsert (two rows); and the share link's hash, which is indexed and so
    // costs another row whenever it's set, only when it's a new link.
    [`update trips set name = ?2, first_stop = ?4, last_stop = ?5, preview = ?6, deleted_at = ?7, updated_at = coalesce(?8, updated_at), rev = ?9
      where id = ?1 and rev < ?9`, [c.id, c.name, c.inviteHash, c.first, c.last, c.preview, c.deletedAt, c.editedAt, c.rev]],
    [`update trips set invite_hash = ?2 where id = ?1 and rev = ?3 and invite_hash is not ?2`, [c.id, c.inviteHash, c.rev]],
    [`insert into trips (id, name, invite_hash, first_stop, last_stop, preview, deleted_at, updated_at, rev)
      select ?1, ?2, ?3, ?4, ?5, ?6, ?7, coalesce(?8, 0), ?9 where not exists (select 1 from trips where id = ?1)`,
      [c.id, c.name, c.inviteHash, c.first, c.last, c.preview, c.deletedAt, c.editedAt, c.rev]],
    [`delete from trip_members where trip_id = ?1 and user_id not in (select json_extract(value, '$.id') from json_each(?2)) and ${won}`,
      [c.id, members, c.rev]],
    // Only people D1 still has an account for: a deleted one would fail the whole batch on its foreign key
    [`insert or ignore into trip_members (trip_id, user_id, joined_at)
      select ?1, json_extract(value, '$.id'), json_extract(value, '$.joined') from json_each(?2)
      where ${won} and exists (select 1 from "user" u where u.id = json_extract(value, '$.id'))`, [c.id, members, c.rev]],
  ];
}
