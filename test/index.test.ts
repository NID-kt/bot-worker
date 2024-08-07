import { ChannelType, type Client, type Message } from 'discord.js';

import {
  handleClientReady,
  handleMessageCreate,
  updateQueryCache,
} from '../src/index';
import type { QueryCache } from '../src/types';

jest.mock('discord.js', () => {
  const originalModule = jest.requireActual('discord.js');

  return {
    __esModule: true,
    ...originalModule,
    Client: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      login: jest.fn(),
    })),
  };
});

const expectReactionsToHaveBeenCalled = (mockReact: jest.Mock) => {
  expect(mockReact).toHaveBeenCalledWith('1223834970863177769');
  expect(mockReact).toHaveBeenCalledWith('🔥');
};

describe('handleClientReady', () => {
  it('should call updateQueryCache, updateApplicationCommands, and updateCommandToEmojiStringMap when invoked', async () => {
    const mockUpdateQueryCache = jest.fn();
    const mockUpdateApplicationCommands = jest.fn();
    const mockUpdateCommandToEmojiStringMap = jest.fn();

    await handleClientReady({
      updateQueryCache: mockUpdateQueryCache,
      updateApplicationCommands: mockUpdateApplicationCommands,
      updateCommandToEmojiStringMap: mockUpdateCommandToEmojiStringMap,
    })();

    expect(mockUpdateQueryCache).toHaveBeenCalled();
    expect(mockUpdateApplicationCommands).toHaveBeenCalled();
    expect(mockUpdateCommandToEmojiStringMap).toHaveBeenCalled();
  });
});

