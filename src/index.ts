import { type QueryResultRow, sql } from '@vercel/postgres';
import { ChannelType, Client, type Message, Partials } from 'discord.js';
import dotenv from 'dotenv';

import type { QueryCache } from './types';

dotenv.config();

const regexCache = new Map<string, RegExp>();

const queryCache: QueryCache = {
  autoReactionEmojis: [],
  reactionAgentEmojis: [],
  commands: [],
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
  queryResultRow,
}: {
  message: Message;
  queryResultRow: QueryResultRow;
}) => {
  for (const value of queryResultRow.values) {
    try {
      message.react(value);
    } catch {}
  }
};

export const updateQueryCache = async (queryCache: QueryCache) => {
  const autoReactionEmojis = await sql`
    SELECT ar.command, array_agg(e.value) as values
    FROM auto_reactions ar
    JOIN auto_reactions_emojis are ON ar.id = are."autoReactionId"
    JOIN emojis e ON e.id = are."emojiId"
    GROUP BY ar.id, ar.command
    ORDER BY ar.id ASC;
  `;
  queryCache.autoReactionEmojis = autoReactionEmojis.rows;

  const reactionAgentEmojis = await sql`
    SELECT ra.command, array_agg(e.value) as values
    FROM reactions_agents ra
    JOIN reactions_agents_emojis rae ON ra.id = rae."reactionAgentId"
    JOIN emojis e ON e.id = rae."emojiId"
    GROUP BY ra.id, ra.command
    ORDER BY ra.id ASC;
  `;
  queryCache.reactionAgentEmojis = reactionAgentEmojis.rows;

  const commands = await sql`
    SELECT c.command, c.response, array_agg(e.value) as values
    FROM commands c
    JOIN commands_emojis ce ON c.id = ce."commandId"
    JOIN emojis e ON e.id = ce."emojiId"
    GROUP BY c.id, c.command, c.response
    ORDER BY c.id ASC;
  `;
  queryCache.commands = commands.rows;
};

export const handleClientReady = () => {
  return updateQueryCache(queryCache);
};

export const handleMessageCreate =
  ({
    client,
    regexCache,
    queryCache,
  }: {
    client: Client;
    regexCache: Map<string, RegExp>;
    queryCache: QueryCache;
  }) =>
  async (message: Message) => {
    for (const row of queryCache.autoReactionEmojis) {
      const regExp = getOrCreateRegExp(row.command, regexCache);
      if (regExp.test(message.content)) {
        messageReaction({ message, queryResultRow: row });
      }
    }

    if (message.reference?.messageId) {
      for (const row of queryCache.reactionAgentEmojis) {
        if (row.command === message.content) {
          const repliedMessage = await message.fetchReference();
          message.delete();
          messageReaction({
            message: repliedMessage,
            queryResultRow: row,
          });
        }
      }
    }

    for (const row of queryCache.commands) {
      if (row.command === message.content) {
        message.reply(row.response);
        messageReaction({ message, queryResultRow: row });
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

const client = new Client({
  intents: ['DirectMessages', 'Guilds', 'GuildMessages', 'MessageContent'],
  partials: [Partials.Channel],
});

client.on('ready', handleClientReady);

client.on(
  'messageCreate',
  handleMessageCreate({ client, regexCache, queryCache }),
);

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (process.env.PAYMENT_WEBHOOK) {
    await fetch(process.env.PAYMENT_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: interaction.customId,
        username: interaction.user.username,
        avatar_url: interaction.user.displayAvatarURL(),
      }),
    });
  }

  if (interaction.customId === 'confirm') {
    await interaction.reply('ご確認ありがとうございます 💖');
  } else if (interaction.customId === 'transfer') {
    await interaction.reply(`お振り込みのご連絡ありがとうございます。
確認ができ次第またご連絡いたします！`);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
