import protobuf from 'protobufjs';

const LOGIN_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 30_000;
const UPDATE_TIMEOUT_MS = 30_000;
const LOGOFF_TIMEOUT_MS = 5_000;
const VERIFY_ATTEMPTS = 3;
const VERIFY_RETRY_DELAY_MS = 2_000;

const GUARD_TYPE_DEVICE_CONFIRMATION = 4;
const GUARD_TYPE_EMAIL_CONFIRMATION = 5;

export function canPollForGuardApproval(validActions) {
  return (validActions ?? []).some(
    action => action.type === GUARD_TYPE_DEVICE_CONFIRMATION || action.type === GUARD_TYPE_EMAIL_CONFIRMATION,
  );
}

async function loginWithPassword({ steamUsername, steamPassword, logger }) {
  const { LoginSession, EAuthTokenPlatformType } = await import('steam-session');
  const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
  session.loginTimeout = LOGIN_TIMEOUT_MS;

  const startResult = await session.startWithCredentials({
    accountName: steamUsername,
    password: steamPassword,
  });

  if (startResult.actionRequired) {
    if (!canPollForGuardApproval(startResult.validActions)) {
      throw new Error(
        'Steam Guard on this account needs an email or mobile authenticator code, which STEAM_PASSWORD ' +
          'cannot approve automatically. Use STEAM_REFRESH_TOKEN instead, or enable app-based confirmation.',
      );
    }
    logger.log('Approve the Steam Guard prompt on your phone to publish Workshop tags and descriptions.');
  }

  await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    session.once('authenticated', () => resolve());
    session.once('timeout', () => reject(new Error('Steam Guard approval timed out')));
    session.once('error', reject);
  }));

  return session.refreshToken;
}

export function connectWithTimeout(user, timeoutMs, trigger) {
  return new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      clearTimeout(timer);
      user.removeAllListeners('loggedOn');
      user.removeAllListeners('error');
      fn(value);
    };
    const timer = setTimeout(() => {
      user.logOff();
      settle(reject, new Error('Steam CM connection timed out'));
    }, timeoutMs);
    user.once('loggedOn', () => settle(resolve));
    user.once('error', err => settle(reject, err));
    trigger();
  });
}

async function connectToCM(refreshToken) {
  const SteamUser = (await import('steam-user')).default;
  const user = new SteamUser({ autoRelogin: false });

  await connectWithTimeout(user, CONNECT_TIMEOUT_MS, () => user.logOn({ refreshToken }));

  const died = new Promise((_resolve, reject) => {
    user.on('error', reject);
    user.on('disconnected', eresult => reject(new Error(`Steam CM session disconnected (eresult ${eresult})`)));
  });

  return { user, died };
}

/**
 * Adds `language` (17) and `update_tags` (18) to a `CPublishedFile_Update_Request` type that
 * predates them, before the first encode. A no-op once steam-user bundles a proto that has them.
 * @param {any} type
 * @returns {any}
 */
export function addLocalizedUpdateFields(type) {
  if (!type.fields.language) type.add(new protobuf.Field('language', 17, 'int32', 'optional'));
  if (!type.fields.update_tags) type.add(new protobuf.Field('update_tags', 18, 'bool', 'optional'));
  return type;
}

const UPDATE_FIELDS = ['tags', 'title', 'file_description', 'visibility', 'language', 'update_tags'];

async function sendItemUpdate(user, update) {
  const SteamUser = (await import('steam-user')).default;
  const Schema = (await import('steam-user/protobufs/generated/_load.js')).default;
  const type = addLocalizedUpdateFields(Schema.CPublishedFile_Update_Request);

  const { appid, publishedfileid } = update;
  const message = { appid, publishedfileid };
  for (const field of UPDATE_FIELDS) {
    if (update[field] !== undefined) message[field] = update[field];
  }

  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    const body = type.encode(message).finish();
    const timer = setTimeout(() => reject(new Error('PublishedFile.Update#1 timed out')), UPDATE_TIMEOUT_MS);

    user._send(
      { msg: SteamUser.EMsg.ServiceMethodCallFromClient, proto: { target_job_name: 'PublishedFile.Update#1' } },
      Buffer.from(body),
      (_body, header) => {
        clearTimeout(timer);
        const eresult = header?.proto?.eresult;
        if (eresult !== SteamUser.EResult.OK) {
          reject(new Error(`PublishedFile.Update#1 for ${publishedfileid} returned eresult ${eresult}`));
          return;
        }
        resolve();
      },
    );
  }));
}

function normalizeTags(tags) {
  return tags.map(t => (t.tag ?? t).toLowerCase()).sort();
}

function fetchPublishedDetails(user, publishedfileid, language) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PublishedFile.GetDetails#1 timed out')), UPDATE_TIMEOUT_MS);
    user._sendUnified(
      'PublishedFile.GetDetails#1',
      { publishedfileids: [publishedfileid], includetags: true, language },
      body => {
        clearTimeout(timer);
        resolve(body?.publishedfiledetails?.[0]);
      },
    );
  });
}