describe('handleMessageCreate', () => {
  const mockReact = jest.fn();
  const mockReply = jest.fn();
  const mockDisplayAvatarURL = jest.fn();
  const mockDelete = jest.fn();
  const mockUpdateQueryCache = jest.fn();
  const client = { user: {} } as unknown as Client;
  const regexCache = new Map<string, RegExp>();
  const queryCache: QueryCache = {
    autoReactionEmojis: [],
    reactionAgentEmojis: [],
    commands: [],
    contextMenuReactions: [],
  };
  const handleMessageCreateCurried = handleMessageCreate({
    client,
    regexCache,
    queryCache,
    updateQueryCache: mockUpdateQueryCache,
  });

  const createMockMessage = ({
    content,
    channelType,
    isBot = false,
    isMentionedMe = false,
    hasReference = false,
    guildId = '1223834970863177769',
    channelId = '1223834970863177769',
  }: {
    content: string;
    channelType: ChannelType;
    isBot?: boolean;
    isMentionedMe?: boolean;
    hasReference?: boolean;
    guildId?: string;
    channelId?: string;
  }) => {
    const fetchReference = hasReference
      ? jest.fn().mockResolvedValue(
          createMockMessage({
            content: '',
            channelType: ChannelType.GuildText,
          }),
        )
      : undefined;

    const reference = hasReference
      ? {
          messageId: '1223834970863177769',
          channelId: '1223834970863177769',
          guildId: '1223834970863177769',
        }
      : undefined;

    return {
      content,
      author: { bot: isBot, displayAvatarURL: mockDisplayAvatarURL },
      channel: { type: channelType },
      react: mockReact,
      reply: mockReply,
      mentions: { users: { has: () => isMentionedMe } },
      delete: mockDelete,
      fetchReference: fetchReference,
      reference: reference,
      guildId,
      channelId,
    } as unknown as Message;
  };

  beforeAll(() => {
    return updateQueryCache(queryCache);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update query cache when !updateQueryCache command is used in the correct channel and guild', async () => {
    process.env.UPDATE_QUERY_CACHE_CHANNEL_ID = '1223834970863177769';
    process.env.GUILD_ID = '1223834970863177769';

    const message = createMockMessage({
      content: '!updateQueryCache',
      channelType: ChannelType.GuildText,
      channelId: '1223834970863177769',
      guildId: '1223834970863177769',
    });

    const mockReplyMessage = {
      reply: jest.fn(),
    };
    message.reply = jest.fn().mockResolvedValue(mockReplyMessage);

    await handleMessageCreateCurried(message);

    expect(message.reply).toHaveBeenCalledWith('Updating query cache...');
    expect(mockUpdateQueryCache).toHaveBeenCalledWith(queryCache);
    expect(mockReplyMessage.reply).toHaveBeenCalledWith('Updated query cache');
  });

  it('should not update query cache when !updateQueryCache command is used in the wrong channel', async () => {
    process.env.UPDATE_QUERY_CACHE_CHANNEL_ID = '1223834970863177769';
    process.env.GUILD_ID = '1223834970863177769';

    const message = createMockMessage({
      content: '!updateQueryCache',
      channelType: ChannelType.GuildText,
      channelId: 'wrong_channel_id',
      guildId: '1223834970863177769',
    });

    await handleMessageCreateCurried(message);

    expect(message.reply).not.toHaveBeenCalled();
    expect(mockUpdateQueryCache).not.toHaveBeenCalled();
  });

  it('should not update query cache when !updateQueryCache command is used in the wrong guild', async () => {
    process.env.UPDATE_QUERY_CACHE_CHANNEL_ID = '1223834970863177769';
    process.env.GUILD_ID = '1223834970863177769';

    const message = createMockMessage({
      content: '!updateQueryCache',
      channelType: ChannelType.GuildText,
      channelId: '1223834970863177769',
      guildId: 'wrong_guild_id',
    });

    await handleMessageCreateCurried(message);

    expect(message.reply).not.toHaveBeenCalled();
    expect(mockUpdateQueryCache).not.toHaveBeenCalled();
  });

  it('should not reply to messages from bots', async () => {
    const message = createMockMessage({
      content: 'Hello',
      channelType: ChannelType.DM,
      isBot: true,
    });
    await handleMessageCreateCurried(message);

    expect(mockReply).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should react with specific emojis when content includes "代表"', async () => {
    const message = createMockMessage({
      content: 'Hello 代表',
      channelType: ChannelType.DM,
    });
    await handleMessageCreateCurried(message);

    expectReactionsToHaveBeenCalled(mockReact);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should delete the message and react to the replied message if the command is used', async () => {
    const message = createMockMessage({
      content: '!daihyo',
      channelType: ChannelType.GuildText,
      hasReference: true,
    });

    await handleMessageCreateCurried(message);

    expect(mockDelete).toHaveBeenCalled();
    expectReactionsToHaveBeenCalled(mockReact);
  });

  it('replies with a specific URL and reacts when the message content is "!sasudai"', async () => {
    const message = createMockMessage({
      content: '!sasudai',
      channelType: ChannelType.DM,
    });
    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith(
      'https://x.com/STECH_FES/status/1773995315420631265',
    );

    expectReactionsToHaveBeenCalled(mockReact);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should reply to direct messages if not from a bot', async () => {
    const message = createMockMessage({
      content: 'Hello',
      channelType: ChannelType.DM,
    });
    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith(
      process.env.DM_MESSAGE_CONTENT ?? '',
    );

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should not reply if the message author is a bot', async () => {
    const message = createMockMessage({
      content: '',
      channelType: ChannelType.GuildText,
      isBot: true,
      isMentionedMe: true,
    });

    await handleMessageCreateCurried(message);
    expect(mockReply).not.toHaveBeenCalled();

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should reply to mentions if not from a bot', async () => {
    const message = createMockMessage({
      content: '',
      channelType: ChannelType.GuildText,
      isMentionedMe: true,
    });

    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith(
      process.env.MENTION_MESSAGE_CONTENT ?? '',
    );

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should use default empty string if DM_MESSAGE_CONTENT is not defined', async () => {
    // biome-ignore lint/performance/noDelete: Test undefined env vars to ensure the default value is used
    delete process.env.DM_MESSAGE_CONTENT;

    const message = createMockMessage({
      content: 'Hello',
      channelType: ChannelType.DM,
    });
    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith('');

    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('should use default empty string if MENTION_MESSAGE_CONTENT is not defined', async () => {
    // biome-ignore lint/performance/noDelete: Test undefined env vars to ensure the default value is used
    delete process.env.MENTION_MESSAGE_CONTENT;

    const message = createMockMessage({
      content: '',
      channelType: ChannelType.GuildText,
      isMentionedMe: true,
    });

    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith('');

    expect(mockDelete).not.toHaveBeenCalled();
  });
});
