// Rules for removing old data. The app only ever loads rows whose day is on or after cutoffDay(), so rows
// before it are already invisible; deleting them changes nothing for agents.
import { RETENTION_DAYS } from '../../../listinghub/js/core/constants.js';

const mytDay = (ts) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);

/** First day (Malaysia time) that is still loaded by the app: today − (retention + 1) days. Same formula as the app. */
export const cutoffDay = (now = Date.now()) => mytDay(now - (RETENTION_DAYS + 1) * 86400000);

/** The server refuses to delete anything newer than the cutoff, whatever the caller asks for. */
export const canDeleteBefore = (before, now = Date.now()) => /^\d{4}-\d{2}-\d{2}$/.test(before || '') && before <= cutoffDay(now);

export const OLD_TABLES = {
  listings: { key: 'id', columns: 'id,day,posted_at,data' },
  requests: { key: 'id', columns: 'id,day,posted_at,status,data' },
  seen: { key: 'hash', columns: 'hash,day' },
};
