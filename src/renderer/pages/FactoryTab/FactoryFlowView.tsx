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

/**
 * Approximate height of a FlowNode in pixels. Used by StageConnector to
 * compute SVG path y-coordinates for fan-out / fan-in arrows. Should be
 * kept in sync with the actual rendered height of the FlowNode button.
 */
const NODE_HEIGHT = 104;

/** Vertical gap between stacked nodes in a multi-instance stage (gap-2 = 8px). */
const NODE_GAP = 8;

/** Width of the SVG connector drawn between two stage columns. */
const CONNECTOR_WIDTH = 32;

/** Extract the stage id from a composite role key (e.g. "coder-0" → "coder", "coder" → "coder"). */
export function stageIdFromRole(role: string): string {
  return role.replace(/-\d+$/, '');
}

/** Extract instance index from composite role key (e.g. "coder-0" → 0, "coder" → null). */
export function instanceIndexFromRole(role: string): number | null {
  const m = role.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Total pixel height of a stage column with `count` stacked nodes. */
function stageColHeight(count: number): number {
  return count * NODE_HEIGHT + (count - 1) * NODE_GAP;
}

/**
 * Y-center of each node in a stage column, expressed relative to a container
 * of height `containerH`. The column itself is centered within the container
 * (matching `items-center` on the outer flex row).
 */
function nodeYCenters(count: number, containerH: number): number[] {
  const colH = stageColHeight(count);
  const offset = (containerH - colH) / 2;
  return Array.from(
    { length: count },
    (_, i) => offset + i * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2,
  );
}

/**
 * Renders a horizontal pipeline diagram for a coding factory.
 *
 * Loops sharing the same stage id (e.g. "coder-0" and "coder-1") are grouped
 * into a single stage column and stacked vertically. Adjacent stage columns
 * are joined by directional arrows; when either side has multiple instances
 * the connector fans out or fans in with individual bezier curves so the flow
 * is unambiguous: pm → [coder 1, coder 2] → security.
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

  // Group loops by stageId, preserving first-appearance (pipeline spawn) order.
  const orderedStageIds: string[] = [];
  const stageInstanceMap = new Map<string, LoopState[]>();
  for (const loop of loops) {
    if (!loop.role) continue;
    const sid = stageIdFromRole(loop.role);
    if (!stageInstanceMap.has(sid)) {
      orderedStageIds.push(sid);
      stageInstanceMap.set(sid, []);
    }
    stageInstanceMap.get(sid)!.push(loop);
  }
  const orderedStages = orderedStageIds.map((sid) => ({
    stageId: sid,
    instances: stageInstanceMap.get(sid)!,
  }));

  if (orderedStages.length === 0) return null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {orderedStages.map((stage, idx) => (
          <React.Fragment key={stage.stageId}>
            {idx > 0 && (
              <StageConnector
                fromCount={orderedStages[idx - 1].instances.length}
                toCount={stage.instances.length}
              />
            )}
            <StageColumn
              stageId={stage.stageId}
              instances={stage.instances}
              selectedLoopKey={selectedLoopKey}
              onSelectLoop={onSelectLoop}
              onRestartLoop={onRestartLoop}
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

/* ── Sub-components ─────────────────────────────────────────────────────────── */

interface StageColumnProps {
  stageId: string;
  instances: LoopState[];
  selectedLoopKey: string | null;
  onSelectLoop: (loop: LoopState) => void;
  onRestartLoop?: (loop: LoopState) => void;
}

const StageColumn: React.FC<StageColumnProps> = ({
  stageId,
  instances,
  selectedLoopKey,
  onSelectLoop,
  onRestartLoop,
}) => (
  <div className="flex flex-col gap-2 flex-shrink-0">
    {instances.map((loop) => {
      const instanceIndex = instanceIndexFromRole(loop.role ?? '');
      const isActive = loop.lastLogAt != null && Date.now() - loop.lastLogAt < ACTIVE_THRESHOLD_MS;
      const isRunning =
        loop.status === LoopStatus.RUNNING || loop.status === LoopStatus.STARTING;
      return (
        <FlowNode
          key={loop.role ?? stageId}
          role={loop.role ?? stageId}
          loop={loop}
          showInstanceNumber={instances.length > 1 && instanceIndex !== null}
          isSelected={getLoopKey(loop) === selectedLoopKey}
          isActive={isActive}
          isRunning={isRunning}
          onClick={() => onSelectLoop(loop)}
          onRestart={onRestartLoop ? () => onRestartLoop(loop) : undefined}
        />
      );
    })}
  </div>
);

/**
 * Connector drawn between two adjacent stage columns.
 *
 * 1→1: simple CSS arrow (same as before).
 * 1→N, N→1, N→M: SVG bezier curves — one path per (fromNode, toNode) pair —
 * so every instance on the left has a visible line to every instance on the
 * right. The SVG height is sized to the taller of the two columns so the
 * y-coordinates computed by `nodeYCenters` align with the rendered nodes.
 */
const StageConnector: React.FC<{ fromCount: number; toCount: number }> = ({
  fromCount,
  toCount,
}) => {
  if (fromCount === 1 && toCount === 1) {
    return <Arrow />;
  }

  const containerH = Math.max(stageColHeight(fromCount), stageColHeight(toCount));
  const fromYs = nodeYCenters(fromCount, containerH);
  const toYs = nodeYCenters(toCount, containerH);
  const midX = CONNECTOR_WIDTH / 2;

  return (
    <svg
      width={CONNECTOR_WIDTH}
      height={containerH}
      className="flex-shrink-0"
    >
      <defs>
        <marker
          id="flow-arrowhead"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M 0 0 L 6 3 L 0 6 z" fill="#6b7280" />
        </marker>
      </defs>
      {fromYs.flatMap((fy, fi) =>
        toYs.map((ty, ti) => (
          <path
            key={`${fi}-${ti}`}
            d={`M 0 ${fy} C ${midX} ${fy} ${midX} ${ty} ${CONNECTOR_WIDTH} ${ty}`}
            fill="none"
            stroke="#6b7280"
            strokeWidth="1.5"
            markerEnd="url(#flow-arrowhead)"
          />
        )),
      )}
    </svg>
  );
};

const Arrow: React.FC = () => (
  <div className="flex items-center flex-shrink-0 px-1">
    <div className="w-6 h-px bg-gray-500" />
    <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[7px] border-l-gray-500" />
  </div>
);

interface FlowNodeProps {
  role: string;
  loop: LoopState;
  /** True when this node's stage has multiple instances — appends an instance number to the label. */
  showInstanceNumber: boolean;
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
  showInstanceNumber,
  isSelected,
  isActive,
  isRunning,
  onClick,
  onRestart,
}) => {
  const stageId = stageIdFromRole(role);
  const instanceIndex = instanceIndexFromRole(role);
  const label =
    showInstanceNumber && instanceIndex !== null
      ? `${stageId} ${instanceIndex + 1}`
      : stageId;
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
