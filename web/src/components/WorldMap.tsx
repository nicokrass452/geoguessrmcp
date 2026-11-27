import type { ReactNode } from 'react';

/** Equirectangular projection onto a 360 × 180 canvas. */
export function project(lon: number, lat: number): [number, number] {
  return [lon + 180, 90 - lat];
}

// Coarse continent outlines on the same 360 × 180 grid.
const LAND = [
  'M12 24 40 20 80 18 100 18 120 30 125 40 110 47 104 55 99 65 90 60 83 64 75 71 97 81 102 82 92 76 75 68 65 60 56 50 55 42 45 32 30 30 15 30Z',
  'M125 8 155 8 160 20 135 30 125 20Z',
  'M100 80 118 80 130 90 145 97 140 112 130 120 122 128 115 145 108 140 108 120 100 95Z',
  'M170 54 180 47 175 42 185 38 190 32 185 28 195 20 210 19 220 24 220 45 208 49 200 50 192 46 183 47Z',
  'M174 40 182 38 177 32 174 34Z',
  'M163 69 175 54 190 53 212 59 223 78 231 78 220 95 220 105 213 117 200 125 192 107 189 86 172 86 163 76Z',
  'M224 103 230 105 227 115 224 112Z',
  'M220 45 220 24 240 20 260 17 290 13 320 18 360 22 350 30 340 32 322 43 310 48 302 50 300 60 290 70 285 80 280 77 275 74 260 82 252 70 240 65 230 60 225 50Z',
  'M310 57 322 45 323 48 313 58Z',
  'M280 88 292 90 300 94 288 95Z M300 88 312 92 318 96 304 94Z',
  'M293 112 305 104 317 102 325 105 333 117 328 128 318 125 310 122 295 124Z',
  'M345 128 350 132 344 138 342 134Z',
];

const GRATICULE =
  'M0 30H360M0 60H360M0 90H360M0 120H360M0 150H360M30 0V180M60 0V180M90 0V180M120 0V180M150 0V180M180 0V180M210 0V180M240 0V180M270 0V180M300 0V180M330 0V180';

export interface WorldMapProps {
  /** SVG viewBox crop, defaults to the whole world. */
  viewBox?: string;
  className?: string;
  /** Extra SVG drawn on top, in the same 360 × 180 coordinates. */
  children?: ReactNode;
  /** Small dots, e.g. sample locations of a map mode. */
  dots?: Array<[number, number]>;
}

export function WorldMap({
  viewBox = '0 0 360 180',
  className = '',
  children,
  dots,
}: WorldMapProps) {
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      aria-hidden="true"
    >
      <rect x="-20" y="-20" width="400" height="220" fill="#0e1520" />
      <path
        d={GRATICULE}
        stroke="#eef0f5"
        strokeOpacity="0.05"
        strokeWidth="0.3"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <g
        fill="#1b2636"
        stroke="#2c3a4f"
        strokeWidth="0.6"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      >
        {LAND.map((d) => (
          <path key={d} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      {dots?.map(([lon, lat]) => {
        const [x, y] = project(lon, lat);
        return (
          <circle
            key={`${lon},${lat}`}
            cx={x}
            cy={y}
            r="2.2"
            fill="#ff7a2f"
            stroke="#0e1520"
            strokeWidth="0.8"
          />
        );
      })}
      {children}
    </svg>
  );
}
