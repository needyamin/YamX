/**
 * Scheduling and repeat keys for the coding crew.
 * Read-only roles run together. Writers run one at a time and lock the paths they name.
 */

export interface CrewTask {
  role: string;
  goal: string;
  paths?: string[];
}

export const PARALLEL_READ_TOOLS = new Set([
  'read_file',
  'read_files',
  'grep_search',
  'list_files',
  'search_files',
  'directory_tree',
  'file_info',
  'git_status',
  'git_diff',
  'git_log',
]);

export const FILE_EDIT_TOOLS = new Set([
  'write_file',
  'write_files',
  'edit_file',
  'multi_edit',
  'patch_file',
  'delete_file',
  'move_file',
]);

const WRITER_ROLES = new Set(['implementer', 'debugger']);

export function isWriterRole(role: string): boolean {
  return WRITER_ROLES.has(role);
}

export function fileEditChanged(result: string): boolean {
  const text = result.trim();
  if (!text) return false;
  if (/^error:/i.test(text)) return false;
  if (/^no changes:/i.test(text)) return false;
  if (/^dry run:/i.test(text)) return false;
  return true;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

/** Same command text is a new key after a file edit, so verify can run again. */
export function commandRepeatKey(name: string, args: unknown, editGeneration: number): string {
  const body = stableStringify(args);
  if (name === 'run_command' || name === 'run_command_background') {
    return `${name}:edit${editGeneration}:${body}`;
  }
  return `${name}:${body}`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
}

export class PathLock {
  private held = new Map<string, Promise<void>>();

  async acquire(paths: string[]): Promise<() => void> {
    const keys = (paths.length ? paths : ['*']).map(normalizePath).sort();
    for (;;) {
      const blockers = keys.map((key) => this.held.get(key)).filter((gate): gate is Promise<void> => Boolean(gate));
      if (blockers.length === 0) break;
      await Promise.race(blockers);
    }
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    for (const key of keys) this.held.set(key, gate);
    return () => {
      for (const key of keys) {
        if (this.held.get(key) === gate) this.held.delete(key);
      }
      releaseGate();
    };
  }
}

export const sharedPathLock = new PathLock();

/**
 * Explorers and reviewers in a row run together, up to maxParallel.
 * A writer waits for that batch, locks its paths, then runs alone.
 */
export async function scheduleCrewTasks<T>(
  tasks: CrewTask[],
  maxParallel: number,
  run: (task: CrewTask) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const cap = Math.max(1, Math.trunc(maxParallel) || 1);
  let batch: Array<{ task: CrewTask; index: number }> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const group = batch;
    batch = [];
    for (let offset = 0; offset < group.length; offset += cap) {
      const slice = group.slice(offset, offset + cap);
      const finished = await Promise.all(slice.map(async (item) => ({
        index: item.index,
        value: await run(item.task),
      })));
      for (const row of finished) results[row.index] = row.value;
    }
  };

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (isWriterRole(task.role)) {
      await flush();
      const release = await sharedPathLock.acquire(task.paths || []);
      try {
        results[index] = await run(task);
      } finally {
        release();
      }
    } else {
      batch.push({ task, index });
    }
  }
  await flush();
  return results;
}
