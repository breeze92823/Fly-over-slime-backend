import { SPIN_CAP, SPIN_EVERY_MS, SPIN_START, SPIN_WEDGES, SPINS_MAX } from "./constants.js";
import { finite, clampInt } from "./sanitize.js";

// The Spin wheel is the one server-authoritative system: the server owns each player's spin count
// and free-spin clock and rolls every spin, so a client can neither give itself spins nor pick its
// prize. The client only animates the result and grants the prize into its own (saved) state.

export interface SpinState {
  spins: number; // spins ready to use
  nextAt: number; // epoch ms the next free spin arrives (while below SPIN_CAP)
}

// One free spin per SPIN_EVERY_MS of real time (online or not) until SPIN_CAP are stored. While
// capped the clock waits, so the next free spin is a full interval after one is used.
export function accrue(s: SpinState, now: number): void {
  while (s.spins < SPIN_CAP && now >= s.nextAt) {
    s.spins++;
    s.nextAt += SPIN_EVERY_MS;
  }
  if (s.spins >= SPIN_CAP) s.nextAt = now + SPIN_EVERY_MS;
}

// A saved doc's spin fields (a doc from before the wheel, or a new player, starts fresh).
export function spinStateFrom(doc: { spins?: unknown; spinAt?: unknown } | null, now: number): SpinState {
  const fresh = { spins: SPIN_START, nextAt: now + SPIN_EVERY_MS };
  if (!doc || !finite(doc.spins) || !finite(doc.spinAt)) return fresh;
  // A clock further ahead than one interval can only be a bad value: cap it.
  const s = { spins: clampInt(doc.spins, SPINS_MAX), nextAt: Math.min(doc.spinAt, now + SPIN_EVERY_MS) };
  accrue(s, now);
  return s;
}

// A wedge by weight. `rand` in [0, 1) (tests pass their own).
export function rollWedge(rand = Math.random()): (typeof SPIN_WEDGES)[number] {
  const total = SPIN_WEDGES.reduce((n, w) => n + w.weight, 0);
  let r = rand * total;
  for (const w of SPIN_WEDGES) {
    if (r < w.weight) return w;
    r -= w.weight;
  }
  return SPIN_WEDGES[SPIN_WEDGES.length - 1];
}