/**
 * Compares one `PublishedFileDetails` read against the fields that were sent for it.
 * @returns {{ matches: boolean, actual: object, mismatched: string[] }}
 */
export function compareItemDetails(details, expected) {
  const read = {
    language: details?.language ?? 0,
    title: details?.title ?? '',
    file_description: details?.file_description ?? '',
    visibility: details?.visibility ?? 0,
    tags: normalizeTags(details?.tags ?? []),
  };
  const want = { ...expected, language: expected.language ?? 0 };

  const actual = {};
  const mismatched = [];
  for (const field of ['language', 'title', 'file_description', 'visibility']) {
    if (want[field] === undefined) continue;
    actual[field] = read[field];
    if (read[field] !== want[field]) mismatched.push(field);
  }
  if (want.tags !== undefined) {
    actual.tags = read.tags;
    if (JSON.stringify(read.tags) !== JSON.stringify(normalizeTags(want.tags))) mismatched.push('tags');
  }

  return { matches: mismatched.length === 0, actual, mismatched };
}

export async function verifyPublishedItem(
  user,
  publishedfileid,
  expected,
  attempts = VERIFY_ATTEMPTS,
  delayMs = VERIFY_RETRY_DELAY_MS,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const details = await fetchPublishedDetails(user, publishedfileid, expected.language ?? 0);
    const result = compareItemDetails(details, expected);
    if (result.matches || attempt === attempts) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return compareItemDetails(undefined, expected);
}

export function logOffAndWait(user, timeoutMs = LOGOFF_TIMEOUT_MS) {
  return /** @type {Promise<void>} */ (new Promise(resolve => {
    if (!user.steamID) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    user.once('disconnected', () => { clearTimeout(timer); resolve(); });
    user.logOff();
  }));
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function summarizeFields(fields) {
  return [
    fields.language === undefined ? null : `language ${fields.language}`,
    fields.title === undefined ? null : `title "${fields.title}"`,
    fields.file_description === undefined ? null : `description ${fields.file_description.length} chars`,
    fields.visibility === undefined ? null : `visibility ${fields.visibility}`,
    fields.tags === undefined ? null : `tags [${fields.tags.join(', ')}]`,
  ].filter(Boolean).join(', ');
}

export function buildItemUpdates(mods, appId) {
  const updates = [];

  for (const mod of mods) {
    const tags = Array.isArray(mod.tags) && mod.tags.length > 0 ? mod.tags : undefined;
    const localized = Array.isArray(mod.localized) ? mod.localized : [];
    if (!tags && localized.length === 0) {
      continue;
    }

    const target = { appid: appId, publishedfileid: mod.publishedFileId };
    const sends = [];
    if (tags) {
      sends.push({ label: `${mod.name} (default)`, send: { ...target, tags } });
    }
    for (const entry of localized) {
      sends.push({
        label: `${mod.name} (${entry.code ?? entry.language})`,
        send: {
          ...target,
          ...(tags ? { tags } : {}),
          title: entry.title,
          file_description: entry.description,
          language: entry.language,
        },
      });
    }

    for (const { label, send } of sends) {
      updates.push({
        label,
        send,
        expect: mod.visibility === undefined ? send : { ...send, visibility: mod.visibility },
      });
    }
  }

  return updates;
}

export async function applyWorkshopUpdates({
  steamUsername,
  steamPassword,
  steamRefreshToken,
  appId,
  mods,
  logger,
  login = loginWithPassword,
  connect = connectToCM,
  disconnect = logOffAndWait,
  sendUpdate = sendItemUpdate,
  verify = verifyPublishedItem,
}) {
  const updates = buildItemUpdates(mods, appId);
  if (updates.length === 0) {
    return;
  }

  let user;
  let died;
  try {
    const refreshToken = steamRefreshToken || await login({ steamUsername, steamPassword, logger });
    ({ user, died } = await connect(refreshToken));
  } catch (error) {
    throw new Error(
      `Workshop update failed: ${describeError(error)} Updated: []. ` +
        `Still stale on Workshop: [${updates.map(update => update.label).join(', ')}].`,
      { cause: error },
    );
  }

  const updated = [];
  try {
    for (const update of updates) {
      await Promise.race([sendUpdate(user, update.send), died]);

      const result = await Promise.race([verify(user, update.send.publishedfileid, update.expect), died]);
      if (!result.matches) {
        throw new Error(
          `Workshop update for ${update.label} did not verify after the update. ` +
            `Mismatched [${result.mismatched.join(', ')}]: sent ${summarizeFields(update.expect)}, ` +
            `Steam now reports ${summarizeFields(result.actual)}.`,
        );
      }

      updated.push(update.label);
    }
  } catch (error) {
    const pending = updates.slice(updated.length).map(update => update.label);
    throw new Error(
      `Workshop update failed: ${describeError(error)} Updated: [${updated.join(', ')}]. ` +
        `Still stale on Workshop: [${pending.join(', ')}].`,
      { cause: error },
    );
  } finally {
    await disconnect(user);
  }
}
