import type { ScheduledEvent } from './types';

export function getRemovedEvents(
  oldEvents: ScheduledEvent[],
  newEvents: ScheduledEvent[],
): ScheduledEvent[] {
  return oldEvents.filter(
    (oldEvent) =>
      !newEvents.some((newEvent) => newEvent.id === oldEvent.id) &&
      !(oldEvent.endtime && oldEvent.endtime.getTime() < Date.now()),
  );
}

export function getUpdatedEvents(
  oldEvents: ScheduledEvent[],
  newEvents: ScheduledEvent[],
): ScheduledEvent[] {
  return newEvents.filter((newEvent) =>
    oldEvents.some((oldEvent) => {
      if (oldEvent.id === newEvent.id) {
        if (
          oldEvent.name !== newEvent.name ||
          oldEvent.description !== newEvent.description ||
          oldEvent.creatorid !== newEvent.creatorid ||
          oldEvent.location !== newEvent.location ||
          oldEvent.recurrence !== newEvent.recurrence
        ) {
          return true;
        }

        if (
          oldEvent.starttime.toTimeString() !==
            newEvent.starttime.toTimeString() ||
          oldEvent.endtime?.toTimeString() !== newEvent.endtime?.toTimeString()
        ) {
          return true;
        }
        // 繰り返しのイベントが終了して、日付だけが変更された場合は更新しない
        if (newEvent.recurrence) {
          if (
            oldEvent.starttime.toDateString() !==
              newEvent.starttime.toDateString() ||
            oldEvent.endtime?.toDateString() !==
              newEvent.endtime?.toDateString()
          ) {
            return false;
          }
        }
      }
      return false;
    }),
  );
}

export function getAddedEvents(
  oldEvents: ScheduledEvent[],
  newEvents: ScheduledEvent[],
): ScheduledEvent[] {
  return newEvents.filter(
    (newEvent) => !oldEvents.some((oldEvent) => oldEvent.id === newEvent.id),
  );
}
