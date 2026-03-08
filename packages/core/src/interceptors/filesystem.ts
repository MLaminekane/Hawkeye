import { watch, type FSWatcher } from 'chokidar';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { FileEvent } from '../types.js';
import { Logger } from '../logger.js';

const logger = new Logger('interceptor:filesystem');

const DEFAULT_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.hawkeye/**',
  '**/.turbo/**',
  '**/dist/**',
  '**/*.db',
  '**/*.db-journal',
  '**/*.db-wal',
  '**/*.db-shm',
];

export type FileCallback = (event: FileEvent) => void;

export interface FilesystemInterceptor {
  start(): void;
  stop(): void;
}

function safeReadFile(filePath: string): string | undefined {
  try {
    const stat = statSync(filePath);
    if (stat.size > 1024 * 1024) return `[file too large: ${stat.size} bytes]`;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

function safeStatSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function computeHash(content: string | undefined): string | undefined {
  if (!content) return undefined;
  return createHash('sha256').update(content).digest('hex');
}

function computeLineDiff(before: string | undefined, after: string | undefined): { linesAdded: number; linesRemoved: number } {
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of afterLines) {
    if (!beforeSet.has(line)) linesAdded++;
  }
  for (const line of beforeLines) {
    if (!afterSet.has(line)) linesRemoved++;
  }
  return { linesAdded, linesRemoved };
}

export function createFilesystemInterceptor(
  watchDir: string,
  onEvent: FileCallback,
  extraIgnored: string[] = [],
): FilesystemInterceptor {
  let watcher: FSWatcher | null = null;
  const fileSnapshots = new Map<string, string | undefined>();

  function snapshotFile(filePath: string): void {
    fileSnapshots.set(filePath, safeReadFile(filePath));
  }

  return {
    start() {
      const ignored = [...DEFAULT_IGNORED, ...extraIgnored];

      const blockedSegments = [
        '.hawkeye', 'node_modules', '.git', '.turbo', 'dist',
      ];
      const blockedExtensions = ['.db', '.db-journal', '.db-wal', '.db-shm'];

      watcher = watch(watchDir, {
        ignored: (filePath: string) => {
          for (const seg of blockedSegments) {
            if (filePath.includes(`/${seg}/`) || filePath.endsWith(`/${seg}`)) return true;
          }
          for (const ext of blockedExtensions) {
            if (filePath.endsWith(ext)) return true;
          }
          return false;
        },
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });

      watcher.on('add', (filePath) => {
        logger.debug(`File created: ${filePath}`);
        const content = safeReadFile(filePath);
        const { linesAdded, linesRemoved } = computeLineDiff(undefined, content);
        onEvent({
          path: filePath,
          action: 'write',
          contentAfter: content,
          linesAdded,
          linesRemoved,
          sizeBytes: safeStatSize(filePath),
          contentHash: computeHash(content),
        });
        snapshotFile(filePath);
      });

      watcher.on('change', (filePath) => {
        logger.debug(`File modified: ${filePath}`);
        const contentBefore = fileSnapshots.get(filePath);
        const contentAfter = safeReadFile(filePath);
        const { linesAdded, linesRemoved } = computeLineDiff(contentBefore, contentAfter);

        onEvent({
          path: filePath,
          action: 'write',
          contentBefore,
          contentAfter,
          linesAdded,
          linesRemoved,
          sizeBytes: safeStatSize(filePath),
          contentHash: computeHash(contentAfter),
        });
        snapshotFile(filePath);
      });

      watcher.on('unlink', (filePath) => {
        logger.debug(`File deleted: ${filePath}`);
        const contentBefore = fileSnapshots.get(filePath);
        onEvent({
          path: filePath,
          action: 'delete',
          contentBefore,
          sizeBytes: 0,
        });
        fileSnapshots.delete(filePath);
      });

      watcher.on('ready', () => {
        logger.info(`Watching ${watchDir}`);
      });

      watcher.on('error', (err) => {
        logger.error(`Watcher error: ${String(err)}`);
      });
    },

    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
        fileSnapshots.clear();
        logger.debug('Filesystem interceptor stopped');
      }
    },
  };
}
