// IPC handlers for loop execution services (ContainerOrchestrator).
// Registered once during app startup via registerLoopHandlers().
// All handlers run in the main process and delegate to service instances.

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ipcMain, BrowserWindow, Notification } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { ContainerOrchestrator } from '../../services/container-orchestrator';
import type { LoopState, LoopStartOpts } from '../../shared/loop-types';
import { isLoopTerminal, LoopStatus, getLoopKey } from '../../shared/loop-types';
import type { AppSettings, ProjectConfig } from '../../shared/models';
import type { ConfigManager } from '../../services/config-manager';
import type { PreValidationStore } from '../../services/pre-validation-store';
import type { HooksStore } from '../../services/hooks-store';
import type { KiroHooksStore } from '../../services/kiro-hooks-store';
import type { ClaudeSettingsStore } from '../../services/claude-settings-store';
import type { ContainerRuntime } from '../../services/container-runtime';
import type { AuthInjector } from '../../services/auth-injector';
import type { CredentialManager } from '../../services/credential-manager';
import type { SSHKeyManager } from '../../services/ssh-key-manager';
import type { DeployKeyStore } from '../../services/deploy-key-store';
import type { FactoryTask } from '../../shared/factory-types';
import type { FactoryTaskStore } from '../../services/factory-task-store';
import type { PipelineStore } from '../../services/pipeline-store';
import { deriveTransitions } from '../../lib/pipeline/transitions';
import { getLogger } from '../../services/logging';

/**
 * Bash hook script injected into containers for factory mode loops.
 * Runs as a PostToolUse hook: when the agent writes @human_clarification.md,
 * it writes a timestamp to @human_clarification.requested so the host-side
 * file watcher can trigger an OS notification without false-positives from
 * user edits to the clarification file itself.
 */
const CLARIFICATION_HOOK_SCRIPT = `#!/bin/bash
# Description: Signal host when agent writes @human_clarification.md
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"@human_clarification.md"* ]]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > /workspace/@human_clarification.requested
fi
exit 0
`;

/**
 * Bash hook script injected into containers for factory mode loops.
 * Runs as a PostToolUse hook: when the agent writes @task-status.json,
 * it writes a timestamp to @task-status.requested so the host-side
 * file watcher can advance the kanban task state without false-positives
 * from user edits to the status file itself.
 */
const TASK_STATUS_HOOK_SCRIPT = `#!/bin/bash
# Description: Signal host when agent writes @task-status.json
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"@task-status.json"* ]]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > /workspace/@task-status.requested
fi
exit 0
`;

/**
 * Bash hook script injected into containers for factory mode loops.
 * Runs as a PostToolUse hook: when the PM agent writes @task-decomposition.json,
 * it writes a timestamp to @task-decomposition.requested so the host-side
 * file watcher can create sub-tasks atomically without false-positives from
 * unrelated writes.
 */
const TASK_DECOMPOSITION_HOOK_SCRIPT = `#!/bin/bash
# Description: Signal host when agent writes @task-decomposition.json
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"@task-decomposition.json"* ]]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > /workspace/@task-decomposition.requested
fi
exit 0
`;

/**
 * Instructions scaffolded into each factory workspace so agents know how to
 * signal task completion. Written as @TASK_STATUS_INSTRUCTIONS.md so it
 * appears alongside the other @ control files agents are already aware of.
 */
const TASK_STATUS_INSTRUCTIONS = `# Task Status Instructions

Write \`/workspace/@task-status.json\` to signal task lifecycle events. The
host detects every write via a PostToolUse hook; do not delete or rename
the file.

The \`taskId\` field is required and must match \`FactoryTask.id\` — title
matching is no longer supported (two tasks can share a title).

## Status values

### \`forward\` — your stage is complete, advance to the next stage
\`\`\`json
{
  "taskId": "<task id>",
  "status": "forward",
  "fromStage": "<your stage id>",
  "timestamp": "<ISO 8601>",
  "summary": "<Markdown summary of what you did — optional but strongly recommended>"
}
\`\`\`
The host derives the destination from the pipeline definition and clears
\`lockedBy\` for you. If \`summary\` is provided it is appended to the task's
\`notes\` array so humans can review a per-stage history of work.

### \`rejected\` — send the task back to an earlier stage
\`\`\`json
{
  "taskId": "<task id>",
  "status": "rejected",
  "fromStage": "<your stage id>",
  "toStage": "<earlier stage id>",
  "timestamp": "<ISO 8601>",
  "summary": "<Markdown summary of what you found and why you are rejecting — optional but strongly recommended>"
}
\`\`\`
\`toStage\` must be an earlier stage in the pipeline. The host increments
\`bounceCount\`; once it reaches \`bounceLimit\` the task is escalated to
Blocked instead. Always write a handover note at
\`team/handovers/<taskId>-<fromStage>-to-<toStage>.md\` before signalling
rejection so the receiving agent has context. The \`summary\` field is also
stored on the task so the full rejection rationale is visible in the UI.

### \`locked\` — claim a task before doing work
\`\`\`json
{
  "taskId": "<task id>",
  "status": "locked",
  "lockId": "<stageId>-<instanceIndex>",
  "timestamp": "<ISO 8601>"
}
\`\`\`
\`lockId\` is your container identity (e.g. \`coder-0\`, \`qa-1\`). The host
rejects the lock if another instance is already holding the task.

### \`unlocked\` — release a claimed task without status change
\`\`\`json
{
  "taskId": "<task id>",
  "status": "unlocked",
  "timestamp": "<ISO 8601>"
}
\`\`\`
Use this when you abandon a task you previously locked but did not finish
(e.g. you decided it belongs in a different stage). \`forward\` and
\`rejected\` already release the lock automatically.
`;

/**
 * Instructions scaffolded into each factory workspace so the PM agent knows
 * how to break an epic into atomic sub-tasks. Written as
 * @TASK_DECOMPOSITION_INSTRUCTIONS.md so it sits next to the other @ control
 * files. The host watcher (Phase 2.8) reads any agent write to
 * @task-decomposition.json, creates the sub-tasks atomically, and deletes the
 * source file — so PM should treat each write as a fire-and-forget request.
 */
const TASK_DECOMPOSITION_INSTRUCTIONS = `# Task Decomposition Instructions

Write \`/workspace/@task-decomposition.json\` to break a Backlog epic into
atomic sub-tasks. The host detects every write via a PostToolUse hook,
creates the sub-tasks in the first pipeline stage, marks the parent as an
epic, and deletes this file. Treat each write as fire-and-forget — once the
host processes it, the file disappears.

## Schema

\`\`\`json
{
  "action": "decompose",
  "parentTaskId": "<epic task id>",
  "tasks": [
    { "title": "Atomic step 1", "description": "Detailed description" },
    { "title": "Atomic step 2", "description": "Detailed description" }
  ]
}
\`\`\`

- \`parentTaskId\` must reference an existing FactoryTask in Backlog. The host
  flags it with \`isEpic: true\` so the kanban renders the epic progress
  tracker; the parent stays in Backlog.
- \`tasks\` must be a non-empty array. Each entry needs a non-empty title;
  description may be empty.
- The host rejects malformed payloads silently and leaves the file in place
  for the next trigger to retry — fix the payload and re-write.
`;

/**
 * Merges the clarification PostToolUse hook registration into a Claude
 * settings.json string, returning the merged JSON. Safe to call on an
 * empty string or invalid JSON (falls back to a minimal object).
 */
