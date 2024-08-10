import type { Interaction } from 'discord.js';
import * as emojiDatasource from './data.json';

function get(name: string): string | undefined {
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const data = emojiDatasource as any;
  const key = name.charAt(0) === ':' ? name.slice(1, -1) : name;
  for (const emoji in data) {
    if (data[emoji].includes(key)) {
      return emoji;
    }
  }
  return undefined;
}

function fetchGuildEmojiId(
  name: string,
  interaction: Interaction,
): string | undefined {
  // サーバー内絵文字キャッシュからを探す
  const emoji = interaction.guild?.emojis.cache.find(
    (emoji) => emoji.name === name,
  );
  let id = emoji?.id;
  if (!id) {
    // fetchして探す
    const obj = interaction.guild?.emojis.resolve(name);
    if (obj) {
      id = obj.id;
    } else {
      // 絵文字マップから探す
      id = get(name);
    }
  }

  return id;
}

export default {
  get,
  fetchGuildEmojiId,
};
