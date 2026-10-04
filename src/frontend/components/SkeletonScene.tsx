type Point = readonly [number, number];

/** Front-view squat. Index 0 is the head center. Knees travel out, feet stay under the body. */
const SQUAT: readonly Point[] = [
  [0, -158],
  [0, -124],
  [-40, -112],
  [40, -112],
  [-56, -68],
  [56, -64],
  [-34, -36],
  [34, -32],
  [-22, 2],
  [22, 2],
  [-46, 72],
  [46, 76],
  [-34, 150],
  [36, 148],
];

const BONES: readonly (readonly [number, number])[] = [
  [2, 3],
  [2, 4],
  [4, 6],
  [3, 5],
  [5, 7],
  [8, 9],
  [8, 10],
  [10, 12],
  [9, 11],
  [11, 13],
];

interface FigureProps {
  origin: Point;
  color: string;
  scale?: number;
  opacity?: number;
}

/**
 * Draws one coaching skeleton: spine, limbs, head, hands and feet.
 * Coordinates are display only and are not pose measurements.
 */
function Figure({ origin, color, scale = 1, opacity = 1 }: FigureProps) {
  const at = (index: number): Point => {
    const [x, y] = SQUAT[index] ?? [0, 0];
    return [origin[0] + x * scale, origin[1] + y * scale];
  };
  const neck = at(1);
  const hip: Point = [(at(8)[0] + at(9)[0]) / 2, (at(8)[1] + at(9)[1]) / 2];
  const head = at(0);

  return (
    <g stroke={color} fill={color} opacity={opacity} strokeLinecap="round" strokeLinejoin="round">
      <line x1={neck[0]} y1={neck[1]} x2={hip[0]} y2={hip[1]} strokeWidth={7 * scale} />
      {BONES.map(([from, to]) => {
        const a = at(from);
        const b = at(to);
        return (
          <line
            key={`${from}-${to}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            strokeWidth={4.5 * scale}
          />
        );
      })}
      <circle cx={head[0]} cy={head[1]} r={18 * scale} fill="none" strokeWidth={3.5 * scale} />
      {[6, 7].map((index) => {
        const wrist = at(index);
        const reach = index === 6 ? -12 : 12;
        return (
          <line
            key={`hand-${index}`}
            x1={wrist[0]}
            y1={wrist[1]}
            x2={wrist[0] + reach * scale}
            y2={wrist[1] + 8 * scale}
            strokeWidth={3 * scale}
          />
        );
      })}
      {[12, 13].map((index) => {
        const ankle = at(index);
        const reach = index === 12 ? -14 : 14;
        return (
          <line
            key={`foot-${index}`}
            x1={ankle[0]}
            y1={ankle[1]}
            x2={ankle[0] + reach * scale}
            y2={ankle[1] + 4 * scale}
            strokeWidth={3.5 * scale}
          />
        );
      })}
      {SQUAT.map((_, index) => {
        if (index === 0) return null;
        const [x, y] = at(index);
        return <circle key={`joint-${index}`} cx={x} cy={y} r={index <= 3 || index >= 8 ? 4.2 * scale : 3.2 * scale} />;
      })}
    </g>
  );
}

/** Product still: the teacher demonstrates, then the learner matches the ghost. */
export function SkeletonScene() {
  return (
    <svg className="skeleton-scene" viewBox="0 0 720 430" role="img" aria-label="Teacher skeleton and student ghost coaching">
      <defs>
        <linearGradient id="scene-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#24342c" />
          <stop offset="100%" stopColor="#101614" />
        </linearGradient>
        <filter id="scene-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="720" height="430" fill="url(#scene-bg)" />
      <line x1="360" y1="36" x2="360" y2="360" stroke="rgba(232,240,234,0.12)" strokeWidth="1" />
      <ellipse cx="180" cy="352" rx="92" ry="14" fill="rgba(61,214,140,0.12)" />
      <ellipse cx="530" cy="352" rx="110" ry="16" fill="rgba(255,181,71,0.12)" />
      <g filter="url(#scene-glow)">
        <Figure origin={[180, 228]} color="#3dd68c" />
        <Figure origin={[500, 222]} color="#ffb547" scale={1.05} opacity={0.78} />
        <Figure origin={[552, 232]} color="#3dd68c" scale={0.94} />
      </g>
      <text x="180" y="392" textAnchor="middle" fill="#e8f0ea" fontSize="15" fontFamily="DM Sans, sans-serif">
        You teach
      </text>
      <text x="530" y="392" textAnchor="middle" fill="#e8f0ea" fontSize="15" fontFamily="DM Sans, sans-serif">
        They match your ghost
      </text>
    </svg>
  );
}
