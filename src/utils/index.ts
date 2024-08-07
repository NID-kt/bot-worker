import { type GuildEmoji, type REST, Routes } from 'discord.js';

export const toFormatEmoji =
  (rest: REST, guildId: string) => async (emoji: string) => {
    if (!/^[0-9]+$/.test(emoji)) {
      return emoji;
    }

    const response = (await rest.get(
      Routes.guildEmoji(guildId, emoji),
    )) as GuildEmoji;

    return `<${response.animated ? 'a' : ''}:${response.name}:${response.id}>`;
  };
