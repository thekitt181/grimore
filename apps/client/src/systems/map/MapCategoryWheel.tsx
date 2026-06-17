import { useEffect, useRef } from 'react';

export type ImageCategory = 'map' | 'character' | 'item' | 'prop' | 'other';

interface Segment {
  id: ImageCategory;
  label: string;
  icon: string;
  color: string;
  hoverColor: string;
}

const SEGMENTS: Segment[] = [
  { id: 'map',       label: 'Map',       icon: '🗺️', color: '#1a2a1a', hoverColor: '#2a4a2a' },
  { id: 'character', label: 'Character', icon: '🧙', color: '#1a1a2a', hoverColor: '#2a2a4a' },
  { id: 'item',      label: 'Item',      icon: '⚔️', color: '#2a1a1a', hoverColor: '#4a2a2a' },
  { id: 'prop',      label: 'Prop',      icon: '🪑', color: '#1a221a', hoverColor: '#2a3a2a' },
  { id: 'other',     label: 'Image',     icon: '🖼️', color: '#22221a', hoverColor: '#3a3a2a' },
];

const OUTER_R = 110;
const INNER_R = 36;
const COUNT = SEGMENTS.length;

/** Returns SVG arc path for a pie segment */
function segmentPath(index: number, total: number, innerR: number, outerR: number): string {
  const startAngle = (index / total) * 2 * Math.PI - Math.PI / 2;
  const endAngle = ((index + 1) / total) * 2 * Math.PI - Math.PI / 2;
  const gap = 0.04; // radians gap between segments

  const sa = startAngle + gap;
  const ea = endAngle - gap;

  const x1 = Math.cos(sa) * outerR;
  const y1 = Math.sin(sa) * outerR;
  const x2 = Math.cos(ea) * outerR;
  const y2 = Math.sin(ea) * outerR;
  const x3 = Math.cos(ea) * innerR;
  const y3 = Math.sin(ea) * innerR;
  const x4 = Math.cos(sa) * innerR;
  const y4 = Math.sin(sa) * innerR;

  const largeArc = ea - sa > Math.PI ? 1 : 0;

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

/** Midpoint angle for icon placement */
function midAngle(index: number, total: number): number {
  return ((index + 0.5) / total) * 2 * Math.PI - Math.PI / 2;
}

interface Props {
  /** Screen-space position where the wheel should appear */
  x: number;
  y: number;
  onSelect: (category: ImageCategory) => void;
  onDismiss: () => void;
}

export function MapCategoryWheel({ x, y, onSelect, onDismiss }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onDismiss]);

  const size = (OUTER_R + 16) * 2;
  const cx = size / 2;
  const cy = size / 2;

  // Clamp so wheel stays on screen
  const padding = OUTER_R + 20;
  const clampedX = Math.max(padding, Math.min(x, window.innerWidth - padding));
  const clampedY = Math.max(padding, Math.min(y, window.innerHeight - padding));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          left: clampedX - size / 2,
          top: clampedY - size / 2,
          width: size,
          height: size,
          pointerEvents: 'all',
        }}
      >
        <svg width={size} height={size} style={{ overflow: 'visible' }}>
          {SEGMENTS.map((seg, i) => {
            const path = segmentPath(i, COUNT, INNER_R, OUTER_R);
            const angle = midAngle(i, COUNT);
            const iconR = (INNER_R + OUTER_R) / 2;
            const iconX = cx + Math.cos(angle) * iconR;
            const iconY = cy + Math.sin(angle) * iconR;

            return (
              <g
                key={seg.id}
                transform={`translate(${cx}, ${cy})`}
                style={{ cursor: 'pointer' }}
                onClick={() => onSelect(seg.id)}
              >
                {/* Segment shape */}
                <path
                  d={path}
                  fill={seg.color}
                  stroke="#c9a84c"
                  strokeWidth={1.5}
                  style={{ transition: 'fill 0.15s' }}
                  onMouseEnter={(e) => ((e.currentTarget as SVGPathElement).style.fill = seg.hoverColor)}
                  onMouseLeave={(e) => ((e.currentTarget as SVGPathElement).style.fill = seg.color)}
                />
                {/* Icon — rendered in foreignObject so emoji display correctly */}
                <text
                  x={iconX - cx}
                  y={iconY - cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={22}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {seg.icon}
                </text>
                {/* Label */}
                <text
                  x={iconX - cx}
                  y={iconY - cy + 18}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={9}
                  fill="#c9a84c"
                  fontFamily="Inter, sans-serif"
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {seg.label}
                </text>
              </g>
            );
          })}

          {/* Centre cancel button */}
          <circle
            cx={cx}
            cy={cy}
            r={INNER_R - 2}
            fill="#0a0a0f"
            stroke="#c9a84c"
            strokeWidth={1.5}
            style={{ cursor: 'pointer' }}
            onClick={onDismiss}
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={16}
            fill="#8a8075"
            fontFamily="Inter, sans-serif"
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            ✕
          </text>
        </svg>

        {/* Hint label */}
        <p
          style={{
            position: 'absolute',
            bottom: -28,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            color: '#8a8075',
            fontFamily: 'Inter, sans-serif',
            fontSize: 11,
          }}
        >
          Choose category or click ✕ to cancel
        </p>
      </div>
    </div>
  );
}
