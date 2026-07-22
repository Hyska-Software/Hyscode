import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const THICKNESS = 4;
const TITLEBAR_HEIGHT = 40;

interface HandleSpec {
  edge: Edge;
  className: string;
  style: React.CSSProperties;
}

const HANDLES: HandleSpec[] = [
  // Top/bottom edges (excluding corners and titlebar area)
  {
    edge: 'n',
    className: 'cursor-ns-resize',
    style: { top: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS },
  },
  {
    edge: 's',
    className: 'cursor-ns-resize',
    style: { bottom: 0, left: THICKNESS, right: THICKNESS, height: THICKNESS },
  },
  // Side edges (excluding the titlebar height so drag/controls are not blocked)
  {
    edge: 'e',
    className: 'cursor-ew-resize',
    style: { top: TITLEBAR_HEIGHT, bottom: THICKNESS, right: 0, width: THICKNESS },
  },
  {
    edge: 'w',
    className: 'cursor-ew-resize',
    style: { top: TITLEBAR_HEIGHT, bottom: THICKNESS, left: 0, width: THICKNESS },
  },
  // Corners
  { edge: 'ne', className: 'cursor-nesw-resize', style: { top: 0, right: 0, width: THICKNESS, height: THICKNESS } },
  { edge: 'nw', className: 'cursor-nwse-resize', style: { top: 0, left: 0, width: THICKNESS, height: THICKNESS } },
  { edge: 'se', className: 'cursor-nwse-resize', style: { bottom: 0, right: 0, width: THICKNESS, height: THICKNESS } },
  { edge: 'sw', className: 'cursor-nesw-resize', style: { bottom: 0, left: 0, width: THICKNESS, height: THICKNESS } },
];

/**
 * Edge/corner hit zones that restore native window resizing after
 * `decorations: false` removes the OS border. Each zone calls the Rust
 * `start_resize` command on mousedown.
 *
 * Handles are rendered as individual fixed elements (no full-screen wrapper)
 * so they cannot accidentally block clicks/drags on the title bar or content.
 */
export function WindowResizeHandles() {
  const handleMouseDown = useCallback((edge: Edge) => {
    invoke('start_resize', { edge }).catch((err) => {
      console.error('start_resize failed:', err);
    });
  }, []);

  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.edge}
          aria-hidden
          className={`fixed z-40 ${h.className}`}
          style={h.style}
          onMouseDown={() => handleMouseDown(h.edge)}
        />
      ))}
    </>
  );
}
