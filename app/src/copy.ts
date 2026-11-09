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
    [`insert into trips (id, name, invite_hash, first_stop, last_stop, preview, deleted_at, updated_at, rev)
      values (?1, ?2, ?3, ?4, ?5, ?6, ?7, coalesce(?8, 0), ?9)
      on conflict (id) do update set name = excluded.name, invite_hash = excluded.invite_hash, first_stop = excluded.first_stop,
        last_stop = excluded.last_stop, preview = excluded.preview, deleted_at = excluded.deleted_at,
        updated_at = coalesce(?8, trips.updated_at), rev = excluded.rev
      where excluded.rev > trips.rev`, [c.id, c.name, c.inviteHash, c.first, c.last, c.preview, c.deletedAt, c.editedAt, c.rev]],
    [`delete from trip_members where trip_id = ?1 and user_id not in (select json_extract(value, '$.id') from json_each(?2)) and ${won}`,
      [c.id, members, c.rev]],
    // Only people D1 still has an account for: a deleted one would fail the whole batch on its foreign key
    [`insert or ignore into trip_members (trip_id, user_id, joined_at)
      select ?1, json_extract(value, '$.id'), json_extract(value, '$.joined') from json_each(?2)
      where ${won} and exists (select 1 from "user" u where u.id = json_extract(value, '$.id'))`, [c.id, members, c.rev]],
  ];
}
