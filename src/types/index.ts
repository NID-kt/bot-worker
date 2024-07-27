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

export interface ContextMenuReaction extends ReactionData {
  name: string;
}

export interface QueryCache {
  autoReactionEmojis: AutoReactionEmoji[];
  reactionAgentEmojis: ReactionAgentEmoji[];
  commands: Command[];
  contextMenuReactions: ContextMenuReaction[];
}
