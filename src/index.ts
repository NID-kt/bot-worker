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
}: { message: Message; queryResultRows: QueryResultRow[] }) => {
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
  }: { client: Client; regexCache: Map<string, RegExp> }) =>
  async (message: Message) => {
    for (const row of (await sql`SELECT command FROM auto_reactions`).rows) {
      const regExp = getOrCreateRegExp(row.command, regexCache);
      if (message.content.match(regExp)) {
        const emojis = await sql`
          SELECT e.value
          FROM emojis e
          JOIN auto_reactions_emojis ae ON e.id = ae."emojiId"
          WHERE ae."autoReactionId" = ${row.id}
          ORDER BY ae.id ASC
        `;

        messageReaction({ message, queryResultRows: emojis.rows });
      }
    }

    const reactionEmojis = await sql`
      SELECT ar.command, e.value
      FROM auto_reactions ar
      JOIN auto_reactions_emojis are ON ar.id = are."autoReactionId"
      JOIN emojis e ON e.id = are."emojiId"
      ORDER BY are.id ASC;
    `;

    for (const row of reactionEmojis.rows) {
      const regExp = getOrCreateRegExp(row.command, regexCache);
      if (message.content.match(regExp)) {
        messageReaction({ message, queryResultRows: [row] });
      }
    }

    if (message.reference?.messageId) {
      console.log(message.content);
      const reactionAgentEmojis = await sql`
        SELECT e.value
        FROM emojis e
        JOIN reactions_agents_emojis rae ON e.id = rae."emojiId"
        JOIN reactions_agents ra ON ra.id = rae."reactionAgentId"
        WHERE ra.command = ${message.content}
        ORDER BY rae.id ASC;
      `;
      console.log(reactionAgentEmojis);

      if (reactionAgentEmojis.rows.length !== 0) {
        const repliedMessage = await message.fetchReference();
        message.delete();
        messageReaction({
          message: repliedMessage,
          queryResultRows: reactionAgentEmojis.rows,
        });
      }
    }

    const commands = await sql`
      SELECT id, response
      FROM commands
      WHERE command = ${message.content}
    `;

    if (commands.rows.length !== 0) {
      message.reply(commands.rows[0].response);

      const emojis = await sql`
        SELECT e.value
        FROM commands_emojis ce
        JOIN emojis e ON e.id = ce."emojiId"
        WHERE ce."commandId" = ${commands.rows[0].id}
      `;

      messageReaction({ message, queryResultRows: emojis.rows });
    } else if (message.channel.type === ChannelType.DM) {
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

client.login(process.env.DISCORD_BOT_TOKEN);
