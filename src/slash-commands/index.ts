import { sql } from '@vercel/postgres';
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  type ChatInputApplicationCommandData,
  type ChatInputCommandInteraction,
  type Client,
  type ModalActionRowComponentBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { messageReaction } from '..';
import emojiMap from '../emoji-map';
import type { QueryCache, SlashCommand } from '../types';

function createApplicationCommandData(command: SlashCommand) {
  return {
    name: command.command,
    description: command.response,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'action',
        description: 'Action to perform',
        choices: [
          {
            name: 'edit',
            value: 'edit',
          },
          {
            name: 'delete',
            value: 'delete',
          },
        ],
        required: false,
      },
    ],
  } as ChatInputApplicationCommandData;
}

export const updateSlashCommands = async (
  client: Client,
  queryCache: QueryCache,
) => {
  const commands = queryCache.slashCommands.map((row) =>
    createApplicationCommandData(row),
  );
  commands.push({
    name: 'update-query-cache',
    description: 'Update query cache',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  });
  commands.push({
    name: 'slash-command',
    description: 'Manage slash commands',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'create',
        description: 'Create a slash command',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'command',
            description: 'The command',
            required: true,
            minLength: 1,
            maxLength: 32,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'delete',
        description: 'Delete a slash command',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'command',
            description: 'The command',
            required: true,
            minLength: 1,
            maxLength: 32,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'edit',
        description: 'Edit a slash command',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'command',
            description: 'The command',
            required: true,
            minLength: 1,
            maxLength: 32,
          },
        ],
      },
    ],
  });

  const result = await client.application?.commands.set(
    commands,
    process.env.GUILD_ID as string,
  );

  // コマンドの削除、更新でDiscord側のIDを使うので保持しておく
  for (const [id, command] of result?.entries() ?? []) {
    if (
      command?.name === 'update-query-cache' ||
      command?.name === 'slash-command'
    ) {
      continue;
    }

    const command2 = queryCache.slashCommands.find(
      (row) => row.command === command?.name,
    );
    if (command2) {
      command2.discordId = id;
    }
  }
};

const retrieveNidKtId = async (
  discordUserId: string,
): Promise<string | undefined | null> => {
  const result = await sql`
    SELECT id FROM users
    WHERE "discordUserID" = ${discordUserId};
  `;
  return result.rows[0]?.id;
};

const createModal = ({
  title,
  customId,
  name,
  response = '',
  reaction = 'fire,thumbsup',
}: {
  title: string;
  customId: string;
  name: string;
  response?: string;
  reaction?: string;
}) => {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);

  const nameInput = new TextInputBuilder()
    .setCustomId('nameInput')
    .setLabel('このコマンドの名前')
    .setValue(name)
    .setStyle(TextInputStyle.Short);

  const responseInput = new TextInputBuilder()
    .setCustomId('responseInput')
    .setLabel('このコマンドの返答')
    .setValue(response)
    .setStyle(TextInputStyle.Paragraph);

  const reactionInput = new TextInputBuilder()
    .setCustomId('reactionInput')
    .setLabel('このコマンドへのリアクション')
    .setValue(reaction)
    .setStyle(TextInputStyle.Short);

  const firstActionRow =
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      nameInput,
    );
  const secondActionRow =
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      responseInput,
    );
  const thirdActionRow =
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      reactionInput,
    );

  modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

  return modal;
};

const showEditModal = async (
  interaction: ChatInputCommandInteraction,
  name: string,
  nidKtId: string,
) => {
  const response: string | undefined = (
    await sql`
      SELECT response FROM slash_commands
      WHERE command = ${name} AND "addedUserId" = ${nidKtId};
    `
  ).rows[0]?.response;
  const reaction = (
    await sql`
      SELECT e.name
      FROM emojis e
      JOIN slash_commands_emojis ce ON e.id = ce."emojiId"
      JOIN slash_commands c ON c.id = ce."commandId"
      WHERE c.command = ${name} AND c."addedUserId" = ${nidKtId};
    `
  ).rows
    .map((row) => row.name)
    .join(',');

  await interaction.showModal(
    createModal({
      title: 'コマンドを編集',
      customId: 'editSlashCommandModal',
      name,
      response,
      reaction,
    }),
  );
};

