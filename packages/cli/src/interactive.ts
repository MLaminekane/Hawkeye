import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { Storage, type SessionRow } from '@hawkeye/core';

const VERSION = '0.1.0';

// ─── Helpers ─────────────────────────────────────────────────

function getStorage(dbPath: string): Storage | null {
  if (!existsSync(dbPath)) {
    console.log(chalk.yellow('  No database. Run init first.'));
    return null;
  }
  return new Storage(dbPath);
}

function ask(rl: ReadlineInterface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

function dur(startedAt: string, endedAt: string | null): string {
  const ms = (endedAt ? new Date(endedAt).getTime() : Date.now()) - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function badge(s: string): string {
  if (s === 'recording') return chalk.hex('#FF6B2B')('● REC');
  if (s === 'completed') return chalk.green('● END');
  return chalk.red('● ABR');
}

// ─── Display ─────────────────────────────────────────────────

function printBanner(): void {
  const o = chalk.hex('#FF6B2B');
  console.log('');
  console.log(`   ${o('██╗  ██╗')}`);
  console.log(`   ${o('██║  ██║')}`);
  console.log(`   ${o('███████║')}  ${chalk.bold.white('Hawkeye')} ${chalk.dim(`v${VERSION}`)}`);
  console.log(`   ${o('██╔══██║')}  ${chalk.dim('The flight recorder for AI agents')}`);
  console.log(`   ${o('██║  ██║')}  ${chalk.dim(process.cwd())}`);
  console.log(`   ${o('╚═╝  ╚═╝')}`);
  console.log('');
}

function printActive(dbPath: string): void {
  const storage = getStorage(dbPath);
  if (!storage) return;
  const r = storage.listSessions({ status: 'recording', limit: 1 });
  storage.close();
  if (!r.ok || r.value.length === 0) return;
  const s = r.value[0];
  const w = process.stdout.columns || 60;
  console.log(chalk.dim('━'.repeat(w)));
  console.log(
    `  ${chalk.hex('#FF6B2B')('●')} ${chalk.white(s.objective)}  ${chalk.dim(s.id.slice(0, 8))}  ${chalk.dim(dur(s.started_at, null))}  ${chalk.dim(`${s.total_actions} actions`)}`,
  );
  console.log(chalk.dim('━'.repeat(w)));
}

function printSession(i: number, s: SessionRow): void {
  console.log(
    `  ${chalk.hex('#FF6B2B').bold(`${i})`)} ${badge(s.status)}  ${chalk.dim(s.id.slice(0, 8))}  ${chalk.white(s.objective.slice(0, 35).padEnd(35))}  ${chalk.dim(dur(s.started_at, s.ended_at).padEnd(7))}  ${chalk.dim(String(s.total_actions).padStart(4))}a  ${chalk.dim(timeAgo(s.started_at))}`,
  );
}

function printCommands(): void {
  console.log('');
  const cmds: [string, string][] = [
    ['sessions', 'List & manage sessions'],
    ['active', 'Current recording'],
    ['stats', 'Session statistics'],
    ['end', 'End active sessions'],
    ['restart', 'Restart a session'],
    ['delete', 'Delete a session'],
    ['serve', 'Open dashboard :4242'],
    ['init', 'Initialize Hawkeye'],
    ['clear', 'Clear screen'],
    ['quit', 'Exit'],
  ];
  for (const [name, desc] of cmds) {
    console.log(`    ${chalk.hex('#FF6B2B')(`/${name.padEnd(12)}`)} ${chalk.dim(desc)}`);
  }
  console.log('');
}

// ─── Session detail menu ─────────────────────────────────────

async function sessionMenu(
  s: SessionRow,
  rl: ReadlineInterface,
  dbPath: string,
  cwd: string,
): Promise<void> {
  console.log('');
  console.log(`  ${badge(s.status)}  ${chalk.dim(s.id.slice(0, 8))}`);
  console.log(`  ${chalk.bold.white(s.objective)}`);
  console.log(
    `  ${chalk.dim(`${s.agent || '?'} · ${dur(s.started_at, s.ended_at)} · ${s.total_actions} actions`)}`,
  );
  console.log('');

  const opts: string[] = [];
  if (s.status === 'recording') opts.push(`${chalk.hex('#FF6B2B')('e')}nd`);
  opts.push(
    `${chalk.hex('#FF6B2B')('r')}estart`,
    `${chalk.hex('#FF6B2B')('s')}tats`,
    `${chalk.hex('#FF6B2B')('d')}elete`,
    `${chalk.hex('#FF6B2B')('b')}ack`,
  );
  console.log(`  ${opts.join('  ')}`);

  const a = (await ask(rl, `  ${chalk.hex('#FF6B2B')('›')} `)).toLowerCase();

  if ((a === 'e' || a === 'end') && s.status === 'recording') {
    const db = getStorage(dbPath);
    if (!db) return;
    db.endSession(s.id, 'completed');
    db.close();
    console.log(chalk.green(`  ✓ Ended ${s.id.slice(0, 8)}`));
  } else if (a === 'r' || a === 'restart') {
    const db = getStorage(dbPath);
    if (!db) return;
    const rec = db.listSessions({ status: 'recording' });
    for (const x of rec.ok ? rec.value : []) db.endSession(x.id, 'completed');
    const id = randomUUID();
    db.createSession({
      id,
      objective: s.objective,
      startedAt: new Date(),
      status: 'recording',
      metadata: {
        agent: s.agent || 'claude-code',
        model: s.model || 'claude-sonnet-4-6',
        workingDir: cwd,
      },
    });
    db.close();
    console.log(chalk.green(`  ✓ New session ${id.slice(0, 8)}`));
  } else if (a === 's' || a === 'stats') {
    const db = getStorage(dbPath);
    if (!db) return;
    const ev = db.getEvents(s.id);
    db.close();
    const events = ev.ok ? ev.value : [];
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    if (Object.keys(counts).length > 0) {
      console.log('');
      for (const [t, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(
          `    ${chalk.dim(t.padEnd(18))} ${chalk.hex('#FF6B2B')('█'.repeat(Math.min(c, 30)))} ${c}`,
        );
      }
    } else {
      console.log(chalk.dim('  No events.'));
    }
  } else if (a === 'd' || a === 'delete') {
    const y = await ask(rl, chalk.red(`  Delete ${s.id.slice(0, 8)}? (y/N) `));
    if (y.toLowerCase() === 'y') {
      const db = getStorage(dbPath);
      if (!db) return;
      db.deleteSession(s.id);
      db.close();
      console.log(chalk.green(`  ✓ Deleted`));
    }
  }
}

// ─── Pick session helper ─────────────────────────────────────

async function pickSession(rl: ReadlineInterface, dbPath: string): Promise<string> {
  const db = getStorage(dbPath);
  if (!db) return '';
  const r = db.listSessions({ limit: 15 });
  db.close();
  if (!r.ok || r.value.length === 0) {
    console.log(chalk.dim('  No sessions.'));
    return '';
  }
  console.log('');
  for (let i = 0; i < r.value.length; i++) printSession(i + 1, r.value[i]);
  console.log('');
  const pick = await ask(rl, chalk.dim('  # ') + chalk.hex('#FF6B2B')('› '));
  const idx = parseInt(pick, 10) - 1;
  if (idx >= 0 && idx < r.value.length) return r.value[idx].id;
  return '';
}

// ─── Main ────────────────────────────────────────────────────

export async function startInteractive(): Promise<void> {
  const cwd = process.cwd();
  const dbPath = join(cwd, '.hawkeye', 'traces.db');

  printBanner();
  printActive(dbPath);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${chalk.hex('#FF6B2B')('›')} `,
  });

  console.log('');
  console.log(chalk.dim('    / for commands'));
  console.log('');
  rl.prompt();

  rl.on('line', async (line: string) => {
    const raw = line.trim();
    if (!raw) {
      rl.prompt();
      return;
    }

    if (raw === '/' || raw === 'help' || raw === '/help') {
      printCommands();
      rl.prompt();
      return;
    }

    const input = raw.startsWith('/') ? raw.slice(1) : raw;
    const [cmd, ...rest] = input.split(' ');
    const args = rest.join(' ');
    const c = cmd.toLowerCase();

    if (c === 'sessions') {
      const db = getStorage(dbPath);
      if (db) {
        const r = db.listSessions({ limit: 15 });
        db.close();
        if (!r.ok || r.value.length === 0) {
          console.log(chalk.dim('  No sessions.'));
        } else {
          console.log('');
          for (let i = 0; i < r.value.length; i++) printSession(i + 1, r.value[i]);
          console.log('');
          const pick = await ask(rl, chalk.dim('  # ') + chalk.hex('#FF6B2B')('› '));
          const idx = parseInt(pick, 10) - 1;
          if (idx >= 0 && idx < r.value.length) {
            await sessionMenu(r.value[idx], rl, dbPath, cwd);
          }
        }
      }
    } else if (c === 'active') {
      const db = getStorage(dbPath);
      if (db) {
        const r = db.listSessions({ status: 'recording' });
        db.close();
        if (!r.ok || r.value.length === 0) {
          console.log(chalk.dim('  No active session.'));
        } else {
          for (const s of r.value) {
            console.log(
              `  ${chalk.hex('#FF6B2B')('●')} ${chalk.white(s.objective)}  ${chalk.dim(s.id.slice(0, 8))}  ${chalk.dim(dur(s.started_at, null))}  ${chalk.dim(`${s.total_actions}a`)}`,
            );
          }
        }
      }
    } else if (c === 'stats') {
      let sid = args;
      if (!sid) sid = await pickSession(rl, dbPath);
      if (sid) {
        const db = getStorage(dbPath);
        if (db) {
          const sr = db.getSession(sid);
          if (sr.ok && sr.value) {
            const ev = db.getEvents(sr.value.id);
            const events = ev.ok ? ev.value : [];
            const counts: Record<string, number> = {};
            for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
            console.log(
              `  ${badge(sr.value.status)}  ${chalk.dim(sr.value.id.slice(0, 8))}  ${chalk.white(sr.value.objective)}`,
            );
            console.log(
              `  ${chalk.dim(`${dur(sr.value.started_at, sr.value.ended_at)} · ${sr.value.total_actions} actions`)}`,
            );
            if (Object.keys(counts).length > 0) {
              console.log('');
              for (const [t, ct] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
                console.log(
                  `    ${chalk.dim(t.padEnd(18))} ${chalk.hex('#FF6B2B')('█'.repeat(Math.min(ct, 30)))} ${ct}`,
                );
              }
            }
          } else {
            console.log(chalk.red(`  Not found: ${sid}`));
          }
          db.close();
        }
      }
    } else if (c === 'end') {
      const db = getStorage(dbPath);
      if (db) {
        if (args) {
          const r = db.getSession(args);
          if (
            r.ok &&
            r.value &&
            (r.value.status === 'recording' || r.value.status === 'paused')
          ) {
            db.endSession(r.value.id, 'completed');
            console.log(chalk.green(`  ✓ Ended ${r.value.id.slice(0, 8)}`));
          } else {
            console.log(chalk.dim('  Nothing to end.'));
          }
        } else {
          const rec = db.listSessions({ status: 'recording' });
          const active = rec.ok ? rec.value : [];
          if (active.length === 0) {
            console.log(chalk.dim('  No active sessions.'));
          } else {
            for (const s of active) {
              db.endSession(s.id, 'completed');
              console.log(
                chalk.green(`  ✓ Ended ${s.id.slice(0, 8)} — ${s.objective.slice(0, 40)}`),
              );
            }
          }
        }
        db.close();
      }
    } else if (c === 'restart') {
      const db = getStorage(dbPath);
      if (db) {
        let obj = 'New Session',
          agent = 'claude-code',
          model = 'claude-sonnet-4-6';
        if (args) {
          const r = db.getSession(args);
          if (r.ok && r.value) {
            obj = r.value.objective;
            agent = r.value.agent || agent;
            model = r.value.model || model;
          }
        }
        const rec = db.listSessions({ status: 'recording' });
        const active = rec.ok ? rec.value : [];
        if (!args && active.length > 0) {
          obj = active[0].objective;
          agent = active[0].agent || agent;
          model = active[0].model || model;
        }
        for (const s of active) db.endSession(s.id, 'completed');
        const id = randomUUID();
        db.createSession({
          id,
          objective: obj,
          startedAt: new Date(),
          status: 'recording',
          metadata: { agent, model, workingDir: cwd },
        });
        db.close();
        console.log(chalk.green(`  ✓ New session ${id.slice(0, 8)}`));
        console.log(chalk.dim(`    ${obj}`));
      }
    } else if (c === 'delete') {
      let sid = args;
      if (!sid) sid = await pickSession(rl, dbPath);
      if (sid) {
        const db = getStorage(dbPath);
        if (db) {
          const r = db.getSession(sid);
          if (r.ok && r.value) {
            const y = await ask(rl, chalk.red(`  Delete ${r.value.id.slice(0, 8)}? (y/N) `));
            if (y.toLowerCase() === 'y') {
              db.deleteSession(r.value.id);
              console.log(chalk.green(`  ✓ Deleted`));
            }
          } else {
            console.log(chalk.red(`  Not found: ${sid}`));
          }
          db.close();
        }
      }
    } else if (c === 'serve') {
      console.log(chalk.dim('  Starting dashboard...'));
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [process.argv[1], 'serve'], {
        stdio: 'inherit',
        detached: true,
      });
      child.unref();
    } else if (c === 'init') {
      const { spawn } = await import('node:child_process');
      const child = spawn(process.execPath, [process.argv[1], 'init'], { stdio: 'inherit' });
      await new Promise<void>((resolve) => child.on('close', () => resolve()));
    } else if (c === 'clear') {
      console.clear();
    } else if (c === 'quit' || c === 'exit' || c === 'q') {
      console.log('');
      process.exit(0);
    } else {
      console.log(chalk.dim(`  Unknown command. Type / for help.`));
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.dim('\n  Goodbye.'));
    process.exit(0);
  });
}
