import React, { useEffect, useState } from 'react';
import type { LoopState } from '../../../shared/loop-types';
import { LoopStatus, getLoopKey } from '../../../shared/loop-types';

interface FactoryFlowViewProps {
  /** All loops belonging to this factory project */
  loops: LoopState[];
  /** Currently selected loop key */
  selectedLoopKey: string | null;
  /** Called when user clicks a node to select that agent's logs */
  onSelectLoop: (loop: LoopState) => void;
  /** Optional: called when user clicks the restart button on a node. */
  onRestartLoop?: (loop: LoopState) => void;
}

/** How recently (ms) a log line must have arrived to consider the agent "active" */
const ACTIVE_THRESHOLD_MS = 5000;

/** Tick interval for re-evaluating activity pulse */
const TICK_MS = 1000;

/** Extract the stage id from a composite role key (e.g. "coder-0" → "coder", "coder" → "coder"). */
export function stageIdFromRole(role: string): string {
  return role.replace(/-\d+$/, '');
}

/** Extract instance index from composite role key (e.g. "coder-0" → 0, "coder" → null). */
export function instanceIndexFromRole(role: string): number | null {
  const m = role.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Renders a horizontal pipeline diagram for a coding factory.
 * Each agent role is a node showing status, activity pulse, iteration, and commit count.
 * Nodes are connected by directional arrows in the order they were spawned (pipeline stage order).
 * Supports composite role keys (e.g. "coder-0", "coder-1") produced by Phase 2.5 multi-instance spawning.
 */
export const FactoryFlowView: React.FC<FactoryFlowViewProps> = ({
  loops,
  selectedLoopKey,
  onSelectLoop,
  onRestartLoop,
}) => {
  // Force re-render every TICK_MS so the activity pulse stays up-to-date
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Build a map from role → loop; Map preserves insertion order which equals pipeline spawn order.
  const loopByRole = new Map<string, LoopState>();
  for (const loop of loops) {
    if (loop.role) {
      loopByRole.set(loop.role, loop);
    }
  }

  // Ordered roles in pipeline stage order (Map iteration order = insertion order).
  const orderedRoles = [...loopByRole.keys()];

  // Count how many instances exist per stageId so multi-instance stages get numbered labels.
  const stageCounts = new Map<string, number>();
  for (const role of orderedRoles) {
    const sid = stageIdFromRole(role);
    stageCounts.set(sid, (stageCounts.get(sid) ?? 0) + 1);
  }

  if (orderedRoles.length === 0) return null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {orderedRoles.map((role, idx) => {
          const loop = loopByRole.get(role)!;
          const isSelected = getLoopKey(loop) === selectedLoopKey;
          const isActive =
            loop.lastLogAt != null && Date.now() - loop.lastLogAt < ACTIVE_THRESHOLD_MS;
          const isRunning =
            loop.status === LoopStatus.RUNNING || loop.status === LoopStatus.STARTING;

          return (
            <React.Fragment key={role}>
              {/* Arrow connector between nodes */}
              {idx > 0 && <Arrow />}
              <FlowNode
                role={role}
                loop={loop}
                stageCounts={stageCounts}
                isSelected={isSelected}
                isActive={isActive}
                isRunning={isRunning}
                onClick={() => onSelectLoop(loop)}
                onRestart={onRestartLoop ? () => onRestartLoop(loop) : undefined}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

/* ── Sub-components ─────────────────────────────────────────────────────────── */

const Arrow: React.FC = () => (
  <div className="flex items-center flex-shrink-0 px-1">
    <div className="w-6 h-px bg-gray-500" />
    <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[7px] border-l-gray-500" />
  </div>
);

interface FlowNodeProps {
  role: string;
  loop: LoopState;
  /** Instance counts per stageId — used to decide whether to append an instance number to the label. */
  stageCounts: Map<string, number>;
  isSelected: boolean;
  isActive: boolean;
  isRunning: boolean;
  onClick: () => void;
  /** Optional: called when user clicks the restart button. */
  onRestart?: () => void;
}

const FlowNode: React.FC<FlowNodeProps> = ({
  role,
  loop,
  stageCounts,
  isSelected,
  isActive,
  isRunning,
  onClick,
  onRestart,
}) => {
  const stageId = stageIdFromRole(role);
  const instanceIndex = instanceIndexFromRole(role);
  const baseLabel = stageId;
  // Only append an instance number when multiple containers share the same stage.
  const hasMultipleInstances = (stageCounts.get(stageId) ?? 0) > 1;
  const label =
    instanceIndex !== null && hasMultipleInstances
      ? `${baseLabel} ${instanceIndex + 1}`
      : baseLabel;
  const { borderColor, statusLabel, statusColor } = getStatusStyles(loop.status);

  return (
    <button
      onClick={onClick}
      className={`
        relative flex flex-col items-center min-w-[120px] px-4 py-3 rounded-lg border-2 transition-all
        cursor-pointer hover:scale-105 flex-shrink-0
        ${borderColor}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900' : ''}
        bg-gray-800
      `}
    >
      {/* Activity pulse indicator */}
      <div className="absolute -top-1.5 -right-1.5">
        {isRunning && (
          <span className="relative flex h-3.5 w-3.5">
            {isActive && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex rounded-full h-3.5 w-3.5 ${
                isActive ? 'bg-green-500' : 'bg-yellow-500'
              }`}
            />
          </span>
        )}
        {loop.status === LoopStatus.FAILED && (
          <span className="relative flex h-3.5 w-3.5">
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-red-500" />
          </span>
        )}
      </div>

      {/* Role label */}
      <span className="text-xs font-semibold text-white mb-1.5">{label}</span>

      {/* Status badge */}
      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${statusColor}`}>
        {statusLabel}
      </span>

      {/* Stats row */}
      <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400">
        <span title="Iteration">
          iter {loop.iteration}
        </span>
        {loop.commits.length > 0 && (
          <span title="Commits" className="text-green-400">
            {loop.commits.length} commit{loop.commits.length !== 1 ? 's' : ''}
          </span>
        )}
        {loop.errors > 0 && (
          <span title="Errors" className="text-red-400">
            {loop.errors} err
          </span>
        )}
      </div>

      {/* Restart button — only shown when a restart callback is provided */}
      {onRestart && (
        <button
          title="Restart container"
          onClick={(e) => {
            e.stopPropagation();
            onRestart();
          }}
          className="mt-2 px-2 py-0.5 rounded text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
        >
          ↺ restart
        </button>
      )}
    </button>
  );
};

/* ── Helpers ────────────────────────────────────────────────────────────────── */

function getStatusStyles(status: LoopStatus): {
  borderColor: string;
  statusLabel: string;
  statusColor: string;
} {
  switch (status) {
    case LoopStatus.RUNNING:
      return {
        borderColor: 'border-green-600',
        statusLabel: 'Running',
        statusColor: 'bg-green-900 text-green-300',
      };
    case LoopStatus.STARTING:
      return {
        borderColor: 'border-blue-600',
        statusLabel: 'Starting',
        statusColor: 'bg-blue-900 text-blue-300',
      };
    case LoopStatus.PAUSED:
      return {
        borderColor: 'border-yellow-600',
        statusLabel: 'Paused',
        statusColor: 'bg-yellow-900 text-yellow-300',
      };
    case LoopStatus.STOPPING:
      return {
        borderColor: 'border-yellow-600',
        statusLabel: 'Stopping',
        statusColor: 'bg-yellow-900 text-yellow-300',
      };
    case LoopStatus.FAILED:
      return {
        borderColor: 'border-red-600',
        statusLabel: 'Failed',
        statusColor: 'bg-red-900 text-red-300',
      };
    case LoopStatus.COMPLETED:
      return {
        borderColor: 'border-gray-600',
        statusLabel: 'Completed',
        statusColor: 'bg-gray-700 text-gray-300',
      };
    case LoopStatus.STOPPED:
      return {
        borderColor: 'border-gray-600',
        statusLabel: 'Stopped',
        statusColor: 'bg-gray-700 text-gray-300',
      };
    default:
      return {
        borderColor: 'border-gray-600',
        statusLabel: 'Idle',
        statusColor: 'bg-gray-700 text-gray-300',
      };
  }
}
