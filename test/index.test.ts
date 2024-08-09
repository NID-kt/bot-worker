import {
  type APIGuildScheduledEvent,
  ChannelType,
  type Client,
  type GuildScheduledEvent,
  GuildScheduledEventStatus,
  type Message,
} from 'discord.js';

import {
  createCalEvent,
  removeCalEvent,
  updateCalEvent,
} from '../src/calendarService';
import { retrieveUsersAndRefresh } from '../src/dbService';
import {
  handleClientReady,
  handleEventCreate,
  handleEventDelete,
  handleEventUpdate,
  handleMessageCreate,
  updateQueryCache,
} from '../src/index';
import { transformAPIGuildScheduledEventToScheduledEvent } from '../src/mapping';
import {
  type APIRecurrenceRule,
  convertRFC5545RecurrenceRule,
  getFrequencyString,
  getWeekdayString,
} from '../src/recurrenceUtil';
import type { QueryCache, ScheduledEvent } from '../src/types';

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

jest.mock('../src/dbService', () => ({
  retrieveUsersAndRefresh: jest.fn(),
}));
jest.mock('../src/calendarService', () => ({
  createCalEvent: jest.fn(),
  updateCalEvent: jest.fn(),
  removeCalEvent: jest.fn(),
}));

const expectReactionsToHaveBeenCalled = (mockReact: jest.Mock) => {
  expect(mockReact).toHaveBeenCalledWith('1223834970863177769');
  expect(mockReact).toHaveBeenCalledWith('🔥');
};

