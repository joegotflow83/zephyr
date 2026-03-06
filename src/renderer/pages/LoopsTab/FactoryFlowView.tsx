import React, { useEffect, useState } from 'react';
import type { LoopState } from '../../../shared/loop-types';
import { LoopStatus, getLoopKey } from '../../../shared/loop-types';
import type { FactoryRole } from '../../../shared/models';
import { FACTORY_ROLES, FACTORY_ROLE_LABELS } from '../../../shared/models';

interface FactoryFlowViewProps {
  /** All loops belonging to this factory project */
  loops: LoopState[];
  /** Currently selected loop key */
  selectedLoopKey: string | null;
  /** Called when user clicks a node to select that agent's logs */
  onSelectLoop: (loop: LoopState) => void;
}

/** How recently (ms) a log line must have arrived to consider the agent "active" */
const ACTIVE_THRESHOLD_MS = 5000;

/** Tick interval for re-evaluating activity pulse */
const TICK_MS = 1000;

/**
 * Renders a horizontal pipeline diagram for a coding factory.
 * Each agent role is a node showing status, activity pulse, iteration, and commit count.
 * Nodes are connected by directional arrows following the FACTORY_ROLES pipeline order.
 */
export const FactoryFlowView: React.FC<FactoryFlowViewProps> = ({
  loops,
  selectedLoopKey,
  onSelectLoop,
}) => {
  // Force re-render every TICK_MS so the activity pulse stays up-to-date
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Build a map from role → loop for quick lookup
  const loopByRole = new Map<string, LoopState>();
  for (const loop of loops) {
    if (loop.role) {
      loopByRole.set(loop.role, loop);
    }
  }

  // Order nodes by the canonical pipeline order, filtering to roles that actually have loops
  const orderedRoles = FACTORY_ROLES.filter((r) => loopByRole.has(r));

  // Also include any non-standard roles that aren't in FACTORY_ROLES
  for (const loop of loops) {
    if (loop.role && !orderedRoles.includes(loop.role as FactoryRole)) {
      orderedRoles.push(loop.role as FactoryRole);
    }
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
                isSelected={isSelected}
                isActive={isActive}
                isRunning={isRunning}
                onClick={() => onSelectLoop(loop)}
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
  isSelected: boolean;
  isActive: boolean;
  isRunning: boolean;
  onClick: () => void;
}

const FlowNode: React.FC<FlowNodeProps> = ({
  role,
  loop,
  isSelected,
  isActive,
  isRunning,
  onClick,
}) => {
  const label = FACTORY_ROLE_LABELS[role as FactoryRole] ?? role;
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
