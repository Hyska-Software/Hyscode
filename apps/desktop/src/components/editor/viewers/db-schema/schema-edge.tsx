import { memo, useMemo } from 'react';
import {
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';

export interface SchemaEdgeData extends Record<string, unknown> {
  label?: string;
  cardinality?: string;
}

export const SchemaEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    data,
    selected,
  } = props;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
    borderRadius: 8,
  });

  const edgeData = data as SchemaEdgeData | undefined;
  const label = edgeData?.label ?? '';
  const cardinality = edgeData?.cardinality ?? '1-N';

  const markerId = useMemo(() => `arrow-${id.replace(/[^a-zA-Z0-9]/g, '-')}`, [id]);

  // Theme-aware colors via CSS custom properties (reacts to light/dark mode)
  const strokeColor = selected
    ? 'var(--primary)'
    : 'color-mix(in oklch, var(--foreground) 50%, transparent)';
  const strokeWidth = selected ? 3 : 2;

  return (
    <>
      <defs>
        <marker
          id={markerId}
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto-start-reverse"
        >
          <path
            d="M0,0 L12,6 L0,12 L3,6 Z"
            style={{ fill: strokeColor, transition: 'fill 150ms ease' }}
          />
        </marker>
      </defs>
      <path
        d={edgePath}
        fill="none"
        style={{
          stroke: strokeColor,
          strokeWidth,
          transition: 'stroke 150ms ease, stroke-width 150ms ease',
        }}
        markerEnd={`url(#${markerId})`}
        strokeDasharray={cardinality === 'N-M' ? '6,4' : undefined}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="rounded-md border border-border/50 bg-card px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-sm"
        >
          {cardinality}
        </div>
      </EdgeLabelRenderer>
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${(sourceX + labelX) / 2}px, ${(sourceY + labelY) / 2}px)`,
              pointerEvents: 'none',
            }}
            className="rounded-sm bg-background/80 px-1 text-[9px] text-muted-foreground"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

SchemaEdge.displayName = 'SchemaEdge';
