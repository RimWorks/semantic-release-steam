import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createWorkshopVdf } from './vdf.mjs';

const defaultExecFileAsync = promisify(execFile);

export const DEFAULT_UPLOAD_TIMEOUT_MS = 600_000;

function expandHomePath(path) {
  if (!path?.startsWith('~/')) {
    return path;
  }

  return join(homedir(), path.slice(2));
}

function formatSteamCmdError(error) {
  const prefix = error?.code === 'ETIMEDOUT'
    ? 'SteamCMD upload timed out'
    : 'SteamCMD upload failed';
  const stdout = error?.stdout ? `\nstdout:\n${error.stdout}` : '';
  const stderr = error?.stderr ? `\nstderr:\n${error.stderr}` : '';

  return new Error(`${prefix}: ${error.message}${stdout}${stderr}`);
}

function logSteamCmdOutput(logger, verbose, stream, text) {
  if (!logger || !text) return;
  const sink = verbose
    ? (logger.log ?? (() => {}))
    : (logger.debug ?? logger.log ?? (() => {}));
  sink.call(logger, `[steamcmd:${stream}] ${text.trimEnd()}`);
}

export async function uploadWorkshopItem({
  steamCmdPath,
  steamUsername,
  steamConfigPath,
  steamHome,
  stagePath,
  publishedFileId,
  changenote,
  description,
  appId,
  title,
  previewfile,
  visibility,
  tags,
  timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS,
  verbose = false,
  execFileAsync = defaultExecFileAsync,
  logger,
}) {
  if (!appId) {
    throw new Error('appId is required for uploadWorkshopItem');
  }

  const vdfPath = join(stagePath, 'workshop.vdf');
  await writeFile(vdfPath, createWorkshopVdf({
    appId,
    publishedFileId,
    contentFolder: stagePath,
    changenote,
    description,
    title,
    previewfile,
    visibility,
    tags,
  }));

  try {
    const result = await execFileAsync(expandHomePath(steamCmdPath), [
      '+@ShutdownOnFailedCommand', '1',
      '+@NoPromptForPassword', '1',
      '+login', steamUsername,
      '+workshop_build_item', join(stagePath, 'workshop.vdf'),
      '+quit',
    ], {
      timeout: timeoutMs,
      env: {
        ...process.env,
        STEAM_CONFIG_VDF: steamConfigPath,
        ...(steamHome ? { HOME: steamHome } : {}),
      },
    });

    logSteamCmdOutput(logger, verbose, 'stdout', result?.stdout);
    logSteamCmdOutput(logger, verbose, 'stderr', result?.stderr);
  } catch (error) {
    throw formatSteamCmdError(error);
  }

  return vdfPath;
}
