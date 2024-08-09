import { CronJob } from 'cron';
import { type APIGuildScheduledEvent, REST, Routes } from 'discord.js';
import {
  createCalEvent,
  removeCalEvent,
  updateCalEvent,
} from './calendarService';
import {
  insertDbEvent,
  removeDbEvent,
  retrieveDbEvents,
  retrieveUsersAndRefresh,
  updateDbEvent,
} from './dbService';
import {
  getAddedEvents,
  getRemovedEvents,
  getUpdatedEvents,
} from './eventSyncUtil';
import { convertRFC5545RecurrenceRule } from './recurrenceUtil';
import type { ScheduledEventWithUrl } from './types/index';

const job = new CronJob(
  '0 * * * *', // cronTime
  async () => {
    // onTick
    console.log('Retrieving users...');
    const usersPromise = retrieveUsersAndRefresh();
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildID = process.env.GUILD_ID;
    if (!token || !guildID) {
      console.error('Missing environment variables');
      return;
    }

    const rest = new REST({ version: '10' }).setToken(token);
    console.log('Fetching new events...');
    const newEvents: ScheduledEventWithUrl[] = (
      (await rest.get(
        Routes.guildScheduledEvents(guildID),
      )) as APIGuildScheduledEvent[]
    ).map((event) => {
      return {
        id: event.id,
        name: event.name,
        description: event.description ?? null,
        starttime: new Date(event.scheduled_start_time),
        endtime: event.scheduled_end_time
          ? new Date(event.scheduled_end_time)
          : null,
        creatorid: event.creator_id ?? null,
        location: event.entity_metadata?.location ?? null,
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
        recurrence: (event as any).recurrence_rule
          ? // biome-ignore lint/suspicious/noExplicitAny: <explanation>
            convertRFC5545RecurrenceRule((event as any).recurrence_rule)
          : null,
        url: `https://discord.com/events/${guildID}/${event.id}`,
      };
    });

    console.log('Retrieving old events...');
    const oldEvents = await retrieveDbEvents();

    const remove = getRemovedEvents(oldEvents, newEvents);
    const update = getUpdatedEvents(oldEvents, newEvents);
    const add = getAddedEvents(oldEvents, newEvents);
    console.log('Remove:', remove);
    console.log('Update:', update);
    console.log('Add:', add);

    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const promises: Promise<any>[] = [];

    // 複数のコマンドを一つのsql``で実行するとエラーが発生
    //   cannot insert multiple commands into a prepared statement
    // sql``の呼び出しを分けると以下のエラーが発生
    //   LOCK TABLE can only be used in transaction blocks
    // await sql`BEGIN;`;
    // await sql`LOCK TABLE events IN EXCLUSIVE MODE;`;

    for (const user of await usersPromise) {
      for (const event of remove) {
        promises.push(removeDbEvent(event));
        promises.push(removeCalEvent(user.access_token, event));
      }

      for (const event of update) {
        promises.push(updateDbEvent(event));
      }

      for (const event of add) {
        promises.push(insertDbEvent(event));
      }

      for (const event of newEvents) {
        // すでに存在する場合、更新される
        promises.push(createCalEvent(user.access_token, event));
      }
    }

    await Promise.all(promises);
    console.log('Events updated');
  },
  null, // onComplete
  false, // start
  'UTC+9', // timeZone
  null, // context
  false, // runOnInit
);

export default job;
