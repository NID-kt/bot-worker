export interface ReactionData {
  values: string[];
}

export interface AutoReactionEmoji extends ReactionData {
  command: string;
}

export interface ReactionAgentEmoji extends ReactionData {
  command: string;
}

export interface Command extends ReactionData {
  response: string;
  command: string;
}

export interface QueryCache {
  autoReactionEmojis: AutoReactionEmoji[];
  reactionAgentEmojis: ReactionAgentEmoji[];
  commands: Command[];
}

export interface ScheduledEvent {
  id: string;
  name: string;
  description?: string | undefined | null;
  starttime: Date;
  endtime?: Date | undefined | null;
  creatorid?: string | undefined | null;
  location?: string | undefined | null;
  recurrence?: string | undefined | null;
}