function mergeClarificationHook(settingsContent: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch { /* start from empty */ }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const postToolUse = ((hooks.PostToolUse as unknown[]) ?? []) as Array<Record<string, unknown>>;

  const hookCmd = 'bash ~/.claude/hooks/clarification-notify.sh';
  const alreadyPresent = postToolUse.some((entry) =>
    (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === hookCmd)
  );

  if (!alreadyPresent) {
    postToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  settings.hooks = { ...hooks, PostToolUse: postToolUse };
  return JSON.stringify(settings, null, 2);
}

/**
 * Merges the task-status PostToolUse hook registration into a Claude
 * settings.json string, returning the merged JSON. Safe to call on an
 * empty string or invalid JSON (falls back to a minimal object).
 * Idempotent — skips insertion if the hook command is already present.
 */
export function mergeTaskStatusHook(settingsContent: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch { /* start from empty */ }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const postToolUse = ((hooks.PostToolUse as unknown[]) ?? []) as Array<Record<string, unknown>>;

  const hookCmd = 'bash ~/.claude/hooks/task-status-notify.sh';
  const alreadyPresent = postToolUse.some((entry) =>
    (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === hookCmd)
  );

  if (!alreadyPresent) {
    postToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  settings.hooks = { ...hooks, PostToolUse: postToolUse };
  return JSON.stringify(settings, null, 2);
}

/**
 * Merges the task-decomposition PostToolUse hook registration into a Claude
 * settings.json string, returning the merged JSON. Safe to call on an
 * empty string or invalid JSON (falls back to a minimal object).
 * Idempotent — skips insertion if the hook command is already present.
 */
export function mergeTaskDecompositionHook(settingsContent: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch { /* start from empty */ }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const postToolUse = ((hooks.PostToolUse as unknown[]) ?? []) as Array<Record<string, unknown>>;

  const hookCmd = 'bash ~/.claude/hooks/task-decomposition-notify.sh';
  const alreadyPresent = postToolUse.some((entry) =>
    (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === hookCmd)
  );

  if (!alreadyPresent) {
    postToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  settings.hooks = { ...hooks, PostToolUse: postToolUse };
  return JSON.stringify(settings, null, 2);
}

/**
 * Bash hook script injected into containers for factory mode loops.
 * Runs as a PostToolUse hook: when any agent writes @supervisor-action.json,
 * it writes a timestamp to @supervisor-action.requested so the host-side
 * file watcher can process the action without false-positives from
 * unrelated writes.
 */
const SUPERVISOR_ACTION_HOOK_SCRIPT = `#!/bin/bash
# Description: Signal host when agent writes @supervisor-action.json
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
if [[ "$FILE_PATH" == *"@supervisor-action.json"* ]]; then
  date -u +"%Y-%m-%dT%H:%M:%SZ" > /workspace/@supervisor-action.requested
fi
exit 0
`;

/**
 * Merges the supervisor-action PostToolUse hook registration into a Claude
 * settings.json string, returning the merged JSON. Safe to call on an
 * empty string or invalid JSON (falls back to a minimal object).
 * Idempotent — skips insertion if the hook command is already present.
 */
export function mergeSupervisorActionHook(settingsContent: string): string {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch { /* start from empty */ }

  const hooks = (settings.hooks as Record<string, unknown[]> | undefined) ?? {};
  const postToolUse = ((hooks.PostToolUse as unknown[]) ?? []) as Array<Record<string, unknown>>;

  const hookCmd = 'bash ~/.claude/hooks/supervisor-action-notify.sh';
  const alreadyPresent = postToolUse.some((entry) =>
    (entry.hooks as Array<Record<string, unknown>>)?.some((h) => h.command === hookCmd)
  );

  if (!alreadyPresent) {
    postToolUse.push({
      matcher: 'Write|Edit|MultiEdit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  settings.hooks = { ...hooks, PostToolUse: postToolUse };
  return JSON.stringify(settings, null, 2);
}

/**
 * Schema for the contents of `/workspace/@task-status.json` — the file that
 * agents write to signal task lifecycle events to the host. Each write fires
 * the PostToolUse hook (which timestamps `@task-status.requested`); the host
 * watcher then reads this file and dispatches via `processTaskStatusUpdate`.
 *
 * Design note: `taskId` (not title) is the canonical lookup key. Title-based
 * lookup was the legacy path and is brittle when two tasks share a title
 * (cross-cutting risk #2 in IMPLEMENTATION_PLAN.md). The schema break is
 * intentional — agents write the new format starting in Phase 2.7.
 */
export interface TaskStatusUpdate {
  /** FactoryTask.id — required for lookup. */
  taskId: string;
  /** Lifecycle event:
   *  - 'forward'  — agent finished its stage; host advances to `forward[col]`.
   *  - 'rejected' — agent sends task back; `toStage` required (earlier stage).
   *  - 'locked'   — agent claims the task; `lockId` required.
   *  - 'unlocked' — agent releases the task without a status change.
   */
  status: 'forward' | 'rejected' | 'locked' | 'unlocked';
  /** Agent's current stage. Informational only — host derives target from
   *  task.column to avoid trusting agent-supplied origin claims. */
  fromStage?: string;
  /** Required for `rejected`. Must be an earlier stage; the actual transition
   *  validity is enforced by `FactoryTaskStore.moveTask`. */
  toStage?: string;
  /** Required for `locked`. Format: `<stageId>-<instanceIndex>` (e.g.
   *  `coder-0`). Same string the host writes into `task.lockedBy`. */
  lockId?: string;
  /** Optional human-readable reason for rejection. Stored as `lastError` on
   *  the task and appended to the task's history trail. */
  reason?: string;
  /**
   * Optional Markdown summary of the work performed during this stage.
   * Appended to `task.notes` on a `forward` or `rejected` transition so
   * humans can see a per-stage history of what each agent did.
   */
  summary?: string;
}

/**
 * Dependencies for `processTaskStatusUpdate`. Kept narrow so unit tests can
 * pass plain stubs without booting the full service graph.
 */
export interface TaskStatusUpdateDeps {
  factoryTaskStore: FactoryTaskStore;
  /** Required to resolve the project's pipeline for `forward` advances. */
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
  /** Required to resolve the pipeline definition for `forward` advances. */
  pipelineStore?: PipelineStore;
}

/**
 * Write a PM-addressed handover file when the host redirects a task to the
 * Blocked column after the pipeline bounce limit is exhausted.
 *
 * Why host-written (not agent-written): the host overrides the agent's
 * requested destination, so the agent never learns the task went to Blocked —
 * it needs an out-of-band signal. Writing to `team/handovers/<taskId>-host-to-pm.md`
 * puts the context directly in the PM's workspace so it can escalate via
 * `@human_clarification.md` without any additional IPC round-trips.
 *
 * Errors are caught and logged; a failed handover write must not prevent the
 * task move from being acknowledged (the task IS in Blocked even if the file
 * wasn't written — the move already succeeded before this is called).
 */
function writeBlockedEscalationHandover(
  projectId: string,
  task: FactoryTask,
  requestedStage: string,
  deps: TaskStatusUpdateDeps,
  logger: ReturnType<typeof getLogger>,
): void {
  if (!deps.projectStore || !deps.pipelineStore) {
    logger.warn('task-status: blocked escalation handover skipped — missing projectStore/pipelineStore', {
      projectId,
      taskId: task.id,
    });
    return;
  }

  const project = deps.projectStore.getProject(projectId);
  if (!project?.local_path) {
    logger.warn('task-status: blocked escalation handover skipped — project has no local_path', {
      projectId,
      taskId: task.id,
    });
    return;
  }

  const pipeline = project.pipelineId
    ? deps.pipelineStore.getPipeline(project.pipelineId)
    : null;
  const bounceLimit = pipeline?.bounceLimit ?? 3;
  const requestedStageName =
    pipeline?.stages.find((s) => s.id === requestedStage)?.name ?? requestedStage;

  const handoverDir = path.join(project.local_path, 'team', 'handovers');
  const handoverPath = path.join(handoverDir, `${task.id}-host-to-pm.md`);

  const content = [
    `# Blocked Escalation: ${task.title}`,
    '',
    '## Summary',
    '',
    `Task **${task.title}** has been automatically moved to the **Blocked** column`,
    `after reaching the pipeline bounce limit of **${bounceLimit}** rejection(s).`,
    '',
    '## Details',
    '',
    `- **Task ID:** ${task.id}`,
    `- **Bounce Count:** ${task.bounceCount}`,
    `- **Bounce Limit:** ${bounceLimit}`,
    `- **Last Requested Stage:** ${requestedStageName}`,
    '',
    '## Action Required',
    '',
    'As the PM, please take one of the following actions:',
    '',
    '1. **Escalate to human:** Add a clear question to `@human_clarification.md`',
    '   describing the ambiguity or conflict causing repeated rejections.',
    '',
    '2. **Revise the task:** If the task description is incomplete or contradictory,',
    '   update it and move the task back to the appropriate pipeline stage.',
    '',
    '3. **Decompose the task:** If the task is too complex, break it into smaller',
    '   sub-tasks using `@task-decomposition.json`.',
    '',
    `_Generated by the host on ${new Date().toISOString()}._`,
  ].join('\n');

  try {
    fsSync.mkdirSync(handoverDir, { recursive: true });
    fsSync.writeFileSync(handoverPath, content, { encoding: 'utf8', mode: 0o777 });
    logger.info('task-status: blocked escalation handover written', {
      projectId,
      taskId: task.id,
      path: handoverPath,
    });
  } catch (err) {
    logger.warn('task-status: failed to write blocked escalation handover', {
      projectId,
      taskId: task.id,
      err,
    });
  }
}

/**
 * Parse-and-dispatch entry point for `@task-status.json` watcher updates.
 *
 * Returns `true` when the queue was mutated, so the watcher knows to broadcast
 * `FACTORY_TASK_CHANGED`. All error paths log and return `false` rather than
 * throwing — agents may legitimately write malformed JSON, an unknown taskId,
 * or an invalid transition; none of these should crash the host or stop the
 * watcher. The next legitimate write triggers a fresh dispatch.
 */
export function processTaskStatusUpdate(
  projectId: string,
  raw: unknown,
  deps: TaskStatusUpdateDeps,
): boolean {
  const logger = getLogger('loop');

  if (!raw || typeof raw !== 'object') {
    logger.warn('task-status: payload is not an object', { projectId });
    return false;
  }
  const data = raw as Partial<TaskStatusUpdate>;

  if (!data.taskId || typeof data.taskId !== 'string') {
    logger.warn('task-status: missing or invalid taskId', { projectId });
    return false;
  }
  if (!data.status) {
    logger.warn('task-status: missing status', { projectId, taskId: data.taskId });
    return false;
  }

  const task = deps.factoryTaskStore.getTask(projectId, data.taskId);
  if (!task) {
    logger.warn('task-status: unknown taskId', { projectId, taskId: data.taskId });
    return false;
  }

  try {
    switch (data.status) {
      case 'forward': {
        if (!deps.projectStore || !deps.pipelineStore) {
          logger.warn('task-status: forward dispatch requires projectStore + pipelineStore', {
            projectId,
            taskId: task.id,
          });
          return false;
        }
        const project = deps.projectStore.getProject(projectId);
        if (!project?.pipelineId) {
          logger.warn('task-status: forward but project has no pipelineId', { projectId });
          return false;
        }
        const pipeline = deps.pipelineStore.getPipeline(project.pipelineId);
        if (!pipeline) {
          logger.warn('task-status: forward but pipeline not found', {
            projectId,
            pipelineId: project.pipelineId,
          });
          return false;
        }
        const next = deriveTransitions(pipeline).forward[task.column];
        if (!next) {
          // Already at terminal column ('done' or 'blocked'). Not an error —
          // PM may legitimately re-signal a completed task.
          return false;
        }
        deps.factoryTaskStore.moveTask(projectId, task.id, next, { note: data.summary });
        return true;
      }

      case 'rejected': {
        if (!data.toStage || typeof data.toStage !== 'string') {
          logger.warn('task-status: rejected requires toStage', {
            projectId,
            taskId: task.id,
          });
          return false;
        }
        // Spec §Rejection: "toStage can be any earlier stage ID" — agents may
        // skip intermediate stages (e.g. qa → pm) to avoid accumulating extra
        // bounces on stages that would just forward the task anyway. Pass
        // agentRejection:true to bypass the kanban adjacency constraint while
        // still enforcing bounce counting and Blocked escalation.
        const movedTask = deps.factoryTaskStore.moveTask(projectId, task.id, data.toStage, { agentRejection: true, reason: data.reason, note: data.summary });
        // Phase 2.10: when the host overrode the destination to 'blocked'
        // (bounce limit exceeded), write a PM-addressed handover. The guard
        // `data.toStage !== 'blocked'` distinguishes a host redirect (agent
        // asked for an earlier stage but was overridden) from an explicit
        // agent escalation — only the host redirect warrants the handover.
        if (movedTask?.column === 'blocked' && data.toStage !== 'blocked') {
          writeBlockedEscalationHandover(projectId, movedTask, data.toStage, deps, logger);
        }
        return true;
      }

      case 'locked': {
        if (!data.lockId || typeof data.lockId !== 'string') {
          logger.warn('task-status: locked requires lockId', {
            projectId,
            taskId: task.id,
          });
          return false;
        }
        // Allow an agent instance (e.g. "coder-0") to take over a host-level
        // stage pre-lock (e.g. "coder") without being rejected as a different owner.
        // Strip the trailing "-<index>" from the agent's lockId to get the stage name.
        if (task.lockedBy && task.lockedBy !== data.lockId) {
          const stagePrefix = data.lockId.replace(/-\d+$/, '');
          if (task.lockedBy === stagePrefix) {
            deps.factoryTaskStore.unlockTask(projectId, task.id);
          }
          // If it belongs to a genuinely different owner, lockTask below will throw.
        }
        deps.factoryTaskStore.lockTask(projectId, task.id, data.lockId);
        return true;
      }

      case 'unlocked': {
        deps.factoryTaskStore.unlockTask(projectId, task.id);
        return true;
      }

      default: {
        logger.warn('task-status: unknown status value', {
          projectId,
          taskId: task.id,
          status: (data as { status: unknown }).status,
        });
        return false;
      }
    }
  } catch (err) {
    logger.warn('task-status: store rejected update', {
      projectId,
      taskId: task.id,
      status: data.status,
      err,
    });
    return false;
  }
}

/**
 * Schema for the contents of `/workspace/@task-decomposition.json` — the file
 * the PM agent writes to break an epic into atomic sub-tasks. Each write fires
 * the PostToolUse hook (Phase 2.13) which timestamps
 * `@task-decomposition.requested`; the host watcher then reads this file,
 * dispatches via `processTaskDecomposition`, and on success deletes the file
 * (its presence on disk is the canonical "decomposition pending" signal —
 * deletion guarantees idempotency without a separate processed-id ledger).
 */
export interface TaskDecomposition {
  /** Required discriminator. Future actions may extend the schema; current
   *  dispatcher only accepts `'decompose'`. */
  action: 'decompose';
  /** FactoryTask.id of the epic being decomposed. */
  parentTaskId: string;
  /** Atomic sub-tasks. Each must have a non-empty title; description may be
   *  empty. The dispatcher rejects empty arrays — a no-op decomposition has
   *  no useful semantics and would only flag the parent as epic without
   *  giving it any children to track. */
  tasks: Array<{ title: string; description: string }>;
}

/**
 * Dependencies for `processTaskDecomposition`. The pipeline lookup is
 * required (children land in the first pipeline stage column, which is only
 * resolvable via the project's pipelineId), so unlike `TaskStatusUpdateDeps`
 * none of these are optional — passing an incomplete deps object is a
 * configuration bug, not a runtime case.
 */
export interface TaskDecompositionDeps {
  factoryTaskStore: FactoryTaskStore;
  projectStore: { getProject: (id: string) => ProjectConfig | null };
  pipelineStore: PipelineStore;
}

/**
 * Parse-and-dispatch entry point for `@task-decomposition.json` watcher
 * updates.
 *
 * Returns `true` only when the queue was mutated (sub-tasks created + parent
 * flagged as epic), so the watcher knows to delete the source file and
 * broadcast `FACTORY_TASK_CHANGED`. All error paths log and return `false`
 * rather than throwing — the PM agent may legitimately write malformed JSON,
 * an unknown parentTaskId, or a payload before the project's pipeline is
 * configured; none should crash the host or stop the watcher. Returning
 * `false` keeps the file on disk so the next legitimate trigger retries.
 *
 * Validation order is cheap-first: payload shape → pipeline resolution →
 * parent existence. The expensive parent lookup runs last so a steady stream
 * of malformed payloads doesn't thrash the task store.
 */
export function processTaskDecomposition(
  projectId: string,
  raw: unknown,
  deps: TaskDecompositionDeps,
): boolean {
  const logger = getLogger('loop');

  if (!raw || typeof raw !== 'object') {
    logger.warn('task-decomposition: payload is not an object', { projectId });
    return false;
  }
  const data = raw as Partial<TaskDecomposition>;

  if (data.action !== 'decompose') {
    logger.warn('task-decomposition: action must be "decompose"', {
      projectId,
      action: (data as { action?: unknown }).action,
    });
    return false;
  }
  if (!data.parentTaskId || typeof data.parentTaskId !== 'string') {
    logger.warn('task-decomposition: missing or invalid parentTaskId', { projectId });
    return false;
  }
  if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
    logger.warn('task-decomposition: tasks must be a non-empty array', {
      projectId,
      parentTaskId: data.parentTaskId,
    });
    return false;
  }
  for (const child of data.tasks) {
    if (
      !child ||
      typeof child !== 'object' ||
      typeof (child as { title?: unknown }).title !== 'string' ||
      !(child as { title: string }).title.trim() ||
      typeof (child as { description?: unknown }).description !== 'string'
    ) {
      logger.warn('task-decomposition: each task must have a non-empty title and string description', {
        projectId,
        parentTaskId: data.parentTaskId,
      });
      return false;
    }
  }

  const project = deps.projectStore.getProject(projectId);
  if (!project?.pipelineId) {
    logger.warn('task-decomposition: project has no pipelineId', { projectId });
    return false;
  }
  const pipeline = deps.pipelineStore.getPipeline(project.pipelineId);
  if (!pipeline) {
    logger.warn('task-decomposition: pipeline not found', {
      projectId,
      pipelineId: project.pipelineId,
    });
    return false;
  }
  if (pipeline.stages.length === 0) {
    logger.warn('task-decomposition: pipeline has no stages', {
      projectId,
      pipelineId: pipeline.id,
    });
    return false;
  }
  const firstStageColumn = pipeline.stages[0].id;

  const parent = deps.factoryTaskStore.getTask(projectId, data.parentTaskId);
  if (!parent) {
    logger.warn('task-decomposition: unknown parentTaskId', {
      projectId,
      parentTaskId: data.parentTaskId,
    });
    return false;
  }

  try {
    deps.factoryTaskStore.decomposeTask(
      projectId,
      data.parentTaskId,
      firstStageColumn,
      data.tasks,
    );
    return true;
  } catch (err) {
    logger.warn('task-decomposition: store rejected decomposition', {
      projectId,
      parentTaskId: data.parentTaskId,
      err,
    });
    return false;
  }
}

/**
 * Dependencies for `processSupervisorAction`. Kept narrow for unit testability.
 */
export interface SupervisorActionDeps {
  containerOrchestrator: ContainerOrchestrator;
  /** Map of loopKey → original LoopStartOpts, populated by startLoopCore. */
  loopOptsMap: Map<string, LoopStartOpts>;
  /**
   * Callback that stops then restarts a container with the given opts.
   * In production this is bound to startLoopCore; in tests it is a mock.
   */
  restartLoop: (opts: LoopStartOpts) => Promise<LoopState>;
}

/**
 * Parse-and-dispatch entry point for `@supervisor-action.json` watcher updates.
 *
 * Currently supports a single action — `restart` — which stops the target
 * container and restarts it with the same opts that were used to launch it.
 * Stored opts are keyed by `getLoopKey(projectId, targetRole)` and populated
 * whenever `startLoopCore` is called.
 *
 * Returns `true` when a container restart was initiated.
 */
export async function processSupervisorAction(
  projectId: string,
  data: unknown,
  deps: SupervisorActionDeps,
): Promise<boolean> {
  const logger = getLogger('loop');
  if (!data || typeof data !== 'object') {
    logger.warn('supervisor-action: payload is not an object', { projectId });
    return false;
  }

  const d = data as Record<string, unknown>;

  if (d.action !== 'restart') {
    logger.warn('supervisor-action: unsupported action', { projectId, action: d.action });
    return false;
  }

  const targetRole = d.targetRole;
  if (typeof targetRole !== 'string' || !targetRole) {
    logger.warn('supervisor-action: missing or invalid targetRole', { projectId });
    return false;
  }

  const loopKey = getLoopKey(projectId, targetRole);
  const opts = deps.loopOptsMap.get(loopKey);
  if (!opts) {
    logger.warn('supervisor-action: no stored opts for loop key, cannot restart', {
      projectId,
      targetRole,
    });
    return false;
  }

  const reason = typeof d.reason === 'string' ? d.reason : undefined;
  logger.info('supervisor-action: restarting container', { projectId, targetRole, reason });

  try {
    await deps.containerOrchestrator.stopLoop(projectId, targetRole);
  } catch {
    // Container may already be stopped or failed — proceed to restart anyway.
  }

  try {
    await deps.restartLoop(opts);
    return true;
  } catch (err) {
    logger.warn('supervisor-action: failed to restart container', { projectId, targetRole, err });
    return false;
  }
}

export interface LoopServices {
  containerOrchestrator: ContainerOrchestrator;
  cleanupManager?: { registerContainer: (id: string) => void };
  projectStore?: { getProject: (id: string) => ProjectConfig | null };
  preValidationStore?: PreValidationStore;
  hooksStore?: HooksStore;
  kiroHooksStore?: KiroHooksStore;
  claudeSettingsStore?: ClaudeSettingsStore;
  runtime?: Pick<ContainerRuntime, 'execCommand'>;
  authInjector?: AuthInjector;
  credentialManager?: CredentialManager;
  sshKeyManager?: SSHKeyManager;
  deployKeyStore?: DeployKeyStore;
  configManager?: ConfigManager;
  factoryTaskStore?: FactoryTaskStore;
  pipelineStore?: PipelineStore;
}

export interface LoopHandlerContext {
  /**
   * Restart idle container(s) for a pipeline stage so the agent picks up a
   * newly arrived task from /workspace/@task-queue.json.
   * Safe to call when containers are still running — those are left untouched
   * and will pick up the task on their next idle poll of the queue file.
   */
  dispatchFactoryStage: (projectId: string, stageId: string) => void;
  /** Stop the stuck-agent watchdog interval (call on app quit). */
  stopWatchdog: () => void;
}

export function registerLoopHandlers(services: LoopServices): LoopHandlerContext {
  const {
    containerOrchestrator,
    cleanupManager,
    projectStore,
    preValidationStore,
    hooksStore,
    kiroHooksStore,
    claudeSettingsStore,
    runtime,
    authInjector,
    credentialManager,
    sshKeyManager,
    deployKeyStore,
    configManager,
    factoryTaskStore,
    pipelineStore,
  } = services;

  const logger = getLogger('loop');

  // Shell snippet that ensures ~/.claude.json exists with minimal onboarding state.
  // Used as a preamble in SINGLE-mode container CMDs: the agent starts immediately
  // so there is no pre-exec window to create the file after the container boots.
  const ENSURE_CLAUDE_JSON = `test -f ~/.claude.json || printf '{"hasCompletedOnboarding":true}\\n' > ~/.claude.json`;

  // In-memory map tracking active deploy keys for cleanup on loop termination.
  // Maps projectId -> { keyId, repoUrl, pat, service } so we can delete keys from
  // GitHub or GitLab when the loop stops, fails, or completes.
  // Maps loopKey -> deploy key info for cleanup on loop termination.
  const activeDeployKeys = new Map<string, { keyId: number; repoUrl: string; pat: string; service: 'github' | 'gitlab' }>();

  // Maps loopKey → raw LoopStartOpts (before auth injection) so FACTORY_RESTART_CONTAINER
  // and the @supervisor-action.json watcher can restart a container with identical opts.
  const loopOptsMap = new Map<string, LoopStartOpts>();

  // ── Loop lifecycle ────────────────────────────────────────────────────────

  /**
   * Core loop start logic. Handles pre-validation scripts, auth injection,
   * hooks/prompts mounting, deploy keys, etc. Called by the FACTORY_START handler.
   */
  async function startLoopCore(rawOpts: LoopStartOpts): Promise<LoopState> {
      // Store raw opts keyed by loopKey before any mutation so restart can replay them.
      const startLoopKey = getLoopKey(rawOpts.projectId, rawOpts.role);
      loopOptsMap.set(startLoopKey, rawOpts);

      let opts = rawOpts;
      const project = projectStore?.getProject(opts.projectId) ?? null;

      // Write selected pre-validation scripts to the project's local_path root
      // so they appear at /workspace/<script> in the container via volume mount.
      if (project && project.local_path && project.pre_validation_scripts.length > 0 && preValidationStore) {
        for (const filename of project.pre_validation_scripts) {
          try {
            const content = await preValidationStore.getScript(filename);
            if (content) {
              const dest = path.join(project.local_path, filename);
              await fs.writeFile(dest, content, { mode: 0o755 });
            }
          } catch (err) {
            logger.warn(`Failed to write pre-validation script ${filename} to local_path`, { err });
          }
        }
      }


      // Inject auth credentials into container opts before starting
      let authMethod = 'unknown';
      if (authInjector) {
        try {
          const authConfig = await authInjector.getContainerAuthConfig();
          authMethod = authConfig.authMethod;
          opts = {
            ...opts,
            envVars: { ...authConfig.envVars, ...opts.envVars },
            volumeMounts: [...(authConfig.volumeMounts ?? []), ...(opts.volumeMounts ?? [])],
          };
        } catch (err) {
          logger.warn('Failed to get auth config, starting loop without auth injection', { err });
        }
      }

      // For VM loops and single-mode container loops: hook files and settings
      // cannot be injected via `docker exec` after the container starts because:
      //   - VM loops have no containerId to exec into
      //   - Single-mode container loops start the agent as their CMD, so exec
      //     injection would race against (or miss) the agent startup
      // Hooks and settings go into a temp dir mounted at /home/ralph/.claude.
      const isVm = opts.sandboxType === 'vm';
      if (isVm && project) {
        const hasHooks = project.hooks.length > 0 && !!hooksStore;
        const hasSpecFiles = Object.keys(project.spec_files ?? {}).length > 0;
        const hasClaudeSettings = !!project.claude_settings_file && !!claudeSettingsStore;
        // browser_session credentials must be pre-mounted for VM/SINGLE runs because
        // docker exec injection would race against (or miss) the agent startup.
        const hasBrowserSession = authMethod === 'browser_session';

        const hasKiroConfig = !!project.kiro_config;
        const hasKiroHooks = (project.kiro_hooks ?? []).length > 0 && !!kiroHooksStore;

        if (hasHooks || hasClaudeSettings || hasBrowserSession || !!project.local_path) {
          const claudeDir = path.join(os.tmpdir(), `zephyr-claude-${opts.projectId}${opts.role ? `-${opts.role}` : ''}`);
          try {
            await fs.mkdir(path.join(claudeDir, 'hooks'), { recursive: true });

            // Write default settings to keep the auto-updater disabled and onboarding
            // pre-completed even when this directory is bind-mounted over the image's
            // pre-baked /home/ralph/.claude. If the user has a custom settings file it
            // will overwrite this below.
            await fs.writeFile(path.join(claudeDir, 'settings.json'), '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}\n', 'utf8');

            if (hasHooks && hooksStore) {
              for (const filename of project.hooks) {
                try {
                  const content = await hooksStore.getHook(filename);
                  if (content) {
                    const safe = path.basename(filename);
                    await fs.writeFile(path.join(claudeDir, 'hooks', safe), content, { mode: 0o755 });
                  }
                } catch (err) {
                  logger.warn(`Failed to write hook ${filename} for .claude mount`, { err });
                }
              }
            }

            if (hasClaudeSettings && project.claude_settings_file && claudeSettingsStore) {
              try {
                const content = await claudeSettingsStore.getFile(project.claude_settings_file);
                if (content) {
                  await fs.writeFile(path.join(claudeDir, 'settings.json'), content, 'utf8');
                }
              } catch (err) {
                logger.warn(`Failed to write claude settings.json for .claude mount`, { err });
              }
            }

            // Inject the built-in clarification notify hook for workspace-backed loops.
            // Merges the PostToolUse registration into whatever settings.json was written
            // above (default or user's), then writes the hook script alongside it.
            if (project.local_path) {
              try {
                const existingSettings = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8').catch(() => '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}');
                await fs.writeFile(path.join(claudeDir, 'settings.json'), mergeClarificationHook(existingSettings), 'utf8');
                await fs.writeFile(path.join(claudeDir, 'hooks', 'clarification-notify.sh'), CLARIFICATION_HOOK_SCRIPT, { mode: 0o755 });
              } catch (err) {
                logger.warn('Failed to inject clarification notify hook for .claude mount', { err });
              }
            }

            // Inject the built-in task-status notify hook for factory-enabled workspace-backed loops.
            // Only factory projects need this hook — it advances kanban tasks when agents complete phases.
            if (project.local_path && project.factory_config?.enabled) {
              try {
                const existingSettings = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8').catch(() => '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}');
                await fs.writeFile(path.join(claudeDir, 'settings.json'), mergeTaskStatusHook(existingSettings), 'utf8');
                await fs.writeFile(path.join(claudeDir, 'hooks', 'task-status-notify.sh'), TASK_STATUS_HOOK_SCRIPT, { mode: 0o755 });
              } catch (err) {
                logger.warn('Failed to inject task-status notify hook for .claude mount', { err });
              }
            }

            // Inject the built-in task-decomposition notify hook for factory-enabled workspace-backed loops.
            // Only factory projects need this hook — it triggers PM epic decomposition when agents write
            // @task-decomposition.json.
            if (project.local_path && project.factory_config?.enabled) {
              try {
                const existingSettings = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8').catch(() => '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}');
                await fs.writeFile(path.join(claudeDir, 'settings.json'), mergeTaskDecompositionHook(existingSettings), 'utf8');
                await fs.writeFile(path.join(claudeDir, 'hooks', 'task-decomposition-notify.sh'), TASK_DECOMPOSITION_HOOK_SCRIPT, { mode: 0o755 });
              } catch (err) {
                logger.warn('Failed to inject task-decomposition notify hook for .claude mount', { err });
              }
            }

            // Inject the supervisor-action notify hook for factory-enabled workspace-backed loops.
            // Any container (including a future dedicated supervisor) can write @supervisor-action.json
            // to trigger host-side container restarts.
            if (project.local_path && project.factory_config?.enabled) {
              try {
                const existingSettings = await fs.readFile(path.join(claudeDir, 'settings.json'), 'utf8').catch(() => '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}');
                await fs.writeFile(path.join(claudeDir, 'settings.json'), mergeSupervisorActionHook(existingSettings), 'utf8');
                await fs.writeFile(path.join(claudeDir, 'hooks', 'supervisor-action-notify.sh'), SUPERVISOR_ACTION_HOOK_SCRIPT, { mode: 0o755 });
              } catch (err) {
                logger.warn('Failed to inject supervisor-action notify hook for .claude mount', { err });
              }
            }

            // Pre-write OAuth credentials to .credentials.json so they are available
            // before the agent CMD starts (exec injection happens too late for SINGLE/VM).
            if (hasBrowserSession && credentialManager) {
              try {
                const sessionJson = await credentialManager.getApiKey('anthropic_session');
                if (sessionJson) {
                  await fs.writeFile(path.join(claudeDir, '.credentials.json'), sessionJson, 'utf8');
                } else {
                  logger.warn('browser_session auth: no session data stored; container may lack credentials');
                }
              } catch (err) {
                logger.warn('Failed to write browser session credentials for .claude mount', { err });
              }
            }

            opts = {
              ...opts,
              // Mount at the ralph user's home .claude dir, not /root/.claude.
              // The container runs as the "ralph" user (HOME=/home/ralph), so
              // /root/.claude is inaccessible (drwx------ owned by root).
              volumeMounts: [...(opts.volumeMounts ?? []), `${claudeDir}:/home/ralph/.claude`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .claude directory for loop', { err });
          }
        }

        // Pre-mount Kiro config and hooks at /home/ralph/.kiro for VM/single-mode runs.
        if (hasKiroConfig || hasKiroHooks) {
          const kiroDir = path.join(os.tmpdir(), `zephyr-kiro-${opts.projectId}${opts.role ? `-${opts.role}` : ''}`);
          try {
            await fs.mkdir(path.join(kiroDir, 'hooks'), { recursive: true });

            if (hasKiroConfig && project.kiro_config) {
              await fs.writeFile(path.join(kiroDir, 'config.json'), project.kiro_config, 'utf8');
            }

            if (hasKiroHooks && kiroHooksStore) {
              for (const filename of project.kiro_hooks ?? []) {
                try {
                  const content = await kiroHooksStore.getHook(filename);
                  if (content) {
                    const safe = path.basename(filename);
                    await fs.writeFile(path.join(kiroDir, 'hooks', safe), content, { mode: 0o755 });
                  }
                } catch (err) {
                  logger.warn(`Failed to write kiro hook ${filename} for .kiro mount`, { err });
                }
              }
            }

            opts = {
              ...opts,
              // Same reason as the .claude mount: ralph's home is /home/ralph.
              volumeMounts: [...(opts.volumeMounts ?? []), `${kiroDir}:/home/ralph/.kiro`],
            };
          } catch (err) {
            logger.warn('Failed to prepare .kiro directory for loop', { err });
          }
        }

        // Write spec files to specs/ inside the workspace for VM runs.
        // When local_path is set it is already volume-mounted as /workspace, so writing
        // to local_path/specs/ makes them available at /workspace/specs/ in the container.
        if (hasSpecFiles) {
          const specFilesMap = project.spec_files ?? {};
          if (project.local_path) {
            const specsDir = path.join(project.local_path, 'specs');
            try {
              await fs.mkdir(specsDir, { recursive: true });
              for (const [filename, content] of Object.entries(specFilesMap)) {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(specsDir, safe), content, 'utf8');
              }
            } catch (err) {
              logger.warn('Failed to write spec files to local_path/specs for run', { err });
            }
          } else {
            // No local_path: write to a temp dir and mount it as a separate volume at /workspace/specs.
            const specsDir = path.join(os.tmpdir(), `zephyr-specs-${opts.projectId}`);
            try {
              await fs.mkdir(specsDir, { recursive: true });
              for (const [filename, content] of Object.entries(specFilesMap)) {
                const safe = path.basename(filename);
                await fs.writeFile(path.join(specsDir, safe), content, 'utf8');
              }
              opts = {
                ...opts,
                volumeMounts: [...(opts.volumeMounts ?? []), `${specsDir}:/workspace/specs`],
              };
            } catch (err) {
              logger.warn('Failed to prepare spec files directory for run', { err });
            }
          }
        }
      }

      // For VM loops: pre-validation scripts must also reach the container.
      // They are normally written to project.local_path (which is volume-mounted
      // as /workspace), but that requires local_path to be set. When it is not,
      // write them to a temp directory and mount that directory at /workspace so
      // they are still accessible to the agent at /workspace/<script>.
      if (
        opts.sandboxType === 'vm' &&
        project &&
        project.pre_validation_scripts.length > 0 &&
        preValidationStore &&
        !project.local_path
      ) {
        const pvDir = path.join(os.tmpdir(), `zephyr-pv-${opts.projectId}`);
        try {
          await fs.mkdir(pvDir, { recursive: true });
          for (const filename of project.pre_validation_scripts) {
            try {
              const content = await preValidationStore.getScript(filename);
              if (content) {
                await fs.writeFile(path.join(pvDir, path.basename(filename)), content, { mode: 0o755 });
              }
            } catch (err) {
              logger.warn(`Failed to write pre-validation script ${filename} for VM mount`, { err });
            }
          }
          opts = {
            ...opts,
            volumeMounts: [...(opts.volumeMounts ?? []), `${pvDir}:/workspace`],
            workDir: opts.workDir ?? '/workspace',
          };
        } catch (err) {
          logger.warn('Failed to prepare pre-validation scripts directory for VM loop', { err });
        }
      }

      // Stage the Kiro CLI auth database for in-container copy.
      // The working pattern (from ralph-village) is:
      //   1. Copy the host DB to a temp file (avoids VirtioFS truncation)
      //   2. Mount the copy at /tmp/kiro-data.sqlite3:ro
      //   3. After container start, exec a cp inside the container to the
      //      final writable path — SQLite needs write access for WAL/journal
      const kiroDestFile = '/home/ralph/.local/share/kiro-cli/data.sqlite3';
      let kiroStagedMount = false;
      if (opts.volumeMounts) {
        const kiroIdx = opts.volumeMounts.findIndex((m) => m.includes(kiroDestFile));
        if (kiroIdx !== -1) {
          const mount = opts.volumeMounts[kiroIdx];
          const hostPath = mount.split(':')[0];
          try {
            const tmpFile = path.join(os.tmpdir(), `zephyr-kiro-db-${opts.projectId}${opts.role ? `-${opts.role}` : ''}.sqlite3`);
            await fs.copyFile(hostPath, tmpFile);
            await fs.chmod(tmpFile, 0o644);
            const updated = [...opts.volumeMounts];
            updated[kiroIdx] = `${tmpFile}:/tmp/kiro-data.sqlite3:ro`;
            opts = { ...opts, volumeMounts: updated };
            kiroStagedMount = true;
          } catch (err) {
            logger.warn('Failed to stage Kiro DB, using direct mount', { err });
          }
        }
      }

      // Remove any stale terminal loops for this project before starting a new one.
      // This clears leftover factory role loops when switching to a non-factory run
      // (and vice versa), so the UI doesn't show ghost entries from the previous mode.
      for (const stale of containerOrchestrator.listByProject(opts.projectId)) {
        if (isLoopTerminal(stale.status)) {
          containerOrchestrator.removeLoop(stale.projectId, stale.role);
        }
      }

      const state = await containerOrchestrator.startLoop(opts);

      // Register container with cleanup manager for automatic cleanup on shutdown
      if (cleanupManager && state.containerId) {
        cleanupManager.registerContainer(state.containerId);
      }

      // Install workspace dependencies into the container so libraries are available
      // system-wide before the agent starts. Runs as root so pip can write to
      // system site-packages. Failures are non-fatal — the loop continues without them.
      if (state.containerId && runtime) {
        // Copy staged Kiro DB from /tmp mount to the writable final location.
        // SQLite requires write access for WAL/journal even on read operations.
        if (kiroStagedMount) {
          try {
            await runtime.execCommand(
              state.containerId,
              ['sh', '-c', 'mkdir -p /home/ralph/.local/share/kiro-cli && cp /tmp/kiro-data.sqlite3 /home/ralph/.local/share/kiro-cli/data.sqlite3 && chmod 644 /home/ralph/.local/share/kiro-cli/data.sqlite3'],
            );
          } catch (err) {
            logger.warn('Failed to copy Kiro DB inside container', { err });
          }
        }

        // Python: install any requirements.txt / requirements-*.txt in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', 'find /workspace -maxdepth 1 -name "requirements*.txt" | while read f; do pip3 install --break-system-packages -q -r "$f"; done'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Python workspace dependencies', { err });
        }

        // Node.js: run npm install if package.json exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/package.json ] && cd /workspace && npm install 2>&1 || true'],
            { user: 'root' },
          );
        } catch (err) {
          logger.warn('Failed to install Node.js workspace dependencies', { err });
        }

        // Rust: fetch Cargo dependencies if Cargo.toml exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/Cargo.toml ] && cd /workspace && cargo fetch 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to fetch Rust workspace dependencies', { err });
        }

        // Go: download module dependencies if go.mod exists in /workspace
        try {
          await runtime.execCommand(
            state.containerId,
            ['sh', '-c', '[ -f /workspace/go.mod ] && cd /workspace && go mod download 2>&1 || true'],
            { user: 'ralph' },
          );
        } catch (err) {
          logger.warn('Failed to download Go workspace dependencies', { err });
        }
      }

      // Ensure ~/.claude.json exists — safety net for containers running images built
      // before this file was added to generateClaudeCodeConfigBlock().
      if (state.containerId && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', ENSURE_CLAUDE_JSON,
          ]);
        } catch (err) {
          logger.warn('Failed to ensure ~/.claude.json exists in container', { err });
        }
      }

      // For browser_session auth: exec-write OAuth credentials to ~/.claude/.credentials.json
      // This is the file the Claude Code CLI reads for browser-based auth (not ~/.claude.json).
      if (authMethod === 'browser_session' && state.containerId && credentialManager && runtime) {
        try {
          const sessionJson = await credentialManager.getApiKey('anthropic_session');
          if (sessionJson) {
            const encoded = Buffer.from(sessionJson).toString('base64');
            await runtime.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude/.credentials.json`,
            ]);
            logger.info('Wrote browser session credentials to ~/.claude/.credentials.json in container');
          } else {
            logger.warn('browser_session auth mode but no session data stored; container may lack credentials');
          }
        } catch (err) {
          logger.warn('Failed to write browser session credentials to container', { err });
        }
      }

      // Configure git user identity in the container so commits have a proper author.
      if (state.containerId && runtime) {
        try {
          const gitName = project?.git_user_name?.trim() || 'Ralph';
          const gitEmail = project?.git_user_email?.trim() || 'ralph@placeholder.com';
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `git config --global user.name "${gitName}" && git config --global user.email "${gitEmail}"`,
          ]);
          logger.info('Configured git user identity in container', { gitName, gitEmail });
        } catch (err) {
          logger.warn('Failed to configure git user identity in container', { err });
        }
      }

      // Inject hook files into ~/.claude/hooks inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      if (project && project.hooks.length > 0 && state.containerId && hooksStore && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude/hooks',
          ]);

          for (const filename of project.hooks) {
            try {
              const content = await hooksStore.getHook(filename);
              if (content) {
                // Buffer.from().toString('base64') produces no newlines, safe for single-quoting
                const encoded = Buffer.from(content).toString('base64');
                const safe = path.basename(filename);
                await runtime.execCommand(state.containerId, [
                  'sh', '-c',
                  `printf '%s' '${encoded}' | base64 -d > ~/.claude/hooks/${safe} && chmod +x ~/.claude/hooks/${safe}`,
                ]);
              }
            } catch (err) {
              logger.warn(`Failed to inject hook ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.claude/hooks in container', { err });
        }
      }

      // Inject custom prompt files into ~/.claude/ inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // VM-backed loops handle this via volume mount above.
      if (project && Object.keys(project.custom_prompts).length > 0 && state.containerId && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.claude',
          ]);

          for (const [filename, content] of Object.entries(project.custom_prompts)) {
            try {
              const encoded = Buffer.from(content).toString('base64');
              const safe = path.basename(filename);
              await runtime.execCommand(state.containerId, [
                'sh', '-c',
                `printf '%s' '${encoded}' | base64 -d > ~/.claude/${safe}`,
              ]);
            } catch (err) {
              logger.warn(`Failed to inject custom prompt ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.claude in container for custom prompts', { err });
        }
      }

      // Inject spec files into /workspace/specs/ inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // VM runs handle this via volume mount above.
      if (project && Object.keys(project.spec_files ?? {}).length > 0 && state.containerId && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p /workspace/specs',
          ]);

          for (const [filename, content] of Object.entries(project.spec_files ?? {})) {
            try {
              const encoded = Buffer.from(content).toString('base64');
              const safe = path.basename(filename);
              await runtime.execCommand(state.containerId, [
                'sh', '-c',
                `printf '%s' '${encoded}' | base64 -d > /workspace/specs/${safe}`,
              ]);
            } catch (err) {
              logger.warn(`Failed to inject spec file ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create /workspace/specs in container for spec files', { err });
        }
      }

      // Inject claude settings.json into ~/.claude/settings.json inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for VM runs: those already have the file pre-mounted as a volume (handled above).
      if (project && project.claude_settings_file && state.containerId && claudeSettingsStore && runtime) {
        try {
          const content = await claudeSettingsStore.getFile(project.claude_settings_file);
          if (content) {
            const encoded = Buffer.from(content).toString('base64');
            await runtime.execCommand(state.containerId, [
              'sh', '-c',
              `mkdir -p ~/.claude && printf '%s' '${encoded}' | base64 -d > ~/.claude/settings.json`,
            ]);
          }
        } catch (err) {
          logger.warn('Failed to inject claude settings.json into container', { err });
        }
      }

      // Inject built-in clarification notify hook for workspace-backed loops.
      // Must run AFTER the user's settings.json injection above so the merge sees the
      // final user settings rather than the image default.
      if (project?.local_path && state.containerId && runtime) {
        try {
          await runtime.execCommand(state.containerId, ['sh', '-c', 'mkdir -p ~/.claude/hooks']);
          const hookEncoded = Buffer.from(CLARIFICATION_HOOK_SCRIPT).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${hookEncoded}' | base64 -d > ~/.claude/hooks/clarification-notify.sh && chmod +x ~/.claude/hooks/clarification-notify.sh`,
          ]);
          // Load user settings (if any) so we merge rather than clobber them.
          const baseSettings = project.claude_settings_file && claudeSettingsStore
            ? (await claudeSettingsStore.getFile(project.claude_settings_file) ?? '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}')
            : '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}';
          const settingsEncoded = Buffer.from(mergeClarificationHook(baseSettings)).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${settingsEncoded}' | base64 -d > ~/.claude/settings.json`,
          ]);
        } catch (err) {
          logger.warn('Failed to inject clarification notify hook into container', { err });
        }
      }

      // Inject built-in task-status, task-decomposition, and supervisor-action notify hooks
      // for factory-enabled workspace-backed loops. Re-derives baseSettings and
      // applies all hooks so none overwrite each other (all merges are idempotent).
      if (project?.local_path && project.factory_config?.enabled && state.containerId && runtime) {
        try {
          const taskHookEncoded = Buffer.from(TASK_STATUS_HOOK_SCRIPT).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${taskHookEncoded}' | base64 -d > ~/.claude/hooks/task-status-notify.sh && chmod +x ~/.claude/hooks/task-status-notify.sh`,
          ]);
          const decompHookEncoded = Buffer.from(TASK_DECOMPOSITION_HOOK_SCRIPT).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${decompHookEncoded}' | base64 -d > ~/.claude/hooks/task-decomposition-notify.sh && chmod +x ~/.claude/hooks/task-decomposition-notify.sh`,
          ]);
          const supervisorHookEncoded = Buffer.from(SUPERVISOR_ACTION_HOOK_SCRIPT).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${supervisorHookEncoded}' | base64 -d > ~/.claude/hooks/supervisor-action-notify.sh && chmod +x ~/.claude/hooks/supervisor-action-notify.sh`,
          ]);
          // Merge all four hooks into settings so none overwrites the others.
          const baseSettings = project.claude_settings_file && claudeSettingsStore
            ? (await claudeSettingsStore.getFile(project.claude_settings_file) ?? '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}')
            : '{"autoUpdaterStatus":"disabled","hasCompletedOnboarding":true}';
          const settingsEncoded = Buffer.from(mergeSupervisorActionHook(mergeTaskDecompositionHook(mergeTaskStatusHook(mergeClarificationHook(baseSettings))))).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `printf '%s' '${settingsEncoded}' | base64 -d > ~/.claude/settings.json`,
          ]);
        } catch (err) {
          logger.warn('Failed to inject task-status/task-decomposition/supervisor-action notify hooks into container', { err });
        }
      }

      // Inject Kiro config into ~/.kiro/config.json inside the container.
      // Uses base64 to safely transfer the JSON content via docker exec.
      // Skipped for VM runs: those already have the file pre-mounted.
      if (project && project.kiro_config && state.containerId && runtime) {
        try {
          const encoded = Buffer.from(project.kiro_config).toString('base64');
          await runtime.execCommand(state.containerId, [
            'sh', '-c',
            `mkdir -p ~/.kiro && printf '%s' '${encoded}' | base64 -d > ~/.kiro/config.json`,
          ]);
        } catch (err) {
          logger.warn('Failed to inject kiro config.json into container', { err });
        }
      }

      // Inject Kiro hook files into ~/.kiro/hooks inside the container.
      // Uses base64 to safely transfer file contents via docker exec.
      // Skipped for VM runs: those already have hooks pre-mounted.
      if (project && (project.kiro_hooks ?? []).length > 0 && state.containerId && kiroHooksStore && runtime) {
        try {
          await runtime.execCommand(state.containerId, [
            'sh', '-c', 'mkdir -p ~/.kiro/hooks',
          ]);

          for (const filename of project.kiro_hooks ?? []) {
            try {
              const content = await kiroHooksStore.getHook(filename);
              if (content) {
                const encoded = Buffer.from(content).toString('base64');
                const safe = path.basename(filename);
                await runtime.execCommand(state.containerId, [
                  'sh', '-c',
                  `printf '%s' '${encoded}' | base64 -d > ~/.kiro/hooks/${safe} && chmod +x ~/.kiro/hooks/${safe}`,
                ]);
              }
            } catch (err) {
              logger.warn(`Failed to inject kiro hook ${filename} into container`, { err });
            }
          }
        } catch (err) {
          logger.warn('Failed to create ~/.kiro/hooks in container', { err });
        }
      }

      // Inject ephemeral SSH deploy key for GitHub repos.
      // Only runs when: project has a GitHub repo_url, a PAT is stored, and
      // the container has started (containerId is set). Failures are non-fatal
      // — the loop continues without SSH access rather than aborting.
      if (
        project &&
        project.repo_url &&
        sshKeyManager?.isGithubUrl(project.repo_url) &&
        credentialManager &&
        state.containerId
      ) {
        try {
          const pat = await credentialManager.getGithubPat(opts.projectId);
          if (!pat) {
            logger.warn('No GitHub PAT stored for this project — SSH deploy key setup skipped. Add a PAT in the project settings to enable git push over SSH.', { projectId: opts.projectId });
          } else {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            logger.info('Registering GitHub deploy key', { projectId: opts.projectId, repoUrl: project.repo_url });
            const keyId = await sshKeyManager.addDeployKey(pat, project.repo_url, publicKey, keyTitle);

            // Record in store before injection so a mid-injection crash leaves a traceable entry
            if (deployKeyStore) {
              const { owner, repo } = sshKeyManager.parseGithubRepo(project.repo_url);
              deployKeyStore.record({
                key_id: keyId,
                repo: `${owner}/${repo}`,
                project_id: opts.projectId,
                project_name: opts.projectName,
                loop_id: state.containerId,
                created_at: new Date().toISOString(),
                service: 'github',
              });
            }

            await sshKeyManager.injectIntoContainer(state.containerId, privateKey);
            activeDeployKeys.set(getLoopKey(opts.projectId, opts.role), { keyId, repoUrl: project.repo_url, pat, service: 'github' });
            logger.info('SSH deploy key injected into container', { projectId: opts.projectId, keyId });
          }
        } catch (err) {
          logger.warn('Failed to set up GitHub SSH deploy key; loop continues without SSH access', { projectId: opts.projectId, err });
        }
      }

      // Inject ephemeral SSH deploy key for GitLab repos.
      // Only runs when: project has a GitLab repo_url, a PAT is stored, and
      // the container has started (containerId is set). Failures are non-fatal.
      if (
        project &&
        project.repo_url &&
        sshKeyManager?.isGitlabUrl(project.repo_url) &&
        credentialManager &&
        state.containerId
      ) {
        try {
          const pat = await credentialManager.getGitlabPat(opts.projectId);
          if (!pat) {
            logger.warn('No GitLab PAT stored for this project — SSH deploy key setup skipped. Add a PAT in the project settings to enable git push over SSH.', { projectId: opts.projectId });
          } else {
            const { privateKey, publicKey } = sshKeyManager.generateKeyPair();
            const keyTitle = `zephyr-${opts.projectId.slice(0, 8)}-${Date.now()}`;
            logger.info('Registering GitLab deploy key', { projectId: opts.projectId, repoUrl: project.repo_url });
            const keyId = await sshKeyManager.addGitlabDeployKey(pat, project.repo_url, publicKey, keyTitle);

            // Record in store before injection so a mid-injection crash leaves a traceable entry
            if (deployKeyStore) {
              const { owner, repo } = sshKeyManager.parseGitlabRepo(project.repo_url);
              deployKeyStore.record({
                key_id: keyId,
                repo: `${owner}/${repo}`,
                project_id: opts.projectId,
                project_name: opts.projectName,
                loop_id: state.containerId,
                created_at: new Date().toISOString(),
                service: 'gitlab',
              });
            }

            await sshKeyManager.injectIntoContainerForGitlab(state.containerId, privateKey);
            activeDeployKeys.set(getLoopKey(opts.projectId, opts.role), { keyId, repoUrl: project.repo_url, pat, service: 'gitlab' });
            logger.info('GitLab SSH deploy key injected into container', { projectId: opts.projectId, keyId });
          }
        } catch (err) {
          logger.warn('Failed to set up GitLab SSH deploy key; loop continues without SSH access', { projectId: opts.projectId, err });
        }
      }

      return state;
  }

  ipcMain.handle(
    IPC.LOOP_STOP,
    async (_event, projectId: string, role?: string): Promise<void> => {
      return containerOrchestrator.stopLoop(projectId, role);
    },
  );

  ipcMain.handle(IPC.LOOP_LIST, async (): Promise<LoopState[]> => {
    return containerOrchestrator.listAll();
  });

  ipcMain.handle(
    IPC.LOOP_GET,
    async (_event, projectId: string, role?: string): Promise<LoopState | null> => {
      return containerOrchestrator.getLoopState(projectId, role);
    },
  );

  ipcMain.handle(
    IPC.LOOP_REMOVE,
    async (_event, projectId: string, role?: string): Promise<void> => {
      return containerOrchestrator.removeLoop(projectId, role);
    },
  );

  // ── Factory (multi-container coding factory) ────────────────────────────

  /**
   * Scaffold the team coordination file/folder structure inside a workspace.
   * Creates files only if they don't already exist so user edits are preserved.
   * @param featureRequestsContent - Optional custom content for @feature_requests.md.
   *   Defaults to the built-in template when omitted or empty.
   */
  async function scaffoldTeamFiles(workspacePath: string, featureRequestsContent?: string): Promise<void> {
    // Create directory tree with world-writable permissions so the container's
    // ralph user can write regardless of host UID mismatch.
    for (const dir of [
      path.join(workspacePath, 'team', 'handovers'),
      path.join(workspacePath, 'team', 'tasks', 'pending'),
      path.join(workspacePath, 'tasks', 'pending'),
    ]) {
      await fs.mkdir(dir, { recursive: true });
      await fs.chmod(dir, 0o777);
    }

    const defaultFeatureRequests = '# Feature Requests\n\nAdd feature requests here. Each entry should include:\n- Description of the feature\n- Priority (high/medium/low)\n- Acceptance criteria\n';

    // Files to create with default content (only if missing)
    const files: Record<string, string> = {
      '@feature_requests.md': featureRequestsContent?.trim() ? featureRequestsContent : defaultFeatureRequests,
      '@team_plan.md': '# Team Plan\n\nOverall plan and current sprint objectives.\n',
      '@human_clarification.md': '# Human Clarification\n\nUse this file to provide clarifications, answers, or guidance requested by the AI agents.\n',
      '@task-status.json': '{}',
      '@task-status.requested': '',
      '@TASK_STATUS_INSTRUCTIONS.md': TASK_STATUS_INSTRUCTIONS,
      // Pre-create with an empty object so fs.watch() can attach at factory
      // start. The onDecomp handler validates content (returns early for
      // missing action/parentTaskId/tasks), so {} won't trigger false positives.
      '@task-decomposition.json': '{}',
      '@task-decomposition.requested': '',
      '@TASK_DECOMPOSITION_INSTRUCTIONS.md': TASK_DECOMPOSITION_INSTRUCTIONS,
      // @supervisor-action.json is not pre-created — its presence means "action pending".
      '@supervisor-action.requested': '',
      'team/handovers/README.md': [
        '# Team Handovers',
        '',
        'This directory holds dynamic handover files written by agents and the host as tasks move through pipeline stages.',
        '',
        '## Naming convention',
        '',
        '- Agent-to-agent: `<taskId>-<fromStage>-to-<toStage>.md`',
        '  Example: `task-abc123-coder-to-security.md`',
        '- Host-to-PM (bounce escalation): `<taskId>-host-to-pm.md`',
        '  Example: `task-abc123-host-to-pm.md`',
        '',
        '## Protocol',
        '',
        '1. When completing a stage, the outgoing agent writes a handover file describing work done,',
        '   open questions, and any context the next stage needs.',
        '2. The receiving agent reads the handover file at the start of its turn.',
        '3. Host-to-PM handovers are written automatically when a task exceeds its bounce limit',
        '   and is redirected to Blocked. The PM reads it and decides whether to escalate to',
        '   a human (via `@human_clarification.md`), revise the task spec, or decompose it.',
        '4. Files are gitignored — they are ephemeral per-run coordination artifacts.',
      ].join('\n') + '\n',
      'team/handovers/status.log': '',
      'team/complete.flag': '',
      '.gitignore': [
        'team/handovers/',
        'team/complete.flag',
        'team/status.log',
        '@human_clarifications.md',
        '.*_checked_*',
        '.last_*',
        'tasks/pending/*',
        'team/human_*.md',
        '@task-status.json',
        '@task-status.requested',
        '@task-decomposition.json',
        '@task-decomposition.requested',
        '@supervisor-action.json',
        '@supervisor-action.requested',
      ].join('\n') + '\n',
    };

    for (const [filePath, defaultContent] of Object.entries(files)) {
      const fullPath = path.join(workspacePath, filePath);
      try {
        await fs.access(fullPath);
        // File exists — ensure it's writable by the container user.
        await fs.chmod(fullPath, 0o777);
      } catch {
        await fs.writeFile(fullPath, defaultContent, { encoding: 'utf8', mode: 0o777 });
      }
    }

    // Always reset the clarification-requested flag so stale requests from a
    // previous factory run don't cause agents to stall waiting for human input.
    await fs.writeFile(path.join(workspacePath, '@human_clarification.requested'), '', { encoding: 'utf8', mode: 0o666 });
  }

  ipcMain.handle(
    IPC.FACTORY_START,
    async (_event, projectId: string, baseOpts: LoopStartOpts): Promise<LoopState[]> => {
      const project = projectStore?.getProject(projectId) ?? null;
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      if (!project.factory_config?.enabled) {
        throw new Error('Factory mode is not enabled for this project');
      }

      // Pipeline-driven factory: every project must reference a pipeline. The
      // legacy hardcoded-roles fallback is removed; if no pipeline is assigned
      // we refuse rather than silently doing nothing (Phase 2.6 contract).
      if (!project.pipelineId) {
        throw new Error(`No pipeline assigned to project ${projectId}`);
      }
      if (!pipelineStore) {
        throw new Error('PipelineStore unavailable; cannot resolve project pipeline');
      }
      const pipeline = pipelineStore.getPipeline(project.pipelineId);
      if (!pipeline) {
        throw new Error(`Pipeline ${project.pipelineId} not found for project ${projectId}`);
      }
      if (pipeline.stages.length === 0) {
        throw new Error(`Pipeline ${pipeline.id} has no stages`);
      }

      // Scaffold team coordination files in the workspace
      if (project.local_path) {
        try {
          await scaffoldTeamFiles(project.local_path, project.feature_requests_content);
          logger.info('Team coordination files scaffolded', { projectId, path: project.local_path });
        } catch (err) {
          logger.warn('Failed to scaffold team files', { err, projectId });
        }

        // Write each stage's agentPrompt to /workspace/PROMPT_<stageId>.md so
        // the agent CMD (or loop script) can read it at runtime. Pipelines are
        // the single source of truth for prompts now; the legacy
        // project.custom_prompts files are no longer authoritative for factory
        // runs but still get injected by startLoopCore for parity.
        for (const stage of pipeline.stages) {
          try {
            const promptPath = path.join(project.local_path, `PROMPT_${stage.id}.md`);
            await fs.writeFile(promptPath, stage.agentPrompt, { encoding: 'utf8', mode: 0o644 });
          } catch (err) {
            logger.warn(`Failed to write PROMPT_${stage.id}.md to local_path`, { err, projectId });
          }
        }
      } else {
        logger.warn(
          'Project has no local_path; pipeline prompts cannot be written to /workspace and agents will fail to read them',
          { projectId },
        );
      }

      // Spawn one container per (stage, instanceIndex). Default instances=1.
      // Container role is the composite key "<stageId>-<instanceIndex>" so the
      // existing ContainerOrchestrator naming (`zephyr-<safeName>-<role>`) yields
      // `zephyr-<safeName>-<stageId>-<instanceIndex>` and getLoopKey distinguishes
      // parallel instances of the same stage. The agent receives stage id and
      // instance index as env vars so it can locate its prompt file and any
      // per-instance state.
      //
      // The container CMD is a polling loop that checks for
      // @current-task-${STAGE_ID}.json every 5 seconds and invokes the LLM agent
      // when a task is present. The initial sleep gives host setup execs (credential
      // injection, hook installation, etc.) time to complete before the agent runs.
      const factorySettings = configManager?.loadJson<AppSettings>('settings.json');
      const llmProvider = factorySettings?.llm_provider ?? 'claude';
      const agentInvocation = llmProvider === 'kiro'
        ? `kiro-cli chat --no-interactive --trust-all-tools "$(cat /workspace/PROMPT_\${STAGE_ID}.md 2>/dev/null)"`
        : `claude --print "$(cat /workspace/PROMPT_\${STAGE_ID}.md 2>/dev/null)" --output-format stream-json --verbose`;
      const agentLoopScript = [
        'export PATH="$HOME/.local/bin:$PATH"',
        'sleep 5',
        'while true; do',
        '  TASK_FILE="/workspace/@current-task-${STAGE_ID}.json"',
        '  if [ -f "$TASK_FILE" ]; then',
        `    cd /workspace && ${agentInvocation} || true`,
        '    rm -f "$TASK_FILE"',
        '  fi',
        '  sleep 5',
        'done',
      ].join('\n');
      const agentLoopCmd: string[] = ['bash', '-c', agentLoopScript];

      const results: LoopState[] = [];
      for (const stage of pipeline.stages) {
        const instances = Math.max(1, stage.instances ?? 1);
        for (let instanceIndex = 0; instanceIndex < instances; instanceIndex++) {
          const role = `${stage.id}-${instanceIndex}`;

          const roleOpts: LoopStartOpts = {
            ...baseOpts,
            projectId,
            projectName: project.name,
            role,
            cmd: agentLoopCmd,
            envVars: {
              ...(baseOpts.envVars ?? {}),
              STAGE_ID: stage.id,
              INSTANCE_INDEX: String(instanceIndex),
            },
          };

          try {
            const state = await startLoopCore(roleOpts);
            results.push(state);
          } catch (err) {
            logger.warn(
              `Failed to start factory stage ${stage.id} instance ${instanceIndex} for project ${projectId}`,
              { err },
            );
            // Continue starting other stages — partial factory is better than none
          }
        }
      }

      // Write the current task queue to /workspace/@task-queue.json so agents
      // starting up right now can immediately find tasks in their column.
      if (project.local_path && factoryTaskStore) {
        try {
          const tasks = factoryTaskStore.getQueue(projectId).tasks;
          await fs.writeFile(
            path.join(project.local_path, '@task-queue.json'),
            JSON.stringify(tasks, null, 2),
            'utf-8',
          );
        } catch (err) {
          logger.warn('Failed to write @task-queue.json on factory start', { err, projectId });
        }

        // For each pipeline stage that already has tasks queued (e.g. from a
        // previous session or manual kanban placement), write the @current-task
        // file so the agent loop's bash guard fires immediately on startup rather
        // than waiting for an upstream stage to dispatch a new task.
        // Only write for the first unlocked, non-epic task per stage to avoid
        // overwriting a file that may have been set by a concurrent dispatch.
        const allTasks = factoryTaskStore.getQueue(projectId).tasks;
        for (const stage of pipeline.stages) {
          const nextTask = allTasks.find(
            (t) => t.column === stage.id && !t.lockedBy && !t.isEpic,
          );
          if (nextTask) {
            try {
              const locked = factoryTaskStore.lockTask(projectId, nextTask.id, stage.id);
              fsSync.writeFileSync(
                path.join(project.local_path, `@current-task-${stage.id}.json`),
                JSON.stringify(locked, null, 2),
              );
              logger.info('FACTORY_START: dispatched existing stage task', {
                projectId,
                stageId: stage.id,
                taskId: nextTask.id,
              });
            } catch {
              // Already locked by a concurrent dispatch — leave existing file
            }
          }
        }
      }

      return results;
    },
  );

  ipcMain.handle(
    IPC.FACTORY_STOP,
    async (_event, projectId: string): Promise<void> => {
      // Find all running loops for this project and stop them
      const projectLoops = containerOrchestrator.listByProject(projectId);
      const activeLoops = projectLoops.filter((l) => !isLoopTerminal(l.status));

      const errors: Error[] = [];
      for (const loop of activeLoops) {
        try {
          await containerOrchestrator.stopLoop(loop.projectId, loop.role);
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // Containers are gone — clear stale locks so the kanban reflects idle state.
      // Run even when some containers failed to stop: a partial stop still means
      // none of those agents are executing, so their locks are no longer valid.
      if (factoryTaskStore) {
        const queue = factoryTaskStore.getQueue(projectId);
        for (const task of queue.tasks) {
          if (task.lockedBy) {
            try {
              factoryTaskStore.unlockTask(projectId, task.id);
            } catch (err) {
              logger.warn(`FACTORY_STOP: failed to unlock task ${task.id}`, err);
            }
          }
        }
      }

      // Delete all @current-task-*.json files so agents don't re-trigger on
      // stale files if the factory is restarted later.
      const project = projectStore?.getProject(projectId);
      if (project?.local_path) {
        try {
          const entries = fsSync.readdirSync(project.local_path);
          for (const entry of entries) {
            if (entry.startsWith('@current-task-') && entry.endsWith('.json')) {
              try { fsSync.unlinkSync(path.join(project.local_path, entry)); } catch { /* ignore */ }
            }
          }
        } catch { /* local_path may not be accessible */ }
      }

      if (errors.length > 0) {
        throw new Error(`Failed to stop ${errors.length} factory loop(s): ${errors.map((e) => e.message).join('; ')}`);
      }
    },
  );

  ipcMain.handle(
    IPC.FACTORY_RESTART_CONTAINER,
    async (_event, projectId: string, role: string): Promise<LoopState> => {
      const loopKey = getLoopKey(projectId, role);
      const opts = loopOptsMap.get(loopKey);
      if (!opts) {
        throw new Error(
          `No stored opts for loop ${loopKey}; container was not started in this session`,
        );
      }

      // Best-effort stop — container may already be stopped or failed.
      try {
        await containerOrchestrator.stopLoop(projectId, role);
      } catch {
        // Ignore — proceed to restart
      }

      const state = await startLoopCore(opts);

      // After restarting, ensure the current-task file exists for any pending
      // task in this stage. The previous container run may have deleted the file
      // (end-of-loop `rm -f "$TASK_FILE"`) without the agent successfully
      // advancing the task, leaving it stranded with no signal for the new
      // container to pick up.
      const stageId = role.replace(/-\d+$/, '');
      const project = projectStore?.getProject(projectId);
      const workspacePath = project?.local_path;
      if (workspacePath && factoryTaskStore) {
        const taskFilePath = path.join(workspacePath, `@current-task-${stageId}.json`);
        if (!fsSync.existsSync(taskFilePath)) {
          const queue = factoryTaskStore.getQueue(projectId);
          const pendingTask = queue.tasks.find((t) => t.column === stageId && !t.isEpic);
          if (pendingTask) {
            try {
              // Clear any stale lock from the previous failed run
              if (pendingTask.lockedBy) {
                factoryTaskStore.unlockTask(projectId, pendingTask.id);
              }
              const locked = factoryTaskStore.lockTask(projectId, pendingTask.id, stageId);
              fsSync.writeFileSync(taskFilePath, JSON.stringify(locked, null, 2));
              logger.info('FACTORY_RESTART_CONTAINER: re-dispatched stranded task', {
                projectId, stageId, taskId: pendingTask.id,
              });
              const updatedQueue = factoryTaskStore.getQueue(projectId);
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(IPC.FACTORY_TASK_CHANGED, projectId, updatedQueue.tasks);
                }
              });
            } catch (err) {
              logger.warn('FACTORY_RESTART_CONTAINER: failed to re-dispatch task', {
                projectId, stageId, err,
              });
            }
          }
        }
      }

      return state;
    },
  );

  // Scale up: spawn a new container instance for a pipeline stage.
  // Scans loopOptsMap (which persists across loop restarts) to find the
  // highest registered instance index and clone its opts for the new instance.
  // This works even when all existing instances are briefly idle/terminal
  // between tasks.
  ipcMain.handle(
    IPC.FACTORY_SCALE_UP,
    async (_event, projectId: string, stageId: string): Promise<LoopState> => {
      // Scan loopOptsMap for all registered instances of this stage.
      // Key format: "${projectId}:${stageId}-${index}"
      const keyPrefix = getLoopKey(projectId, `${stageId}-`);
      let maxIdx = -1;
      let templateOpts: LoopStartOpts | null = null;
      for (const [key, opts] of loopOptsMap.entries()) {
        if (!key.startsWith(keyPrefix)) continue;
        const idx = parseInt(key.slice(keyPrefix.length), 10);
        if (!isNaN(idx) && idx > maxIdx) {
          maxIdx = idx;
          templateOpts = opts;
        }
      }

      if (!templateOpts) {
        throw new Error(`No registered ${stageId} instance found. Start the factory first.`);
      }

      const newIdx = maxIdx + 1;
      const newRole = `${stageId}-${newIdx}`;
      const newOpts: LoopStartOpts = {
        ...templateOpts,
        role: newRole,
        envVars: {
          ...(templateOpts.envVars ?? {}),
          INSTANCE_INDEX: String(newIdx),
        },
      };

      return startLoopCore(newOpts);
    },
  );

  // Scale down: stop the highest-indexed instance of a pipeline stage.
  ipcMain.handle(
    IPC.FACTORY_SCALE_DOWN,
    async (_event, projectId: string, stageId: string): Promise<void> => {
      const running = containerOrchestrator.listAll().filter(
        (l) => l.projectId === projectId && l.role?.startsWith(`${stageId}-`) && !isLoopTerminal(l.status),
      );
      if (running.length <= 1) {
        throw new Error(`Cannot scale below 1 instance for ${stageId}`);
      }
      // Find the highest instance index
      let maxIdx = -1;
      let maxRole = '';
      for (const l of running) {
        const idx = parseInt(l.role?.split('-').pop() ?? '0', 10);
        if (idx > maxIdx) {
          maxIdx = idx;
          maxRole = l.role ?? '';
        }
      }
      await containerOrchestrator.stopLoop(projectId, maxRole);
    },
  );

  // ── Event broadcasting ────────────────────────────────────────────────────

  // Clean up GitHub deploy keys when a loop reaches a terminal state.
  // Uses a separate onStateChange callback so cleanup is decoupled from broadcasting.
  containerOrchestrator.onStateChange(async (state: LoopState) => {
    if (!isLoopTerminal(state.status)) {
      return;
    }

    const loopKey = getLoopKey(state);
    const keyInfo = activeDeployKeys.get(loopKey);
    if (!keyInfo || !sshKeyManager) {
      return;
    }

    // Remove from local map first so a re-entrant terminal state change is a no-op
    activeDeployKeys.delete(loopKey);

    try {
      if (keyInfo.service === 'gitlab') {
        await sshKeyManager.removeGitlabDeployKey(keyInfo.pat, keyInfo.repoUrl, keyInfo.keyId);
        logger.info('SSH deploy key removed from GitLab', { projectId: state.projectId, keyId: keyInfo.keyId });
      } else {
        await sshKeyManager.removeDeployKey(keyInfo.pat, keyInfo.repoUrl, keyInfo.keyId);
        logger.info('SSH deploy key removed from GitHub', { projectId: state.projectId, keyId: keyInfo.keyId });
      }
      deployKeyStore?.markCleaned(keyInfo.keyId);
    } catch (err) {
      logger.warn('Failed to remove deploy key (key may need manual cleanup)', {
        err,
        projectId: state.projectId,
        keyId: keyInfo.keyId,
        service: keyInfo.service,
      });
    }
  });

  // Register callbacks to broadcast state changes and log lines to all renderer windows

  // Watchers for @human_clarification.requested per active loop key.
  // The trigger file is written only by the injected hook when the agent writes
  // @human_clarification.md, so no cooldown is needed.
  const clarificationWatchers = new Map<string, fsSync.FSWatcher>();

  // Watchers for human edits to @human_clarification.md (the response path).
  // Set up when the PM is paused; torn down when the human responds.
  const clarificationResponseWatchers = new Map<string, fsSync.FSWatcher>();

  // Tracks the taskId that was moved to needs_input per loop key so we can
  // move it back when the human responds.
  const clarificationTaskIds = new Map<string, string>();

  // Watcher for @task-status.requested per project (shared across all roles).
  // Watcher for @task-status changes per project (shared across all roles).
  // We watch both the .requested trigger (written by Claude hooks) and the
  // .json file itself (for kiro-cli or any engine without PostToolUse hooks).
  const taskStatusWatchers = new Map<string, fsSync.FSWatcher[]>();
  // Polling fallback: fs.watch() is unreliable on Podman/Docker bind mounts
  // on macOS (events don't propagate through the VM layer). Poll mtime every
  // 3 seconds as a safety net alongside the native watcher.
  const taskStatusPollers = new Map<string, NodeJS.Timeout>();
  const taskStatusLastMtime = new Map<string, number>();

  // Watcher for @task-decomposition.requested per project (shared across all
  // roles). The PM agent writes @task-decomposition.json to break an epic into
  // sub-tasks; the host reads it, creates the children atomically, and deletes
  // the source file so re-triggers don't duplicate.
  const taskDecompositionWatchers = new Map<string, fsSync.FSWatcher[]>();
  const taskDecompositionPollers = new Map<string, NodeJS.Timeout>();
  const taskDecompositionLastMtime = new Map<string, number>();

  // Watcher for @supervisor-action.requested per project (shared across all
  // roles). Any container can write @supervisor-action.json to trigger host-side
  // container restarts; the host reads it, dispatches the action, and leaves
  // the source file in place (each restart is a distinct write).
  const supervisorActionWatchers = new Map<string, fsSync.FSWatcher>();
  const supervisorActionPollers = new Map<string, NodeJS.Timeout>();
  const supervisorActionLastMtime = new Map<string, number>();

  // Tracks the set of active loop keys per project to know when all loops for
  // a project have terminated and the task status watcher can be torn down.
  const activeLoopKeysByProject = new Map<string, Set<string>>();

  containerOrchestrator.onStateChange((state: LoopState) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      win.webContents.send(IPC.LOOP_STATE_CHANGED, state);
    });

    const loopKey = getLoopKey(state.projectId, state.role);
    const project = projectStore?.getProject(state.projectId);

    // Track active loop keys per project and start task status watcher on first RUNNING loop
    if (state.status === LoopStatus.RUNNING) {
      if (!activeLoopKeysByProject.has(state.projectId)) {
        activeLoopKeysByProject.set(state.projectId, new Set());
      }
      activeLoopKeysByProject.get(state.projectId)?.add(loopKey);

      // Start per-project task status watcher only once (not per role)
      if (!taskStatusWatchers.has(state.projectId)) {
        const workspacePath = project?.local_path;
        if (workspacePath && factoryTaskStore) {
          const statusJsonPath = path.join(workspacePath, '@task-status.json');
          const taskStatusTrigger = path.join(workspacePath, '@task-status.requested');
          // Guard against double-processing the same write. Both the direct
          // @task-status.json watcher and the @task-status.requested hook
          // trigger call onStatusChange; without this check the second call
          // reads the same file after the task has already moved, causing it
          // to advance one extra stage (e.g. security → qa on a coder forward).
          let lastProcessedStatusMtime = 0;
          const onStatusChange = () => {
              try {
                const stat = fsSync.statSync(statusJsonPath);
                if (stat.mtimeMs <= lastProcessedStatusMtime) return;
                lastProcessedStatusMtime = stat.mtimeMs;
              } catch { return; }

              let statusData: unknown;
              try {
                const statusRaw = fsSync.readFileSync(
                  statusJsonPath,
                  'utf-8',
                );
                statusData = JSON.parse(statusRaw);
              } catch {
                return;
              }

              // Capture source stage before the move so we can clean up its
              // current-task file after a forward or rejected transition.
              const sdPre = statusData as { taskId?: string; status?: string };
              const taskBefore = sdPre.taskId
                ? factoryTaskStore.getTask(state.projectId, sdPre.taskId)
                : null;
              const sourceStage = taskBefore?.column;

              const changed = processTaskStatusUpdate(state.projectId, statusData, {
                factoryTaskStore,
                projectStore,
                pipelineStore,
              });
              if (!changed) return;

              // When a task moves out of a pipeline stage, delete its current-task
              // file so the agent's bash guard stops firing for that stage.
              // Guard: only delete if the file still points to THIS task —
              // another task may have already been written there (e.g. security
              // rejected task B to coder while coder was finishing task A).
              if (
                (sdPre.status === 'forward' || sdPre.status === 'rejected') &&
                sourceStage &&
                !['backlog', 'done', 'blocked', 'needs_input'].includes(sourceStage)
              ) {
                let sourceFileDeleted = false;
                try {
                  const currentTaskFile = path.join(workspacePath, `@current-task-${sourceStage}.json`);
                  const existing = JSON.parse(
                    fsSync.readFileSync(currentTaskFile, 'utf-8'),
                  ) as { id?: string };
                  if (existing.id === sdPre.taskId) {
                    fsSync.unlinkSync(currentTaskFile);
                    sourceFileDeleted = true;
                  }
                  // else: a new task was already assigned to this stage — leave it
                } catch { /* file may not exist */ }

                // When the current-task file was cleared, dispatch the next queued task
                // in the source stage so the agent loop immediately picks it up rather
                // than sitting idle until a new task arrives from upstream.
                if (sourceFileDeleted) {
                  const nextSourceTask = factoryTaskStore
                    .getQueue(state.projectId)
                    .tasks.find(
                      (t) => t.column === sourceStage && !t.lockedBy && !t.isEpic,
                    );
                  if (nextSourceTask) {
                    try {
                      const lockedNext = factoryTaskStore.lockTask(
                        state.projectId,
                        nextSourceTask.id,
                        sourceStage,
                      );
                      fsSync.writeFileSync(
                        path.join(workspacePath, `@current-task-${sourceStage}.json`),
                        JSON.stringify(lockedNext, null, 2),
                      );
                    } catch { /* already locked by another instance — leave it */ }
                    dispatchFactoryStage(state.projectId, sourceStage);
                  }
                }
              }

              const sd = statusData as { taskId?: string };
              if (sd.taskId) {
                const movedTask = factoryTaskStore.getTask(state.projectId, sd.taskId);
                if (movedTask && !['backlog', 'done', 'blocked', 'needs_input'].includes(movedTask.column)) {
                  // Pre-lock with the stage name so the kanban badge reflects the
                  // new stage immediately while the next agent container wakes up.
                  try {
                    factoryTaskStore.lockTask(state.projectId, sd.taskId, movedTask.column);
                    // Write the current-task file so the target stage's agent guard activates.
                    const lockedTask = factoryTaskStore.getTask(state.projectId, sd.taskId);
                    if (lockedTask) {
                      fsSync.writeFileSync(
                        path.join(workspacePath, `@current-task-${movedTask.column}.json`),
                        JSON.stringify(lockedTask, null, 2),
                      );
                    }
                  } catch { /* already locked */ }
                  dispatchFactoryStage(state.projectId, movedTask.column);
                }
              }

              const updatedQueue = factoryTaskStore.getQueue(state.projectId);
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(
                    IPC.FACTORY_TASK_CHANGED,
                    state.projectId,
                    updatedQueue.tasks,
                  );
                }
              });

              fs.writeFile(
                path.join(workspacePath, '@task-queue.json'),
                JSON.stringify(updatedQueue.tasks, null, 2),
                'utf-8',
              ).catch(() => {/* non-fatal */});
          };
          const watchers: fsSync.FSWatcher[] = [];
          // Watch the .requested trigger (Claude PostToolUse hook)
          try { watchers.push(fsSync.watch(taskStatusTrigger, onStatusChange)); } catch { /* may not exist yet */ }
          // Watch the .json file directly (kiro-cli / engines without hooks)
          try { watchers.push(fsSync.watch(statusJsonPath, onStatusChange)); } catch { /* may not exist yet */ }
          if (watchers.length > 0) {
            taskStatusWatchers.set(state.projectId, watchers);
          }
          // Polling fallback: check mtime every 3s for bind-mount environments
          // where fs.watch events don't propagate (macOS + Podman/Docker).
          try {
            const stat = fsSync.statSync(statusJsonPath);
            taskStatusLastMtime.set(state.projectId, stat.mtimeMs);
          } catch { /* file may not exist */ }
          const statusPoller = setInterval(() => {
            try {
              const stat = fsSync.statSync(statusJsonPath);
              const prev = taskStatusLastMtime.get(state.projectId) ?? 0;
              if (stat.mtimeMs > prev) {
                taskStatusLastMtime.set(state.projectId, stat.mtimeMs);
                onStatusChange();
              }
            } catch { /* file may not exist */ }
          }, 3000);
          taskStatusPollers.set(state.projectId, statusPoller);
        }
      }

      // Start per-project task decomposition watcher only once (not per role).
      // Pipeline lookups are required so the dispatcher can resolve the first
      // stage column; if the deps aren't wired we silently skip rather than
      // attaching a dead watcher.
      if (
        !taskDecompositionWatchers.has(state.projectId) &&
        factoryTaskStore &&
        projectStore &&
        pipelineStore
      ) {
        const workspacePath = project?.local_path;
        if (workspacePath) {
          const decompTrigger = path.join(workspacePath, '@task-decomposition.requested');
          const decompFile = path.join(workspacePath, '@task-decomposition.json');
          const onDecomp = () => {
              let decompData: unknown;
              try {
                const decompRaw = fsSync.readFileSync(decompFile, 'utf-8');
                decompData = JSON.parse(decompRaw);
              } catch {
                return;
              }

              const changed = processTaskDecomposition(state.projectId, decompData, {
                factoryTaskStore,
                projectStore,
                pipelineStore,
              });
              if (!changed) return;

              const proj = projectStore.getProject(state.projectId);
              const pl = proj?.pipelineId ? pipelineStore.getPipeline(proj.pipelineId) : null;
              if (pl && pl.stages.length > 0) {
                dispatchFactoryStage(state.projectId, pl.stages[0].id);
              }

              // Reset to empty sentinel so the watcher stays alive for
              // subsequent decompositions (unlink would invalidate it).
              try {
                fsSync.writeFileSync(decompFile, '{}', 'utf-8');
              } catch (err) {
                logger.warn('Failed to reset @task-decomposition.json after processing', {
                  err,
                  projectId: state.projectId,
                });
              }

              const updatedQueue = factoryTaskStore.getQueue(state.projectId);
              BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed()) {
                  win.webContents.send(
                    IPC.FACTORY_TASK_CHANGED,
                    state.projectId,
                    updatedQueue.tasks,
                  );
                }
              });
          };
          const watchers: fsSync.FSWatcher[] = [];
          try { watchers.push(fsSync.watch(decompTrigger, onDecomp)); } catch { /* may not exist yet */ }
          try { watchers.push(fsSync.watch(decompFile, onDecomp)); } catch { /* may not exist yet */ }
          if (watchers.length > 0) {
            taskDecompositionWatchers.set(state.projectId, watchers);
          }
          // Polling fallback for decomposition file
          try {
            const stat = fsSync.statSync(decompFile);
            taskDecompositionLastMtime.set(state.projectId, stat.mtimeMs);
          } catch { /* file may not exist */ }
          const decompPoller = setInterval(() => {
            try {
              const stat = fsSync.statSync(decompFile);
              const prev = taskDecompositionLastMtime.get(state.projectId) ?? 0;
              if (stat.mtimeMs > prev) {
                taskDecompositionLastMtime.set(state.projectId, stat.mtimeMs);
                onDecomp();
              }
            } catch { /* file may not exist */ }
          }, 3000);
          taskDecompositionPollers.set(state.projectId, decompPoller);
        }
      }

      // Start per-project supervisor-action watcher only once (not per role).
      if (!supervisorActionWatchers.has(state.projectId)) {
        const workspacePath = project?.local_path;
        if (workspacePath) {
          const supervisorTrigger = path.join(workspacePath, '@supervisor-action.requested');
          const supervisorFile = path.join(workspacePath, '@supervisor-action.json');
          const onSupervisorAction = () => {
              let actionData: unknown;
              try {
                const raw = fsSync.readFileSync(supervisorFile, 'utf-8');
                actionData = JSON.parse(raw);
              } catch {
                return;
              }

              processSupervisorAction(state.projectId, actionData, {
                containerOrchestrator,
                loopOptsMap,
                restartLoop: startLoopCore,
              }).catch((err) => {
                logger.warn('supervisor-action watcher: unhandled error', {
                  err,
                  projectId: state.projectId,
                });
              });
          };
          try {
            const watcher = fsSync.watch(supervisorTrigger, onSupervisorAction);
            supervisorActionWatchers.set(state.projectId, watcher);
          } catch {
            // @supervisor-action.requested may not exist yet — ignore
          }
          // Polling fallback for supervisor action file
          try {
            const stat = fsSync.statSync(supervisorFile);
            supervisorActionLastMtime.set(state.projectId, stat.mtimeMs);
          } catch { /* file may not exist */ }
          const supervisorPoller = setInterval(() => {
            try {
              const stat = fsSync.statSync(supervisorFile);
              const prev = supervisorActionLastMtime.get(state.projectId) ?? 0;
              if (stat.mtimeMs > prev) {
                supervisorActionLastMtime.set(state.projectId, stat.mtimeMs);
                onSupervisorAction();
              }
            } catch { /* file may not exist */ }
          }, 3000);
          supervisorActionPollers.set(state.projectId, supervisorPoller);
        }
      }
    }

    // Start watching @human_clarification.requested when a loop becomes active
    if (state.status === LoopStatus.RUNNING && !clarificationWatchers.has(loopKey)) {
      const workspacePath = project?.local_path;
      if (workspacePath) {
        const clarificationTrigger = path.join(workspacePath, '@human_clarification.requested');
        const clarificationFile = path.join(workspacePath, '@human_clarification.md');
        try {
          const watcher = fsSync.watch(clarificationTrigger, async () => {
            const logger = getLogger('loop');

            // 1. Send OS notification
            const settings = configManager?.loadJson<AppSettings>('settings.json');
            if (settings?.notification_enabled) {
              const projectName = project?.name ?? state.projectId;
              new Notification({
                title: 'Agent needs clarification',
                body: `"${projectName}" is waiting for your input in @human_clarification.md`,
              }).show();
            }

            // 2. Pause the PM container to stop burning tokens
            try {
              await containerOrchestrator.pauseLoop(state.projectId, state.role);
            } catch (err) {
              logger.warn('Failed to pause PM loop on clarification', { loopKey, err });
            }

            // 3. Read taskId from @human_clarification.md and move to needs_input
            if (factoryTaskStore) {
              try {
                const raw = fsSync.readFileSync(clarificationFile, 'utf-8');
                const parsed = JSON.parse(raw);
                const taskId = parsed?.taskId;
                if (taskId && typeof taskId === 'string') {
                  const task = factoryTaskStore.getTask(state.projectId, taskId);
                  if (task && task.column !== 'needs_input') {
                    factoryTaskStore.moveTask(state.projectId, taskId, 'needs_input');
                    clarificationTaskIds.set(loopKey, taskId);

                    // Broadcast updated queue to renderer
                    const updatedQueue = factoryTaskStore.getQueue(state.projectId);
                    BrowserWindow.getAllWindows().forEach((win) => {
                      if (!win.isDestroyed()) {
                        win.webContents.send(IPC.FACTORY_TASK_CHANGED, state.projectId, updatedQueue.tasks);
                      }
                    });

                    // Persist to workspace
                    fs.writeFile(
                      path.join(workspacePath, '@task-queue.json'),
                      JSON.stringify(updatedQueue.tasks, null, 2),
                      'utf-8',
                    ).catch(() => {/* non-fatal */});
                  }
                }
              } catch {
                // @human_clarification.md may not be valid JSON — non-fatal
              }
            }

            // 4. Watch @human_clarification.md for human edits to resume
            if (!clarificationResponseWatchers.has(loopKey)) {
              try {
                const mTimeBefore = fsSync.statSync(clarificationFile).mtimeMs;
                const responseWatcher = fsSync.watch(clarificationFile, async () => {
                  // Only trigger if the file was actually modified (not just accessed)
                  let mTimeAfter: number;
                  try { mTimeAfter = fsSync.statSync(clarificationFile).mtimeMs; } catch { return; }
                  if (mTimeAfter <= mTimeBefore) return;

                  // Tear down this response watcher
                  responseWatcher.close();
                  clarificationResponseWatchers.delete(loopKey);

                  // Move task back from needs_input to pm
                  const savedTaskId = clarificationTaskIds.get(loopKey);
                  clarificationTaskIds.delete(loopKey);
                  if (savedTaskId && factoryTaskStore) {
                    try {
                      const task = factoryTaskStore.getTask(state.projectId, savedTaskId);
                      if (task?.column === 'needs_input') {
                        factoryTaskStore.moveTask(state.projectId, savedTaskId, 'pm');
                        const updatedQueue = factoryTaskStore.getQueue(state.projectId);
                        BrowserWindow.getAllWindows().forEach((win) => {
                          if (!win.isDestroyed()) {
                            win.webContents.send(IPC.FACTORY_TASK_CHANGED, state.projectId, updatedQueue.tasks);
                          }
                        });
                        fs.writeFile(
                          path.join(workspacePath, '@task-queue.json'),
                          JSON.stringify(updatedQueue.tasks, null, 2),
                          'utf-8',
                        ).catch(() => {/* non-fatal */});
                      }
                    } catch (err) {
                      logger.warn('Failed to move task back from needs_input', { loopKey, savedTaskId, err });
                    }
                  }

                  // Resume the PM container
                  try {
                    await containerOrchestrator.resumeLoop(state.projectId, state.role);
                  } catch (err) {
                    logger.warn('Failed to resume PM loop after clarification', { loopKey, err });
                  }
                });
                clarificationResponseWatchers.set(loopKey, responseWatcher);
              } catch {
                // @human_clarification.md may not exist yet — ignore
              }
            }
          });
          clarificationWatchers.set(loopKey, watcher);
        } catch {
          // File may not exist yet — ignore
        }
      }
    }

    // Tear down watchers when the loop reaches a terminal state
    if (isLoopTerminal(state.status)) {
      const watcher = clarificationWatchers.get(loopKey);
      if (watcher) {
        watcher.close();
        clarificationWatchers.delete(loopKey);
      }
      const responseWatcher = clarificationResponseWatchers.get(loopKey);
      if (responseWatcher) {
        responseWatcher.close();
        clarificationResponseWatchers.delete(loopKey);
      }
      clarificationTaskIds.delete(loopKey);

      // Remove this loop from the project's active-key set; tear down task
      // status watcher only when no other loops for this project remain active.
      const activeKeys = activeLoopKeysByProject.get(state.projectId);
      if (activeKeys) {
        activeKeys.delete(loopKey);
        if (activeKeys.size === 0) {
          activeLoopKeysByProject.delete(state.projectId);
          const taskWatcher = taskStatusWatchers.get(state.projectId);
          if (taskWatcher) {
            taskWatcher.forEach((w) => w.close());
            taskStatusWatchers.delete(state.projectId);
          }
          const statusPoller = taskStatusPollers.get(state.projectId);
          if (statusPoller) {
            clearInterval(statusPoller);
            taskStatusPollers.delete(state.projectId);
            taskStatusLastMtime.delete(state.projectId);
          }
          const decompWatcher = taskDecompositionWatchers.get(state.projectId);
          if (decompWatcher) {
            decompWatcher.forEach((w) => w.close());
            taskDecompositionWatchers.delete(state.projectId);
          }
          const decompPoller = taskDecompositionPollers.get(state.projectId);
          if (decompPoller) {
            clearInterval(decompPoller);
            taskDecompositionPollers.delete(state.projectId);
            taskDecompositionLastMtime.delete(state.projectId);
          }
          const supervisorWatcher = supervisorActionWatchers.get(state.projectId);
          if (supervisorWatcher) {
            supervisorWatcher.close();
            supervisorActionWatchers.delete(state.projectId);
          }
          const supervisorPoller = supervisorActionPollers.get(state.projectId);
          if (supervisorPoller) {
            clearInterval(supervisorPoller);
            supervisorActionPollers.delete(state.projectId);
            supervisorActionLastMtime.delete(state.projectId);
          }
        }
      }
    }

    // Fire OS desktop notification on loop completion or failure
    if (state.status === LoopStatus.COMPLETED || state.status === LoopStatus.FAILED) {
      const settings = configManager?.loadJson<AppSettings>('settings.json');
      if (settings?.notification_enabled) {
        const projectName = project?.name ?? state.projectId;
        const isCompleted = state.status === LoopStatus.COMPLETED;
        new Notification({
          title: isCompleted ? 'Loop completed' : 'Loop failed',
          body: isCompleted
            ? `"${projectName}" finished successfully.`
            : `"${projectName}" stopped with an error.`,
        }).show();
      }
    }
  });

  // Throttle log line IPC broadcasts: buffer lines and flush every 250ms
  // to avoid overwhelming the renderer with individual IPC messages.
  let logLineBuffer: { projectId: string; line: unknown }[] = [];
  let logLineFlushTimer: NodeJS.Timeout | null = null;

  containerOrchestrator.onLogLine((projectId, line) => {
    logLineBuffer.push({ projectId, line });

    if (!logLineFlushTimer) {
      logLineFlushTimer = setTimeout(() => {
        const windows = BrowserWindow.getAllWindows();
        const batch = logLineBuffer;
        logLineBuffer = [];
        logLineFlushTimer = null;

        for (const entry of batch) {
          windows.forEach((win) => {
            win.webContents.send(IPC.LOOP_LOG_LINE, entry.projectId, entry.line);
          });
        }
      }, 250);
    }
  });

  /**
   * Restart idle SINGLE-mode containers for a pipeline stage so the agent
   * can process a newly arrived task from /workspace/@task-queue.json.
   * Iterates over all registered instances of the stage (e.g. stageId-0,
   * stageId-1, …) and restarts any that have reached a terminal state.
   * Running containers (CONTINUOUS mode or still executing) are skipped —
   * they will pick up the task when they next read the queue file.
   */
  function dispatchFactoryStage(projectId: string, stageId: string): void {
    const firstKey = getLoopKey(projectId, `${stageId}-0`);
    if (!loopOptsMap.has(firstKey)) {
      logger.warn('dispatchFactoryStage: no registered opts for stage — factory may not be running', { projectId, stageId });
    }
    for (let i = 0; i < 16; i++) {
      const role = `${stageId}-${i}`;
      const loopKey = getLoopKey(projectId, role);
      const opts = loopOptsMap.get(loopKey);
      if (!opts) break; // no more registered instances for this stage

      const loop = containerOrchestrator.getLoopState(projectId, role);
      if (loop && !isLoopTerminal(loop.status)) {
        // Still running — the agent polling loop will pick up the task file on its next check.
        // Upgrade pre-lock to instance-level if the task file exists and
        // the task is still at the stage-level pre-lock (e.g. "coder" → "coder-0").
        upgradeStagePreLock(projectId, stageId, role);
        continue;
      }

      // Container is idle/terminal — restart it so it processes the new task
      logger.info('dispatchFactoryStage: restarting idle container', { projectId, role });
      startLoopCore(opts)
        .then(() => upgradeStagePreLock(projectId, stageId, role))
        .catch((err) => {
          logger.warn('dispatchFactoryStage: failed to restart container', { projectId, role, err });
        });
    }
  }

  /**
   * Upgrades a stage-level pre-lock (e.g. "coder") to an instance-level lock
   * (e.g. "coder-0") so the kanban shows the blue ⚙ active badge as soon as
   * the container starts rather than waiting for the agent to send a locked status.
   */
  function upgradeStagePreLock(projectId: string, stageId: string, role: string): void {
    const project = projectStore?.getProject(projectId);
    const workspacePath = project?.local_path;
    if (!workspacePath || !factoryTaskStore) return;
    try {
      const taskFile = path.join(workspacePath, `@current-task-${stageId}.json`);
      const taskData = JSON.parse(fsSync.readFileSync(taskFile, 'utf-8')) as { id?: string };
      if (!taskData.id) return;
      const task = factoryTaskStore.getTask(projectId, taskData.id);
      if (!task) return;
      // Only upgrade if still at stage pre-lock; skip if already instance-locked or unlocked
      const stagePrefix = role.replace(/-\d+$/, '');
      if (task.lockedBy !== stagePrefix) return;
      // Guard: only one task per agent instance can hold an instance-level lock at a time.
      // If this role (e.g. "coder-0") is already actively working on another task, leave the
      // new task at the stage pre-lock ("coder") so the kanban shows it as queued (yellow 🔒)
      // rather than falsely marking it as actively being worked on (blue ⚙ coder-0).
      const queue = factoryTaskStore.getQueue(projectId);
      if (queue.tasks.some((t) => t.lockedBy === role)) return;
      factoryTaskStore.unlockTask(projectId, taskData.id);
      const upgraded = factoryTaskStore.lockTask(projectId, taskData.id, role);
      fsSync.writeFileSync(taskFile, JSON.stringify(upgraded, null, 2));
      const updatedQueue = factoryTaskStore.getQueue(projectId);
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.FACTORY_TASK_CHANGED, projectId, updatedQueue.tasks);
        }
      });
    } catch {
      // Non-fatal: agent will send its own locked status message shortly
    }
  }

  // ── Stuck-agent watchdog ────────────────────────────────────────────────────
  // Every 5 minutes, scan all active factory tasks. Any task locked by an agent
  // instance (e.g. "coder-0") whose updatedAt is older than STUCK_THRESHOLD_MS
  // is considered stuck. We force-restart that container so it picks the task up
  // again with a fresh context. The threshold is intentionally conservative (30 min)
  // to avoid false-positives on legitimately long-running tasks.
  const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
  const AGENT_INSTANCE_RE = /^.+-\d+$/;

  const stuckWatchdogTimer = setInterval(() => {
    if (!factoryTaskStore || !projectStore) return;
    const now = Date.now();
    for (const [_loopKey, opts] of loopOptsMap.entries()) {
      const { projectId } = opts;
      if (!projectId) continue;
      const queue = factoryTaskStore.getQueue(projectId);
      for (const task of queue.tasks) {
        if (!task.lockedBy || !AGENT_INSTANCE_RE.test(task.lockedBy)) continue;
        const updatedMs = new Date(task.updatedAt).getTime();
        if (now - updatedMs < STUCK_THRESHOLD_MS) continue;

        // Task has been agent-locked without any update for > STUCK_THRESHOLD_MS
        const stuckRole = task.lockedBy; // e.g. "coder-0"
        const stageId = stuckRole.replace(/-\d+$/, '');
        logger.warn('stuck-watchdog: agent appears stuck — force-restarting container', {
          projectId,
          taskId: task.id,
          lockedBy: stuckRole,
          staleMinutes: Math.floor((now - updatedMs) / 60000),
        });

        // Stop the stuck container (it may still be running — dispatchFactoryStage
        // only restarts terminal containers, so we must kill it explicitly first).
        containerOrchestrator.stopLoop(projectId, stuckRole).catch(() => { /* already stopped */ });

        // Unlock so the restarted container can acquire a fresh instance-level lock
        try { factoryTaskStore.unlockTask(projectId, task.id); } catch { /* ignore */ }

        // Small delay to let stopLoop settle before restarting
        setTimeout(() => { dispatchFactoryStage(projectId, stageId); }, 2000);
        break; // one restart per project per tick to avoid thundering herd
      }
    }
  }, WATCHDOG_INTERVAL_MS);

  // Expose cleanup so tests / app shutdown can clear the interval
  const stopWatchdog = () => clearInterval(stuckWatchdogTimer);

  return { dispatchFactoryStage, stopWatchdog };
}
