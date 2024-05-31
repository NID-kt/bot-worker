import { ChannelType, type Client, type Message } from 'discord.js';
import { handleMessageCreate } from '../src/index';

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

const isSetEnv = (envVar: string) => {
  return process.env[envVar] !== undefined;
};

describe('handleMessageCreate', () => {
  global.fetch = jest.fn();
  const isSetAuditLogWebHook = isSetEnv('AUDIT_LOG_WEBHOOK');
  const mockReact = jest.fn();
  const mockReply = jest.fn();
  const mockDisplayAvatarURL = jest.fn();
  const client = { user: {} } as unknown as Client;
  const handleMessageCreateCurried = handleMessageCreate(client);

  const createMockMessage = (
    content: string,
    isBot: boolean,
    channelType: ChannelType,
    mentions?: { has: () => boolean },
  ) =>
    ({
      content,
      author: { bot: isBot, displayAvatarURL: mockDisplayAvatarURL },
      channel: { type: channelType },
      react: mockReact,
      reply: mockReply,
      mentions: mentions,
    }) as unknown as Message;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not reply to messages from bots', async () => {
    const message = createMockMessage('Hello', true, ChannelType.DM);
    await handleMessageCreateCurried(message);

    if (isSetAuditLogWebHook) {
      expect(fetch).toHaveBeenCalled();
    } else {
      expect(fetch).not.toHaveBeenCalled();
    }

    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should react with specific emojis when content includes "代表"', async () => {
    const message = createMockMessage('Hello 代表', true, ChannelType.DM);
    await handleMessageCreateCurried(message);

    if (isSetAuditLogWebHook) {
      expect(fetch).toHaveBeenCalled();
    } else {
      expect(fetch).not.toHaveBeenCalled();
    }
    expectReactionsToHaveBeenCalled(mockReact);
  });

  it('replies with a specific URL and reacts when the message content is "!sasudai"', async () => {
    const message = createMockMessage('!sasudai', true, ChannelType.DM);
    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith(
      'https://x.com/STECH_FES/status/1773995315420631265',
    );

    expectReactionsToHaveBeenCalled(mockReact);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should reply to direct messages if not from a bot', async () => {
    const message = createMockMessage('Hello', false, ChannelType.DM);
    await handleMessageCreateCurried(message);

    if (isSetAuditLogWebHook) {
      expect(fetch).toHaveBeenCalled();
    } else {
      expect(fetch).not.toHaveBeenCalled();
    }
    expect(mockReply).toHaveBeenCalledWith(
      process.env.DM_MESSAGE_CONTENT ?? '',
    );
  });

  it('should not reply if the message author is a bot', async () => {
    const message = createMockMessage('', true, ChannelType.GuildText, {
      has: () => true,
    });

    await handleMessageCreateCurried(message);
    expect(mockReply).not.toHaveBeenCalled();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('should reply to mentions if not from a bot', async () => {
    const message = createMockMessage('', false, ChannelType.GuildText, {
      has: () => true,
    });

    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith(
      process.env.MENTION_MESSAGE_CONTENT ?? '',
    );

    expect(fetch).not.toHaveBeenCalled();
  });

  it('should use default empty string if DM_MESSAGE_CONTENT is not defined', async () => {
    // biome-ignore lint/performance/noDelete: Test undefined env vars to ensure the default value is used
    delete process.env.DM_MESSAGE_CONTENT;

    const message = createMockMessage('Hello', false, ChannelType.DM);
    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith('');
  });

  it('should use default empty string if MENTION_MESSAGE_CONTENT is not defined', async () => {
    // biome-ignore lint/performance/noDelete: Test undefined env vars to ensure the default value is used
    delete process.env.MENTION_MESSAGE_CONTENT;

    const message = createMockMessage('', false, ChannelType.GuildText, {
      has: () => true,
    });

    await handleMessageCreateCurried(message);

    expect(mockReply).toHaveBeenCalledWith('');
  });
});