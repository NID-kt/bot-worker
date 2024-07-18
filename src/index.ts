import { type QueryResultRow, sql } from '@vercel/postgres';
import { ChannelType, Client, type Message, Partials } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const regexCache = new Map<string, RegExp>();

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
  queryResultRows,
}: {
  message: Message;
  queryResultRows: QueryResultRow[];
}) => {
  try {
    for (const row of queryResultRows) {
      message.react(row.value);
    }
  } catch {}
};

export const handleMessageCreate =
  ({
    client,
    regexCache,
  }: {
    client: Client;
    regexCache: Map<string, RegExp>;
  }) =>
  async (message: Message) => {
    const autoReactionEmojis = await sql`
      SELECT ar.command, e.value
      FROM auto_reactions ar
      JOIN auto_reactions_emojis are ON ar.id = are."autoReactionId"
      JOIN emojis e ON e.id = are."emojiId"
      ORDER BY are.id ASC;
    `;

    for (const row of autoReactionEmojis.rows) {
      const regExp = getOrCreateRegExp(row.command, regexCache);
      if (regExp.test(message.content)) {
        messageReaction({ message, queryResultRows: [row] });
      }
    }

    if (message.reference?.messageId) {
      const reactionAgentEmojis = await sql`
        SELECT ra.command, e.value
        FROM emojis e
        JOIN reactions_agents_emojis rae ON e.id = rae."emojiId"
        JOIN reactions_agents ra ON ra.id = rae."reactionAgentId"
        ORDER BY rae.id ASC;
      `;

      for (const row of reactionAgentEmojis.rows) {
        if (row.command === message.content) {
          const repliedMessage = await message.fetchReference();
          message.delete();
          messageReaction({
            message: repliedMessage,
            queryResultRows: [row],
          });
        }
      }
    }

    const commands = await sql`
      SELECT c.command, c.response, e.value
      FROM commands c
      JOIN commands_emojis ce ON c.id = ce."commandId"
      JOIN emojis e ON e.id = ce."emojiId"
      ORDER BY ce.id ASC;
    `;

    for (const row of commands.rows) {
      if (row.command === message.content) {
        message.reply(row.response);
        messageReaction({ message, queryResultRows: [row] });
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

client.on('messageCreate', handleMessageCreate({ client, regexCache }));

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
