import { type REST, Routes } from 'discord.js';
import { toFormatEmoji } from '../../src/utils';

describe('toFormatEmoji', () => {
  const mockGet = jest.fn();
  const mockGuildId = '123456789';
  const curriedToFormatEmoji = toFormatEmoji(
    { get: mockGet } as unknown as REST,
    mockGuildId,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the original emoji if it is not a numeric string', async () => {
    const result = await curriedToFormatEmoji('😊');
    expect(result).toBe('😊');
  });

  it('formats a numeric emoji correctly for a non-animated emoji', async () => {
    mockGet.mockResolvedValue({
      animated: false,
      name: 'test_emoji',
      id: '987654321',
    });

    const result = await curriedToFormatEmoji('987654321');

    expect(result).toBe('<:test_emoji:987654321>');
    expect(mockGet).toHaveBeenCalledWith(
      Routes.guildEmoji(mockGuildId, '987654321'),
    );
  });

  it('formats a numeric emoji correctly for an animated emoji', async () => {
    mockGet.mockResolvedValue({
      animated: true,
      name: 'animated_emoji',
      id: '123456789',
    });

    const result = await curriedToFormatEmoji('123456789');

    expect(result).toBe('<a:animated_emoji:123456789>');
    expect(mockGet).toHaveBeenCalledWith(
      Routes.guildEmoji(mockGuildId, '123456789'),
    );
  });
});
