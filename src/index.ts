import { sql } from '@vercel/postgres';
import {
  ApplicationCommandType,
  ChannelType,
  Client,
  ContextMenuCommandBuilder,
  type Interaction,
  type Message,
  Partials,
  REST,
  Routes,
} from 'discord.js';
import dotenv from 'dotenv';

import type {
  AutoReactionEmoji,
  Command,
  ContextMenuReaction,
  QueryCache,
  ReactionAgentEmoji,
  ReactionData,
} from './types';
import { toFormatEmoji } from './utils';

dotenv.config();

const regexCache = new Map<string, RegExp>();
const commandToEmojiStringMap = new Map<string, string>();

const queryCache: QueryCache = {
  autoReactionEmojis: [],
  reactionAgentEmojis: [],
  commands: [],
  contextMenuReactions: [],
};

const getOrCreateRegExp = (
  command: string,
  regexCache: Map<string, RegExp>,
) => {
  let regExp = regexCache.get(command);
  if (!regExp) {
    regExp = new RegExp(command);
    regexCache.set(command, regExp);
  }
  return regExp;
};

export const messageReaction = ({
  message,
  reactionData,
}: {
  message: Message;
  reactionData: ReactionData;
}) => {
  for (const value of reactionData.values) {
    try {
      message.react(value);
    } catch {}
  }
};

export const updateQueryCache = async (queryCache: QueryCache) => {
  const autoReactionEmojis = await sql<AutoReactionEmoji>`
    SELECT ar.command, array_agg(e.value) as values
    FROM auto_reactions ar
    JOIN auto_reactions_emojis are ON ar.id = are."autoReactionId"
    JOIN emojis e ON e.id = are."emojiId"
    GROUP BY ar.id, ar.command
    ORDER BY ar.id ASC;
  `;
  queryCache.autoReactionEmojis = autoReactionEmojis.rows;

  const reactionAgentEmojis = await sql<ReactionAgentEmoji>`
    SELECT ra.command, array_agg(e.value) as values
    FROM reactions_agents ra
    JOIN reactions_agents_emojis rae ON ra.id = rae."reactionAgentId"
    JOIN emojis e ON e.id = rae."emojiId"
    GROUP BY ra.id, ra.command
    ORDER BY ra.id ASC;
  `;
  queryCache.reactionAgentEmojis = reactionAgentEmojis.rows;

  const commands = await sql<Command>`
    SELECT c.command, c.response,
      COALESCE(array_agg(e.value) FILTER (WHERE e.value IS NOT NULL), '{}') as values
    FROM commands c
    LEFT JOIN commands_emojis ce ON c.id = ce."commandId"
    LEFT JOIN emojis e ON e.id = ce."emojiId"
    GROUP BY c.id, c.command, c.response
    ORDER BY c.id ASC;
  `;
  queryCache.commands = commands.rows;

  const contextMenuReactions = await sql<ContextMenuReaction>`
    SELECT c.name, array_agg(e.value) as values
    FROM context_menu_reactions c
    JOIN context_menu_reactions_emojis cme ON c.id = cme."contextMenuReactionId"
    JOIN emojis e ON e.id = cme."emojiId"
    GROUP BY c.id, c.name
    ORDER BY c.id ASC;
  `;
  queryCache.contextMenuReactions = contextMenuReactions.rows;
};

export const updateCommandToEmojiStringMap = async ({
  commandToEmojiStringMap,
  queryCache,
}: {
  commandToEmojiStringMap: Map<string, string>;
  queryCache: QueryCache;
}) => {
  for (const row of queryCache.contextMenuReactions) {
    const formattedEmojis = await Promise.all(
      row.values.map(toFormatEmoji(rest, process.env.GUILD_ID as string)),
    );
    commandToEmojiStringMap.set(row.name, formattedEmojis.join(' '));
  }
};

export const updateApplicationCommands = ({
  rest,
  queryCache,
}: { rest: REST; queryCache: QueryCache }) => {
  const commands = queryCache.contextMenuReactions.map((row) => {
    return new ContextMenuCommandBuilder()
      .setName(row.name)
      .setType(ApplicationCommandType.Message);
  });

  return rest.put(
    Routes.applicationGuildCommands(
      process.env.BOT_APPLICATION_ID as string,
      process.env.GUILD_ID as string,
    ),
    {
      body: commands,
    },
  );
};

