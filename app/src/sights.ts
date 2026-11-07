/* The lookup of one map tile's sights, in its own Durable Object (one per tile, named "x/y").

   A request can wait for Overpass only about 30 s, response and waitUntil together, and the public Overpass servers
   often take 20–30 s for a tile, queueing included, however few places it has: a small tile took 20 s, Santa Fe's
   plaza 28. So the lookup runs in this object's alarm instead, which can run for minutes: both servers are asked at
   once, each given a minute, and if both fail it tries once more a little later. What it finds goes into KV for
   everyone (see findSights in maps.ts) and is kept here for a few minutes too, since a KV write can take a while to
   show up in other places, and the request asking again may come from one of them.

   Its storage holds at most: the job while it runs, what it found or when it last failed, and nothing an hour on. */
import { DurableObject } from 'cloudflare:workers';
import { keep, overpassSights, sightsKey, tileBounds, type Sight } from './maps';

// Tries before giving up, and the wait between them
const TRIES = 2, RETRY_IN = 15_000;
// How long this object answers with what it found, and how long it says "failed" without asking Overpass again:
// a few minutes with nothing to show, an hour while the tile has an older copy to show meanwhile
const DONE_FOR = 10 * 60_000, FAILED_FOR = 2 * 60_000, FAILED_FOR_STALE = 60 * 60_000, FORGET_IN = 60 * 60_000;

type Job = { x: number; y: number; stale: boolean; tries: number };
export type Look = { sights: Sight[] } | 'pending' | 'failed';

export class SightsLookup extends DurableObject<Env> {
  // What it found just now, that it's still looking, or that it failed a moment ago. Starts a lookup when none is
  // running and there's nothing recent to say. stale: KV has an older copy of this tile, shown meanwhile.
  async look(x: number, y: number, stale: boolean): Promise<Look> {
    const now = Date.now(), s = this.ctx.storage;
    const done = await s.get<{ at: number; sights: Sight[] }>('done');
    if (done && now - done.at < DONE_FOR) return { sights: done.sights };
    if (await s.get<Job>('job')) return 'pending';
    const failed = await s.get<number>('failed');
    if (failed && now - failed < (stale ? FAILED_FOR_STALE : FAILED_FOR)) return 'failed';
    await s.put('job', { x, y, stale, tries: 0 } satisfies Job);
    await s.setAlarm(now);
    return 'pending';
  }

  async alarm() {
    const s = this.ctx.storage, job = await s.get<Job>('job');
    if (!job) return s.deleteAll(); // nothing running: what was kept here has served its time
    try {
      const sights = await overpassSights(tileBounds(job.x, job.y));
      await keep(this.env, sightsKey(job.x, job.y), sights);
      await s.put('done', { at: Date.now(), sights });
      await s.delete(['job', 'failed']);
      await s.setAlarm(Date.now() + FORGET_IN);
    } catch (err) {
      console.error(`Sights ${job.x}/${job.y}, try ${job.tries + 1} of ${TRIES}:`, err);
      if (job.tries + 1 < TRIES) {
        await s.put('job', { ...job, tries: job.tries + 1 });
        await s.setAlarm(Date.now() + RETRY_IN);
        return;
      }
      await s.put('failed', Date.now());
      await s.delete('job');
      await s.setAlarm(Date.now() + FORGET_IN);
    }
  }
}