const handleDeleteSlashCommand = async (
  interaction: ChatInputCommandInteraction,
  queryCache: QueryCache,
  name: string,
  nidKtId: string,
) => {
  await interaction.deferReply({ ephemeral: true });
  const commandId: string | undefined = (
    await sql`
      SELECT id FROM slash_commands
      WHERE command = ${name} AND "addedUserId" = ${nidKtId};
    `
  ).rows[0]?.id;

  if (!commandId) {
    await interaction.editReply({
      content: 'コマンドが見つからなかったか、作成者があなたではありません',
    });
  } else {
    await sql`
      DELETE FROM slash_commands_emojis WHERE "commandId" = ${commandId};
    `;
    await sql`
      DELETE FROM slash_commands WHERE id = ${commandId};
    `;

    const index = queryCache.slashCommands.findIndex(
      (row) => row.command === name,
    );
    const command = queryCache.slashCommands[index];
    queryCache.slashCommands.splice(index, 1);
    await interaction.client.application?.commands.delete(
      command.discordId as string,
      process.env.GUILD_ID as string,
    );
    await interaction.editReply({
      content: 'コマンドを削除しました',
    });
  }
};

export const handleManageSlashCommands = async (
  interaction: ChatInputCommandInteraction,
  queryCache: QueryCache,
) => {
  if (interaction.commandName === 'slash-command') {
    const subcommand = interaction.options.getSubcommand();
    const nidKtId = await retrieveNidKtId(interaction.user.id);

    if (!nidKtId) {
      await interaction.reply({
        content: '[NID.kt](https://www.nidkt.org/)でサインインしてください',
        ephemeral: true,
      });
      return;
    }

    const name = interaction.options.getString('command');
    if (!name) {
      return;
    }

    if (subcommand === 'create') {
      await interaction.showModal(
        createModal({
          title: 'スラッシュコマンドを作成',
          customId: 'createSlashCommandModal',
          name,
        }),
      );
    } else if (subcommand === 'delete') {
      await handleDeleteSlashCommand(interaction, queryCache, name, nidKtId);
    } else if (subcommand === 'edit') {
      await showEditModal(interaction, name, nidKtId);
    }
  }
};