export const handleClientReady =
  ({
    updateQueryCache,
    updateApplicationCommands,
    updateCommandToEmojiStringMap,
  }: {
    updateQueryCache: (queryCache: QueryCache) => Promise<void>;
    updateApplicationCommands: ({
      rest,
      queryCache,
    }: {
      rest: REST;
      queryCache: QueryCache;
    }) => Promise<unknown>;
    updateCommandToEmojiStringMap: ({
      commandToEmojiStringMap,
      queryCache,
    }: {
      commandToEmojiStringMap: Map<string, string>;
      queryCache: QueryCache;
    }) => Promise<void>;
  }) =>
  async () => {
    await updateQueryCache(queryCache);
    await Promise.all([
      updateApplicationCommands({ rest, queryCache }),
      updateCommandToEmojiStringMap({
        commandToEmojiStringMap,
        queryCache,
      }),
    ]);
  };

export const handleMessageCreate =
  ({
    client,
    regexCache,
    queryCache,
    updateQueryCache,
  }: {
    client: Client;
    regexCache: Map<string, RegExp>;
    queryCache: QueryCache;
    updateQueryCache: (queryCache: QueryCache) => Promise<void>;
  }) =>
  async (message: Message) => {
    if (
      message.content === '!updateQueryCache' &&
      message.channelId === process.env.UPDATE_QUERY_CACHE_CHANNEL_ID &&
      message.guildId === process.env.GUILD_ID
    ) {
      const reply = await message.reply('Updating query cache...');
      await updateQueryCache(queryCache);
      reply.reply('Updated query cache');
      return;
    }

    for (const row of queryCache.autoReactionEmojis) {
      const regExp = getOrCreateRegExp(row.command, regexCache);
      if (regExp.test(message.content)) {
        messageReaction({ message, reactionData: row });
      }
    }

    if (message.reference?.messageId) {
      for (const row of queryCache.reactionAgentEmojis) {
        if (row.command === message.content) {
          const repliedMessage = await message.fetchReference();
          message.delete();
          messageReaction({
            message: repliedMessage,
            reactionData: row,
          });
        }
      }
    }

    for (const row of queryCache.commands) {
      if (row.command === message.content) {
        message.reply(row.response);
        messageReaction({ message, reactionData: row });
      }
    }

    if (message.channel.type === ChannelType.DM) {
      if (process.env.AUDIT_LOG_WEBHOOK) {
        await fetch(process.env.AUDIT_LOG_WEBHOOK, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: message.content,
            username: message.author.username,
            avatar_url: message.author.displayAvatarURL(),
            flags: 4100,
          }),
        });
      }

      if (message.author.bot || process.env.STOP_SENDING_DM === 'true') {
        return;
      }

      message.reply(process.env.DM_MESSAGE_CONTENT ?? '');
    } else if (client.user && message.mentions.users.has(client.user.id)) {
      if (message.author.bot) {
        return;
      }

      message.reply(process.env.MENTION_MESSAGE_CONTENT ?? '');
    }
  };

export const handleInteractionCreate =
  ({
    commandToEmojiStringMap,
    queryCache,
  }: {
    commandToEmojiStringMap: Map<string, string>;
    queryCache: QueryCache;
  }) =>
  async (interaction: Interaction) => {
    if (interaction.isContextMenuCommand() && interaction.channel) {
      for (const row of queryCache.contextMenuReactions) {
        if (interaction.commandName === row.name) {
          const message = await interaction.channel.messages.fetch(
            interaction.targetId,
          );
          messageReaction({ message, reactionData: row });
          interaction.reply({
            content: `Reacted to ${message.url} with ${commandToEmojiStringMap.get(row.name)}`,
            ephemeral: true,
          });
        }
      }
    }
  };

const rest = new REST({ version: '10' }).setToken(
  process.env.DISCORD_BOT_TOKEN as string,
);

const client = new Client({
  intents: ['DirectMessages', 'Guilds', 'GuildMessages', 'MessageContent'],
  partials: [Partials.Channel],
});

client.on(
  'ready',
  handleClientReady({
    updateQueryCache,
    updateApplicationCommands,
    updateCommandToEmojiStringMap,
  }),
);

client.on(
  'messageCreate',
  handleMessageCreate({ client, regexCache, queryCache, updateQueryCache }),
);

client.on(
  'interactionCreate',
  handleInteractionCreate({
    commandToEmojiStringMap,
    queryCache,
  }),
);

client.login(process.env.DISCORD_BOT_TOKEN);
