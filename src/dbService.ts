import { sql } from '@vercel/postgres';
import type { ScheduledEvent } from './types';

export type UserWithGoogleToken = {
  id: string;
  refresh_token: string;
  access_token: string;
  id_token: string;
  expires_at: number;
};

async function retrieveUsersLinkedToCalendar(): Promise<UserWithGoogleToken[]> {
  const result = await sql<UserWithGoogleToken>`
    SELECT users.id, accounts.refresh_token, accounts.access_token, accounts.id_token, accounts.expires_at FROM users
    JOIN accounts ON accounts."userId" = users.id
    WHERE users."isLinkedToCalendar" = true AND accounts.provider = 'google';
  `;
  return result.rows;
}

async function updateUserToken(user: UserWithGoogleToken) {
  await sql`
    UPDATE accounts SET 
      access_token = ${user.access_token},
      expires_at = ${user.expires_at}
    WHERE "userId" = ${user.id} AND provider = 'google';
  `;
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? '',
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  if (
    res.status !== 200 ||
    typeof json.access_token !== 'string' ||
    typeof json.expires_in !== 'number'
  ) {
    return null;
  }

  return {
    access_token: json.access_token,
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

export async function retrieveUsersAndRefresh() {
  let users = await retrieveUsersLinkedToCalendar();

  // 少なくとも60秒後に期限切れなアクセストークンを更新
  for (const user of users.filter(
    (user) => user.expires_at < Math.floor(Date.now() / 1000) + 60,
  )) {
    const json = await refreshAccessToken(user.refresh_token);
    if (!json) {
      // usersから削除
      users = users.splice(users.indexOf(user), 1);
      continue;
    }

    user.access_token = json.access_token;
    user.expires_at = json.expires_at;
    await updateUserToken(user);
  }

  return users;
}

export async function retrieveDbEvents() {
  const result = await sql`
    SELECT * FROM events;
  `;
  return result.rows as ScheduledEvent[];
}

export async function insertDbEvent(event: ScheduledEvent) {
  await sql`
    INSERT INTO events (id, name, description, starttime, endtime, creatorid, location, recurrence)
    VALUES (
      ${event.id},
      ${event.name},
      ${event.description},
      ${event.starttime.toISOString()},
      ${event.endtime?.toISOString()},
      ${event.creatorid},
      ${event.location},
      ${event.recurrence}
  );
  `;
}

export async function updateDbEvent(event: ScheduledEvent) {
  await sql`
    UPDATE events SET
      name = ${event.name},
      description = ${event.description},
      starttime = ${event.starttime.toISOString()},
      endtime = ${event.endtime?.toISOString()},
      creatorid = ${event.creatorid},
      location = ${event.location},
      recurrence = ${event.recurrence}
    WHERE id = ${event.id};
  `;
}

export async function removeDbEvent(event: ScheduledEvent) {
  await sql`
    DELETE FROM events WHERE id = ${event.id};
  `;
}
