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
    logger.log('Approve the Steam Guard prompt on your phone to publish Workshop tags.');
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

async function sendTagUpdate(user, { appid, publishedfileid, tags }) {
  const SteamUser = (await import('steam-user')).default;
  const Schema = (await import('steam-user/protobufs/generated/_load.js')).default;

  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    const body = Schema.CPublishedFile_Update_Request.encode({ appid, publishedfileid, tags }).finish();
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

function fetchPublishedTags(user, publishedfileid, expectedTags) {
  return new Promise((resolve, reject) => {
    user.getPublishedFileDetails([publishedfileid], (err, results) => {
      if (err) {
        reject(err);
        return;
      }
      const actual = (results[publishedfileid]?.tags ?? []).map(t => (t.tag ?? t).toLowerCase()).sort();
      const expected = expectedTags.map(t => t.toLowerCase()).sort();
      resolve({ matches: JSON.stringify(actual) === JSON.stringify(expected), actual });
    });
  });
}

export async function verifyPublishedTags(
  user,
  publishedfileid,
  expectedTags,
  attempts = VERIFY_ATTEMPTS,
  delayMs = VERIFY_RETRY_DELAY_MS,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await fetchPublishedTags(user, publishedfileid, expectedTags);
    if (result.matches || attempt === attempts) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return undefined;
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

export async function applyWorkshopTags({
  steamUsername,
  steamPassword,
  steamRefreshToken,
  appId,
  mods,
  logger,
  login = loginWithPassword,
  connect = connectToCM,
  disconnect = logOffAndWait,
  sendUpdate = sendTagUpdate,
  verify = verifyPublishedTags,
}) {
  const taggedMods = mods.filter(mod => Array.isArray(mod.tags) && mod.tags.length > 0);
  if (taggedMods.length === 0) {
    return;
  }

  const refreshToken = steamRefreshToken || await login({ steamUsername, steamPassword, logger });
  const { user, died } = await connect(refreshToken);

  const tagged = [];
  try {
    for (const mod of taggedMods) {
      await Promise.race([
        sendUpdate(user, { appid: appId, publishedfileid: mod.publishedFileId, tags: mod.tags }),
        died,
      ]);

      const result = await Promise.race([verify(user, mod.publishedFileId, mod.tags), died]);
      if (!result.matches) {
        throw new Error(
          `Workshop tags for "${mod.name}" did not verify after the update. ` +
            `Sent [${mod.tags.join(', ')}], Steam now reports [${result.actual.join(', ')}].`,
        );
      }

      tagged.push(mod.name);
    }
  } catch (error) {
    const untagged = taggedMods.slice(tagged.length).map(mod => mod.name);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Workshop tag update failed: ${message} Tagged: [${tagged.join(', ')}]. ` +
        `Still untagged on Workshop: [${untagged.join(', ')}].`,
      { cause: error },
    );
  } finally {
    await disconnect(user);
  }
}
