import { sql } from '@vercel/postgres';
import {
  ChannelType,
  type ChatInputApplicationCommandData,
  Client,
  type Interaction,
  type Message,
  Partials,
  PermissionFlagsBits,
} from 'discord.js';
import dotenv from 'dotenv';

import type {
  AutoReactionEmoji,
  Command,
  QueryCache,
  ReactionAgentEmoji,
  ReactionData,
} from './types';

dotenv.config();

const regexCache = new Map<string, RegExp>();

const queryCache: QueryCache = {
  autoReactionEmojis: [],
  reactionAgentEmojis: [],
  commands: [],
  slashCommands: [],
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

  const slashCommands = await sql<Command>`
    SELECT c.command, c.response,
      COALESCE(array_agg(e.value) FILTER (WHERE e.value IS NOT NULL), '{}') as values
    FROM slash_commands c
    LEFT JOIN slash_commands_emojis ce ON c.id = ce."commandId"
    LEFT JOIN emojis e ON e.id = ce."emojiId"
    GROUP BY c.id, c.command, c.response
    ORDER BY c.id ASC;
  `;
  queryCache.slashCommands = slashCommands.rows;
};

export const updateSlashCommands = async (
  client: Client,
  queryCache: QueryCache,
) => {
  const commands = queryCache.slashCommands.map((row) => {
    return {
      name: row.command,
      description: row.response,
    } as ChatInputApplicationCommandData;
  });
  commands.push({
    name: 'update-query-cache',
    description: 'Update query cache',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  });

  await client.application?.commands.set(
    commands,
    process.env.GUILD_ID as string,
  );
};

export const handleClientReady =
  ({
    updateQueryCache,
    updateSlashCommands,
  }: {
    updateQueryCache: (queryCache: QueryCache) => Promise<void>;
    updateSlashCommands: (
      client: Client,
      queryCache: QueryCache,
    ) => Promise<void>;
  }) =>
  async () => {
    await updateQueryCache(queryCache);
    await updateSlashCommands(client, queryCache);
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
    queryCache,
    updateQueryCache,
  }: {
    queryCache: QueryCache;
    updateQueryCache: (queryCache: QueryCache) => Promise<void>;
  }) =>
  async (interaction: Interaction) => {
    if (!interaction.isCommand()) {
      return;
    }
    if (
      interaction.commandName === 'update-query-cache' &&
      interaction.channelId === process.env.UPDATE_QUERY_CACHE_CHANNEL_ID
    ) {
      const response = await interaction.reply('Updating query cache...');
      await updateQueryCache(queryCache);
      await response.edit('Updated query cache');
    }

    const command = queryCache.slashCommands.find(
      (row) => row.command === interaction.commandName,
    );
    if (command) {
      const response = await interaction.reply(command.response);
      const message = await response.fetch();
      messageReaction({ message, reactionData: command });
    }
  };

const client = new Client({
  intents: ['DirectMessages', 'Guilds', 'GuildMessages', 'MessageContent'],
  partials: [Partials.Channel],
});

client.on(
  'ready',
  handleClientReady({ updateQueryCache, updateSlashCommands }),
);

client.on(
  'messageCreate',
  handleMessageCreate({ client, regexCache, queryCache, updateQueryCache }),
);

client.on(
  'interactionCreate',
  handleInteractionCreate({ queryCache, updateQueryCache }),
);

client.login(process.env.DISCORD_BOT_TOKEN);
