import { INVITES_MAX, INVITES_SENT_MAX, USER_ID_PATTERN } from "./constants.js";
import type { PlayerDoc } from "./db.js";

// Invites, which earn the client's permanent Friend Boost (+10% Skill per friend who joined, capped
// client-side by FRIEND_BOOST.max): a friend counts once they actually JOIN, credited by the server:
// a SIGNED-IN player joins through the inviter's link (`ref` in the join options) or after the
// inviter's direct Bloxity invite (`invitesSent`); each account counts once ever (`invitedBy` is set
// once, with a conditional write, so two rooms or pods can't both credit it). Signed-in players only:
// a guest can't invite through Bloxity, nor be credited.
export interface InviteState {
  sent: string[]; // friend ids invited directly (newest last, bounded)
  joined: number; // friends who joined through this player's invites
}

export const isUserId = (v: unknown): v is string => typeof v === "string" && USER_ID_PATTERN.test(v);

// The saved state from a player's doc (missing fields = nothing yet), bounded.
export function readInvite(doc: Partial<PlayerDoc> | null): InviteState {
  const joined = Number.isInteger(doc?.invites) ? Math.min(INVITES_MAX, Math.max(0, doc!.invites!)) : 0;
  const sent = Array.isArray(doc?.invitesSent) ? [...new Set(doc!.invitesSent!.filter(isUserId))].slice(-INVITES_SENT_MAX) : [];
  return { sent, joined };
}

// Remembers a direct invite (newest last, bounded). False when it changed nothing.
export function rememberSent(s: InviteState, friendId: string): boolean {
  if (s.sent[s.sent.length - 1] === friendId) return false;
  s.sent = [...s.sent.filter((id) => id !== friendId), friendId].slice(-INVITES_SENT_MAX);
  return true;
}

// What the client is sent (`invite`): friends who joined, and whether any invite was sent.
export const inviteView = (s: InviteState) => ({ joined: s.joined, sent: s.sent.length });
