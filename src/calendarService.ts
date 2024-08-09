// Google Calendarの操作用

import { type calendar_v3, google } from 'googleapis';
import type { ScheduledEvent } from './types';

function createSchemaEvent(event: ScheduledEvent) {
  const body: calendar_v3.Schema$Event = {
    location: event.location,
    id: event.id,
    summary: event.name,
    description: event.description,
    start: {
      dateTime: event.starttime.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    end: {
      // starttimeの１時間後
      dateTime: new Date(
        event.starttime.getTime() + 60 * 60 * 1000,
      ).toISOString(),
      timeZone: 'Asia/Tokyo',
    },
  };

  if (event.recurrence) {
    body.recurrence = [event.recurrence];
  }

  return body;
}

export async function createCalEvent(
  access_token: string,
  event: ScheduledEvent,
) {
  const body: calendar_v3.Schema$Event = createSchemaEvent(event);
  const api = google.calendar({
    version: 'v3',
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
    errorRedactor: false,
  });

  try {
    await api.events.insert({
      calendarId: 'primary',
      requestBody: body,
    });
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (ex: any) {
    if (ex.status === 409) {
      // すでに存在する場合, UIから削除した場合、キャンセル扱いになる
      await api.events.update({
        calendarId: 'primary',
        eventId: event.id,
        requestBody: body,
      });
    }
  }
}

export async function updateCalEvent(
  access_token: string,
  event: ScheduledEvent,
) {
  const body: calendar_v3.Schema$Event = createSchemaEvent(event);
  const api = google.calendar({
    version: 'v3',
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
    errorRedactor: false,
  });

  await api.events.update({
    calendarId: 'primary',
    eventId: event.id,
    requestBody: body,
  });
}

export async function removeCalEvent(
  access_token: string,
  event: ScheduledEvent,
) {
  const api = google.calendar({
    version: 'v3',
    headers: {
      Authorization: `Bearer ${access_token}`,
    },
    errorRedactor: false,
  });

  try {
    await api.events.delete({
      calendarId: 'primary',
      eventId: event.id,
    });
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  } catch (ex: any) {
    if (ex.status === 410) {
      return;
    }

    throw new Error(`Failed to remove event: ${ex}`);
  }
}