describe('handleClientReady', () => {
  it('should call updateQueryCache when invoked', async () => {
    const mockUpdateQueryCache = jest.fn();

    await handleClientReady({ updateQueryCache: mockUpdateQueryCache })();
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

describe('Event Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockEvent = ({
    guildId,
    id,
    name,
    description,
    creatorId,
    startTime,
    endTime,
    location,
    status = GuildScheduledEventStatus.Scheduled,
  }: {
    guildId: string;
    id: string;
    name: string;
    description: string;
    creatorId: string;
    startTime: string;
    endTime: string;
    location: string;
    status?: GuildScheduledEventStatus;
  }) => {
    const event = {
      guildId,
      id,
      name,
      status,
    } as GuildScheduledEvent;
    const apiObj = {
      id,
      guild_id: guildId,
      name,
      description,
      creator_id: creatorId,
      scheduled_start_time: startTime,
      scheduled_end_time: endTime,
      entity_metadata: {
        location,
      },
      status: status ?? GuildScheduledEventStatus.Scheduled,
    } as APIGuildScheduledEvent;
    const transformedObj = {
      id,
      name,
      description,
      starttime: new Date(startTime),
      endtime: new Date(endTime),
      creatorid: creatorId,
      location,
      recurrence: null,
      url: `https://discord.com/events/${guildId}/${id}`,
    };
    return { event, apiObj, transformedObj };
  };

  test('handleEventCreate should call createCalEvent for each user', async () => {
    const mockUsers = [{ access_token: 'token1' }, { access_token: 'token2' }];
    const {
      event: mockEvent,
      apiObj: mockApiObj,
      transformedObj: mockTransformedObj,
    } = createMockEvent({
      guildId: '123',
      id: '456',
      name: 'Test Event',
      description: 'Test Description',
      creatorId: '789',
      startTime: '2022-01-01T00:00:00Z',
      endTime: '2022-01-01T01:00:00Z',
      location: 'Test Location',
    });
    const mockClient = { rest: { get: jest.fn() } } as unknown as Client;

    (retrieveUsersAndRefresh as jest.Mock).mockResolvedValue(mockUsers);
    (mockClient.rest.get as jest.Mock).mockResolvedValue(mockApiObj);

    await handleEventCreate(mockClient)(mockEvent);

    expect(retrieveUsersAndRefresh).toHaveBeenCalled();
    expect(createCalEvent).toHaveBeenCalledTimes(mockUsers.length);
    for (const user of mockUsers) {
      expect(createCalEvent).toHaveBeenCalledWith(
        user.access_token,
        mockTransformedObj,
      );
    }
  });

  test('handleEventUpdate should call updateCalEvent for each user', async () => {
    const mockUsers = [{ access_token: 'token1' }, { access_token: 'token2' }];
    const {
      event: mockEvent,
      apiObj: mockApiObj,
      transformedObj: mockTransformedObj,
    } = createMockEvent({
      guildId: '123',
      id: '456',
      name: 'Test Event',
      description: 'Test Description',
      creatorId: '789',
      startTime: '2022-01-01T00:00:00Z',
      endTime: '2022-01-01T01:00:00Z',
      location: 'Test Location',
    });
    const mockClient = { rest: { get: jest.fn() } } as unknown as Client;

    (retrieveUsersAndRefresh as jest.Mock).mockResolvedValue(mockUsers);
    (mockClient.rest.get as jest.Mock).mockResolvedValue(mockApiObj);

    await handleEventUpdate(mockClient)({} as GuildScheduledEvent, mockEvent);

    expect(retrieveUsersAndRefresh).toHaveBeenCalled();
    expect(updateCalEvent).toHaveBeenCalledTimes(mockUsers.length);
    for (const user of mockUsers) {
      expect(updateCalEvent).toHaveBeenCalledWith(
        user.access_token,
        mockTransformedObj,
      );
    }
  });

  test('handleEventUpdate should call handleEventDelete if the event is completed or canceled', async () => {
    const mockUsers = [{ access_token: 'token1' }, { access_token: 'token2' }];
    const { event: mockEvent, apiObj: mockApiObj } = createMockEvent({
      guildId: '123',
      id: '456',
      name: 'Test Event',
      description: 'Test Description',
      creatorId: '789',
      startTime: '2022-01-01T00:00:00Z',
      endTime: '2022-01-01T01:00:00Z',
      location: 'Test Location',
      status: GuildScheduledEventStatus.Completed,
    });
    const mockClient = { rest: { get: jest.fn() } } as unknown as Client;

    (retrieveUsersAndRefresh as jest.Mock).mockResolvedValue(mockUsers);
    (mockClient.rest.get as jest.Mock).mockResolvedValue(mockApiObj);

    await handleEventUpdate(mockClient)({} as GuildScheduledEvent, mockEvent);

    expect(retrieveUsersAndRefresh).toHaveBeenCalled();
    expect(removeCalEvent).toHaveBeenCalledTimes(mockUsers.length);
    for (const user of mockUsers) {
      expect(removeCalEvent).toHaveBeenCalledWith(user.access_token, mockEvent);
    }
  });

  test('handleEventDelete should call removeCalEvent for each user', async () => {
    const mockEvent = {
      id: '456',
      name: 'Deleted Event',
    } as GuildScheduledEvent;
    const mockUsers = [{ access_token: 'token1' }, { access_token: 'token2' }];

    (retrieveUsersAndRefresh as jest.Mock).mockResolvedValue(mockUsers);

    await handleEventDelete()(mockEvent);

    expect(retrieveUsersAndRefresh).toHaveBeenCalled();
    expect(removeCalEvent).toHaveBeenCalledTimes(mockUsers.length);
    for (const user of mockUsers) {
      expect(removeCalEvent).toHaveBeenCalledWith(user.access_token, mockEvent);
    }
  });
});

describe('recurrenceUtil', () => {
  describe('getWeekdayString', () => {
    it('should return correct weekday string for each input', () => {
      expect(getWeekdayString(0)).toBe('MO');
      expect(getWeekdayString(1)).toBe('TU');
      expect(getWeekdayString(2)).toBe('WE');
      expect(getWeekdayString(3)).toBe('TH');
      expect(getWeekdayString(4)).toBe('FR');
      expect(getWeekdayString(5)).toBe('SA');
      expect(getWeekdayString(6)).toBe('SU');
    });
  });

  describe('getFrequencyString', () => {
    it('should return correct frequency string for each input', () => {
      expect(getFrequencyString(0)).toBe('YEARLY');
      expect(getFrequencyString(1)).toBe('MONTHLY');
      expect(getFrequencyString(2)).toBe('WEEKLY');
      expect(getFrequencyString(3)).toBe('DAILY');
    });
  });

  describe('convertRFC5545RecurrenceRule', () => {
    it('should return correct RFC5545 string for minimal valid input', () => {
      const rule: APIRecurrenceRule = {
        start: new Date(),
        frequency: 2,
        interval: 1,
      };
      expect(convertRFC5545RecurrenceRule(rule)).toBe(
        'RRULE:FREQ=WEEKLY;INTERVAL=1',
      );
    });

    it('should return correct RFC5545 string with all optional fields', () => {
      const rule: APIRecurrenceRule = {
        start: new Date(),
        frequency: 2,
        interval: 1,
        by_weekday: [0, 2],
        by_n_weekday: [{ n: 1, day: 0 }],
        by_month: [1, 3],
        by_month_day: [1, 15],
        by_year_day: [1, 100],
      };
      expect(convertRFC5545RecurrenceRule(rule)).toBe(
        'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYDAY=1MO;BYMONTH=1,3;BYMONTHDAY=1,15;BYYEARDAY=1,100',
      );
    });

    it('should return correct RFC5545 string with end date', () => {
      const rule: APIRecurrenceRule = {
        start: new Date(),
        frequency: 2,
        interval: 1,
        end: new Date('2023-12-31T23:59:59Z'),
      };
      expect(convertRFC5545RecurrenceRule(rule)).toBe(
        'RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20231231T235959Z',
      );
    });

    it('should return correct RFC5545 string with count', () => {
      const rule: APIRecurrenceRule = {
        start: new Date(),
        frequency: 2,
        interval: 1,
        count: 10,
      };
      expect(convertRFC5545RecurrenceRule(rule)).toBe(
        'RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=10',
      );
    });

    it('should return correct RFC5545 string with combinations of optional fields', () => {
      const rule: APIRecurrenceRule = {
        start: new Date(),
        frequency: 2,
        interval: 1,
        by_weekday: [0, 2],
        by_month: [1, 3],
        count: 10,
      };
      expect(convertRFC5545RecurrenceRule(rule)).toBe(
        'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYMONTH=1,3;COUNT=10',
      );
    });
  });
});

describe('transformAPIGuildScheduledEventToScheduledEvent', () => {
  it('should transform APIGuildScheduledEvent to ScheduledEvent with all fields', () => {
    const apiEvent: APIGuildScheduledEvent = {
      id: '123',
      name: 'Test Event',
      description: 'This is a test event',
      scheduled_start_time: '2023-10-01T10:00:00Z',
      scheduled_end_time: '2023-10-01T12:00:00Z',
      creator_id: '456',
      entity_metadata: { location: 'Test Location' },
      guild_id: '789',
      recurrence_rule: {
        start: new Date(),
        frequency: 3,
        interval: 1,
      } as APIRecurrenceRule,
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } as any;

    const result: ScheduledEvent =
      transformAPIGuildScheduledEventToScheduledEvent(apiEvent);

    expect(result).toEqual({
      id: '123',
      name: 'Test Event',
      description: 'This is a test event',
      starttime: new Date('2023-10-01T10:00:00Z'),
      endtime: new Date('2023-10-01T12:00:00Z'),
      creatorid: '456',
      location: 'Test Location',
      recurrence: 'RRULE:FREQ=DAILY;INTERVAL=1',
      url: 'https://discord.com/events/789/123',
    });
  });

  it('should transform APIGuildScheduledEvent to ScheduledEvent with missing optional fields', () => {
    const apiEvent: APIGuildScheduledEvent = {
      id: '123',
      name: 'Test Event',
      scheduled_start_time: '2023-10-01T10:00:00Z',
      guild_id: '789',
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } as any;

    const result: ScheduledEvent =
      transformAPIGuildScheduledEventToScheduledEvent(apiEvent);

    expect(result).toEqual({
      id: '123',
      name: 'Test Event',
      description: null,
      starttime: new Date('2023-10-01T10:00:00Z'),
      endtime: null,
      creatorid: null,
      location: null,
      recurrence: null,
      url: 'https://discord.com/events/789/123',
    });
  });

  it('should transform APIGuildScheduledEvent to ScheduledEvent with recurrence rule', () => {
    const apiEvent: APIGuildScheduledEvent = {
      id: '123',
      name: 'Test Event',
      scheduled_start_time: '2023-10-01T10:00:00Z',
      guild_id: '789',
      recurrence_rule: {
        start: new Date(),
        frequency: 2,
        interval: 1,
        by_weekday: [0],
      } as APIRecurrenceRule,
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } as any;

    const result: ScheduledEvent =
      transformAPIGuildScheduledEventToScheduledEvent(apiEvent);

    expect(result.recurrence).toBe('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO');
  });

  it('should transform APIGuildScheduledEvent to ScheduledEvent without recurrence rule', () => {
    const apiEvent: APIGuildScheduledEvent = {
      id: '123',
      name: 'Test Event',
      scheduled_start_time: '2023-10-01T10:00:00Z',
      guild_id: '789',
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    } as any;

    const result: ScheduledEvent =
      transformAPIGuildScheduledEventToScheduledEvent(apiEvent);

    expect(result.recurrence).toBe(null);
  });
});
