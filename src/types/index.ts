import type { QueryResultRow } from '@vercel/postgres';

export interface QueryCache {
  autoReactionEmojis: QueryResultRow[];
  reactionAgentEmojis: QueryResultRow[];
  commands: QueryResultRow[];
}
