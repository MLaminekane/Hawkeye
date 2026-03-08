import { Command } from 'commander';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { Storage, type EventRow } from '@hawkeye/core';

export const replayCommand = new Command('replay')
  .description('Replay a recorded session action by action')
  .argument('<session-id>', 'Session ID (full or prefix)')
  .option('--speed <multiplier>', 'Playback speed multiplier', '1')
  .option('--no-delay', 'Show all events immediately without delay')
  .action(async (sessionId: string, options) => {
    const dbPath = join(process.cwd(), '.hawkeye', 'traces.db');

    if (!existsSync(dbPath)) {
      console.error(chalk.red('No database found. Run `hawkeye init` first.'));
      return;
    }

    const storage = new Storage(dbPath);

    // Resolve short IDs
    const resolved = resolveSessionId(storage, sessionId);
    if (!resolved) {
      console.error(chalk.red(`Session not found: ${sessionId}`));
      storage.close();
      return;
    }

    const sessionResult = storage.getSession(resolved);
    const eventsResult = storage.getEvents(resolved);
    storage.close();

    if (!sessionResult.ok || !sessionResult.value) {
      console.error(chalk.red('Failed to load session.'));
      return;
    }

    const session = sessionResult.value;
    const events = eventsResult.ok ? eventsResult.value : [];

    if (events.length === 0) {
      console.log(chalk.dim('No events to replay.'));
      return;
    }

    const speed = parseFloat(options.speed);
    const useDelay = options.delay !== false;

    console.log('');
    console.log(chalk.bold(`▶ Replaying session ${chalk.cyan(resolved.slice(0, 8))}`));
    console.log(chalk.dim(`  Objective: ${session.objective}`));
    console.log(chalk.dim(`  Events: ${events.length}`));
    console.log(chalk.dim('─'.repeat(60)));
    console.log('');

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const nextEvent = events[i + 1];

      printEvent(event, i + 1, events.length);

      // Delay between events based on original timing
      if (useDelay && nextEvent) {
        const gap = new Date(nextEvent.timestamp).getTime() - new Date(event.timestamp).getTime();
        const delay = Math.min(Math.max(gap / speed, 50), 3000); // Cap between 50ms and 3s
        await sleep(delay);
      }
    }

    console.log(chalk.dim('─'.repeat(60)));
    console.log(chalk.green('▶ Replay complete'));
    console.log('');
  });

function printEvent(event: EventRow, index: number, total: number): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const counter = chalk.dim(`[${String(index).padStart(String(total).length)}/${total}]`);
  const data = JSON.parse(event.data);

  let icon: string;
  let summary: string;

  switch (event.type) {
    case 'command':
      icon = chalk.blue('$');
      summary = `${data.command} ${(data.args || []).join(' ')}`;
      if (data.exitCode != null && data.exitCode !== 0) {
        summary += chalk.red(` (exit ${data.exitCode})`);
      }
      break;
    case 'file_write':
      icon = chalk.green('✎');
      summary = `Modified ${data.path}`;
      if (data.sizeBytes) summary += chalk.dim(` (${formatBytes(data.sizeBytes)})`);
      break;
    case 'file_delete':
      icon = chalk.red('✗');
      summary = `Deleted ${data.path}`;
      break;
    case 'file_read':
      icon = chalk.dim('◉');
      summary = `Read ${data.path}`;
      break;
    case 'llm_call':
      icon = chalk.magenta('⚡');
      summary = `${data.provider}/${data.model} (${data.totalTokens} tokens, $${data.costUsd?.toFixed(4) || '0'})`;
      break;
    case 'api_call':
      icon = chalk.cyan('→');
      summary = `${data.method} ${data.url} ${data.statusCode ? `(${data.statusCode})` : ''}`;
      break;
    case 'error':
      icon = chalk.red('!');
      summary = data.description || 'Error';
      break;
    case 'guardrail_trigger':
      icon = chalk.red('⛔');
      summary = data.description || 'Guardrail triggered';
      break;
    default:
      icon = chalk.dim('·');
      summary = event.type;
  }

  const driftStr = event.drift_score != null
    ? ` ${driftBadge(event.drift_score, event.drift_flag)}`
    : '';

  console.log(`  ${counter} ${chalk.dim(time)} ${icon} ${summary}${driftStr}`);
}

function driftBadge(score: number, flag: string | null): string {
  const text = `drift:${score.toFixed(0)}`;
  if (flag === 'critical') return chalk.red(text);
  if (flag === 'warning') return chalk.yellow(text);
  return chalk.green(text);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function resolveSessionId(storage: Storage, input: string): string | null {
  const exact = storage.getSession(input);
  if (exact.ok && exact.value) return input;

  const all = storage.listSessions();
  if (!all.ok) return null;

  const matches = all.value.filter((s) => s.id.startsWith(input));
  if (matches.length === 1) return matches[0].id;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
