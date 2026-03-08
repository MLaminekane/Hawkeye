import chalk from 'chalk';

const o = chalk.hex('#FF6B2B');

export interface OverlayState {
  sessionId: string;
  objective: string;
  agent: string;
  eventCount: number;
  costUsd: number;
  driftScore: number | null;
  driftFlag: 'ok' | 'warning' | 'critical' | null;
  lastEventType: string | null;
  paused: boolean;
}

/**
 * Compact live status bar rendered to stderr during recording.
 * Uses \r carriage-return to overwrite in-place.
 * Does not interfere with child process stdout/stderr.
 */
export class RecordOverlay {
  private state: OverlayState;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastLine = '';

  constructor(init: Pick<OverlayState, 'sessionId' | 'objective' | 'agent'>) {
    this.state = {
      ...init,
      eventCount: 0,
      costUsd: 0,
      driftScore: null,
      driftFlag: null,
      lastEventType: null,
      paused: false,
    };
  }

  start(): void {
    this.render();
    this.interval = setInterval(() => this.render(), 500);
  }

  update(partial: Partial<OverlayState>): void {
    Object.assign(this.state, partial);
    this.render();
  }

  private render(): void {
    const s = this.state;
    const sid = s.sessionId.slice(0, 8);
    const status = s.paused ? chalk.yellow('⏸ Paused') : o('● REC');
    const actions = chalk.white(`${s.eventCount} actions`);
    const cost = chalk.yellow(`$${s.costUsd.toFixed(4)}`);

    let drift = chalk.dim('—');
    if (s.driftScore !== null) {
      if (s.driftFlag === 'critical') drift = chalk.red(`${s.driftScore}/100`);
      else if (s.driftFlag === 'warning') drift = chalk.yellow(`${s.driftScore}/100`);
      else drift = chalk.green(`${s.driftScore}/100`);
    }

    const last = s.lastEventType ? chalk.dim(s.lastEventType) : '';

    const line = `  ${status} ${chalk.dim(sid)} │ ${actions} │ ${cost} │ drift: ${drift} ${last}`;

    // Clear previous line and write new one
    const clearLen = this.lastLine.length + 10;
    process.stderr.write(`\r${' '.repeat(clearLen)}\r${line}`);
    this.lastLine = line;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Clear the status line
    const clearLen = this.lastLine.length + 10;
    process.stderr.write(`\r${' '.repeat(clearLen)}\r`);
  }
}