export const handleManageSlashCommandsModal = async (
  queryCache: QueryCache,
  interaction: ModalSubmitInteraction,
) => {
  if (
    interaction.customId === 'createSlashCommandModal' ||
    interaction.customId === 'editSlashCommandModal'
  ) {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.fields.getTextInputValue('nameInput');
    const response = interaction.fields.getTextInputValue('responseInput');
    const reaction = interaction.fields.getTextInputValue('reactionInput');

    const nidKtId = await retrieveNidKtId(interaction.user.id);

    if (!nidKtId) {
      await interaction.reply({
        content: '[NID.kt](https://www.nidkt.org/)でサインインしてください',
        ephemeral: true,
      });
      return;
    }

    let commandId: string | undefined;
    if (interaction.customId === 'createSlashCommandModal') {
      commandId = (
        await sql`
          INSERT INTO slash_commands (command, response, "addedUserId")
          VALUES (${name}, ${response}, ${nidKtId})
          RETURNING id;
        `
      ).rows[0]?.id;
    } else {
      commandId = (
        await sql`
          UPDATE slash_commands SET response = ${response}
          WHERE command = ${name} AND "addedUserId" = ${nidKtId}
          RETURNING id;
        `
      ).rows[0]?.id;
      if (!commandId) {
        await interaction.editReply({
          content: 'コマンドが見つからなかったか、作成者があなたではありません',
        });
        return;
      }
    }

    // missingEmojisにはModalで入力された値が入る
    const missingEmojis = [];
    // addedEmojisにはDiscord側の絵文字IDが入る
    const addedEmojis = [];
    for (const reactionName of reaction.split(',')) {
      let { emojiId, value } = (
        await sql`
          SELECT id as "emojiId", value FROM emojis
          WHERE name = ${reactionName};
        `
      ).rows[0];

      if (!emojiId) {
        value = emojiMap.fetchGuildEmojiId(reactionName, interaction);
        if (value) {
          emojiId = (
            await sql`
              INSERT INTO emojis (name, value)
              VALUES (${reactionName}, ${value})
              RETURNING id;
            `
          ).rows[0]?.id;
        }
      }
      if (!emojiId) {
        missingEmojis.push(reactionName);
        continue;
      }

      await sql`
        INSERT INTO slash_commands_emojis ("commandId", "emojiId")
        SELECT ${commandId}, ${emojiId}
        FROM (SELECT 1) AS temp_table
        WHERE NOT EXISTS (
            SELECT 1 FROM slash_commands_emojis
            WHERE "commandId" = ${commandId} AND "emojiId" = ${emojiId}
        );
      `;

      addedEmojis.push(value);
    }

    // 一旦削除してから作り直す
    const index = queryCache.slashCommands.findIndex(
      (row) => row.command === name,
    );
    if (index >= 0) {
      const command2 = queryCache.slashCommands[index];
      queryCache.slashCommands.splice(index, 1);
      await interaction.client.application?.commands.delete(
        command2.discordId as string,
        process.env.GUILD_ID as string,
      );
    }

    const command: SlashCommand = {
      command: name,
      response,
      values: addedEmojis,
    };
    const created = await interaction.client.application?.commands.create(
      createApplicationCommandData(command),
      process.env.GUILD_ID as string,
    );
    if (created) {
      command.discordId = created.id;
      queryCache.slashCommands.push(command);
    }

    if (interaction.customId === 'createSlashCommandModal') {
      await interaction.editReply({
        content: 'コマンドを作成しました',
      });
    } else {
      await interaction.editReply({
        content: 'コマンドを編集しました',
      });
    }
    if (missingEmojis.length) {
      await interaction.followUp({
        content: `次の絵文字が見つかりませんでした: ${missingEmojis.join(', ')}`,
        ephemeral: true,
      });
    }
  }
};

export const handleUpdateQueryCacheCommand = async (
  interaction: ChatInputCommandInteraction,
  queryCache: QueryCache,
  updateQueryCache: (queryCache: QueryCache) => Promise<void>,
) => {
  if (
    interaction.commandName === 'update-query-cache' &&
    interaction.channelId === process.env.UPDATE_QUERY_CACHE_CHANNEL_ID
  ) {
    await interaction.deferReply({ ephemeral: true });
    await updateQueryCache(queryCache);
    await interaction.editReply('Updated query cache');
    return true;
  }
  return false;
};

export const handleCustomSlashCommand = async (
  interaction: ChatInputCommandInteraction,
  queryCache: QueryCache,
) => {
  const command = queryCache.slashCommands.find(
    (row) => row.command === interaction.commandName,
  );
  if (command) {
    // edit | delete | undefined
    const action = interaction.options.getString('action');
    if (action) {
      const nidKtId = await retrieveNidKtId(interaction.user.id);

      if (!nidKtId) {
        await interaction.reply({
          content: '[NID.kt](https://www.nidkt.org/)でサインインしてください',
          ephemeral: true,
        });
        return;
      }

      if (action === 'edit') {
        await showEditModal(interaction, command.command, nidKtId);
      } else if (action === 'delete') {
        await handleDeleteSlashCommand(
          interaction,
          queryCache,
          command.command,
          nidKtId,
        );
      }
    } else {
      await interaction.reply(command.response);
      const message = await interaction.fetchReply();
      messageReaction({ message, reactionData: command });
    }
  }
};
