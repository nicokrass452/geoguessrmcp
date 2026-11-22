import { angularDifference, normalizeHeading } from '@geoguessr-mcp/shared';
import type { CatalogLocation, CatalogNodeSpec } from './catalog.js';
import { PixelCanvas, lerpColor, rgb, type Rgba } from './bitmapFont.js';

export const EQUIRECT_WIDTH = 2048;
export const EQUIRECT_HEIGHT = 1024;

function azToX(deg: number, width = EQUIRECT_WIDTH): number {
  return (normalizeHeading(deg) / 360) * width;
}

function elevToY(deg: number, height = EQUIRECT_HEIGHT): number {
  const clamped = Math.max(-89, Math.min(89, deg));
  return (0.5 - clamped / 180) * height;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isMountainEnvironment(location: CatalogLocation): boolean {
  return (
    location.categories.includes('mountain') &&
    !location.categories.includes('big_city')
  );
}

function drawSunAndClouds(
  canvas: PixelCanvas,
  location: CatalogLocation,
  rand: () => number
): void {
  const horizonY = EQUIRECT_HEIGHT / 2;

  // Sky gradient
  canvas.fillGradientRect(
    0,
    0,
    EQUIRECT_WIDTH,
    horizonY,
    location.skyTop,
    location.skyHorizon
  );

  // Sun halo and disc
  const sunX = azToX(location.sunAzimuthDeg);
  const sunY = elevToY(location.sunElevationDeg);
  canvas.fillCircle(sunX, sunY, 90, rgb(255, 245, 200, 35));
  canvas.fillCircle(sunX, sunY, 54, rgb(255, 248, 214, 70));
  canvas.fillCircle(sunX, sunY, 26, rgb(255, 252, 232, 235));

  // Soft layered clouds
  for (let i = 0; i < 16; i++) {
    const cx = rand() * EQUIRECT_WIDTH;
    const cy = 110 + rand() * 230;
    const w = 65 + rand() * 90;
    const h = 14 + rand() * 14;
    const cloudC = rgb(255, 255, 255, 130);
    canvas.fillEllipse(cx, cy, w, h, cloudC);
    canvas.fillEllipse(cx - w * 0.35, cy + 5, w * 0.65, h * 0.85, cloudC);
    canvas.fillEllipse(cx + w * 0.35, cy + 4, w * 0.6, h * 0.8, cloudC);
  }
}

function drawLandmark(
  canvas: PixelCanvas,
  location: CatalogLocation,
  nodeIndex: number
): void {
  const cx = azToX(location.landmarkAzimuthDeg);
  const horizonY = EQUIRECT_HEIGHT / 2;
  const scale = 1 + nodeIndex * 0.08;

  switch (location.landmark) {
    case 'pyramids': {
      const p1W = 190 * scale;
      const p1H = 145 * scale;
      canvas.fillPolygon(
        [
          [cx - p1W / 2, horizonY],
          [cx, horizonY - p1H],
          [cx + p1W / 2, horizonY],
        ],
        rgb(206, 172, 118)
      );
      canvas.fillPolygon(
        [
          [cx, horizonY - p1H],
          [cx + p1W / 2, horizonY],
          [cx + 18, horizonY],
        ],
        rgb(168, 136, 86)
      );
      const cx2 = cx + 140;
      canvas.fillPolygon(
        [
          [cx2 - 75, horizonY],
          [cx2, horizonY - 105 * scale],
          [cx2 + 75, horizonY],
        ],
        rgb(196, 162, 112)
      );
      break;
    }
    case 'big_ben': {
      const w = 44 * scale;
      const h = 220 * scale;
      canvas.fillRect(cx - w / 2, horizonY - h, w, h, rgb(186, 166, 132));
      canvas.fillPolygon(
        [
          [cx - w * 0.6, horizonY - h],
          [cx, horizonY - h - 65 * scale],
          [cx + w * 0.6, horizonY - h],
        ],
        rgb(52, 64, 78)
      );
      // Clock face
      canvas.fillCircle(cx, horizonY - h + 38 * scale, 15 * scale, rgb(252, 245, 224));
      canvas.strokeRect(
        cx - 12 * scale,
        horizonY - h + 26 * scale,
        24 * scale,
        24 * scale,
        2,
        rgb(146, 110, 48)
      );
      break;
    }
    case 'golden_gate': {
      // Bay water strip on north-west horizon
      canvas.fillRect(cx - 280, horizonY - 12, 560, 22, rgb(38, 98, 156));
      const intlOrange = rgb(194, 65, 32);
      const t1 = cx - 95;
      const t2 = cx + 95;
      const th = 165 * scale;
      // Deck
      canvas.fillRect(cx - 210, horizonY - 48, 420, 8, intlOrange);
      // Two towers
      canvas.fillRect(t1 - 6, horizonY - th, 12, th, intlOrange);
      canvas.fillRect(t2 - 6, horizonY - th, 12, th, intlOrange);
      // Suspension cables
      canvas.drawLine(cx - 205, horizonY - 48, t1, horizonY - th, 3, intlOrange);
      canvas.drawLine(t1, horizonY - th, cx, horizonY - 52, 3, intlOrange);
      canvas.drawLine(cx, horizonY - 52, t2, horizonY - th, 3, intlOrange);
      canvas.drawLine(t2, horizonY - th, cx + 205, horizonY - 48, 3, intlOrange);
      break;
    }
    case 'opera_house': {
      canvas.fillRect(cx - 280, horizonY - 10, 560, 20, rgb(28, 108, 178));
      const shell = rgb(246, 242, 232);
      const shade = rgb(214, 212, 204);
      for (let i = -2; i <= 2; i++) {
        const sx = cx + i * 36;
        const sh = (88 - Math.abs(i) * 14) * scale;
        canvas.fillPolygon(
          [
            [sx - 28, horizonY],
            [sx - 4, horizonY - sh],
            [sx + 26, horizonY],
          ],
          i % 2 === 0 ? shell : shade
        );
      }
      break;
    }
    case 'table_mountain': {
      canvas.fillPolygon(
        [
          [cx - 260, horizonY],
          [cx - 165, horizonY - 125 * scale],
          [cx + 165, horizonY - 125 * scale],
          [cx + 255, horizonY],
        ],
        rgb(86, 98, 114)
      );
      // Tablecloth cloud strip
      canvas.fillEllipse(cx, horizonY - 125 * scale, 155, 14, rgb(248, 250, 252, 190));
      break;
    }
    case 'sacre_coeur': {
      const w = 130 * scale;
      canvas.fillRect(cx - w / 2, horizonY - 110 * scale, w, 110 * scale, rgb(242, 239, 232));
      canvas.fillEllipse(cx, horizonY - 125 * scale, 28 * scale, 48 * scale, rgb(248, 246, 242));
      canvas.fillEllipse(cx - 38 * scale, horizonY - 105 * scale, 18 * scale, 32 * scale, rgb(238, 235, 228));
      canvas.fillEllipse(cx + 38 * scale, horizonY - 105 * scale, 18 * scale, 32 * scale, rgb(238, 235, 228));
      break;
    }
    case 'hallgrimskirkja': {
      const concrete = rgb(218, 222, 228);
      for (let step = 4; step >= 0; step--) {
        const sw = 18 + step * 20;
        const sh = (205 - step * 28) * scale;
        canvas.fillRect(cx - sw / 2, horizonY - sh, sw, sh, concrete);
      }
      canvas.fillPolygon(
        [
          [cx - 12, horizonY - 205 * scale],
          [cx, horizonY - 245 * scale],
          [cx + 12, horizonY - 205 * scale],
        ],
        rgb(194, 200, 210)
      );
      break;
    }
    case 'alpine_waterfall': {
      // Towering cliff wall + Staubbach white waterfall ribbon
      canvas.fillPolygon(
        [
          [cx - 340 * scale, horizonY],
          [cx - 240 * scale, horizonY - 240 * scale],
          [cx + 240 * scale, horizonY - 230 * scale],
          [cx + 340 * scale, horizonY],
        ],
        rgb(78, 86, 98)
      );
      canvas.fillPolygon(
        [
          [cx - 160 * scale, horizonY - 220 * scale],
          [cx - 80 * scale, horizonY - 285 * scale],
          [cx + 15 * scale, horizonY - 230 * scale],
        ],
        rgb(245, 250, 255)
      );
      // Waterfall cascade
      const cascadeW = Math.max(10, Math.round(16 * scale));
      const cascadeH = Math.round(210 * scale);
      canvas.fillRect(
        cx - cascadeW / 2,
        horizonY - cascadeH,
        cascadeW,
        cascadeH,
        rgb(232, 246, 255, 220)
      );
      canvas.fillEllipse(
        cx,
        horizonY - 8,
        42 * scale,
        16 * scale,
        rgb(240, 248, 255, 175)
      );
      break;
    }
    case 'alpine_peak': {
      // Flanking lower alpine shoulders
      canvas.fillPolygon(
        [
          [cx - 310 * scale, horizonY],
          [cx - 165 * scale, horizonY - 135 * scale],
          [cx - 40 * scale, horizonY],
        ],
        rgb(76, 88, 106)
      );
      canvas.fillPolygon(
        [
          [cx + 30 * scale, horizonY],
          [cx + 175 * scale, horizonY - 145 * scale],
          [cx + 315 * scale, horizonY],
        ],
        rgb(64, 74, 92)
      );
      // Main pyramidal horn (sunlit west face + shadowed east face)
      canvas.fillPolygon(
        [
          [cx - 195 * scale, horizonY],
          [cx - 12 * scale, horizonY - 275 * scale],
          [cx + 18 * scale, horizonY],
        ],
        rgb(112, 124, 142)
      );
      canvas.fillPolygon(
        [
          [cx - 12 * scale, horizonY - 275 * scale],
          [cx + 190 * scale, horizonY],
          [cx + 10 * scale, horizonY],
        ],
        rgb(58, 68, 86)
      );
      // Sunlit summit snow ridge + shaded snow couloir
      canvas.fillPolygon(
        [
          [cx - 98 * scale, horizonY - 138 * scale],
          [cx - 12 * scale, horizonY - 275 * scale],
          [cx + 4 * scale, horizonY - 150 * scale],
        ],
        rgb(244, 249, 255)
      );
      canvas.fillPolygon(
        [
          [cx - 12 * scale, horizonY - 275 * scale],
          [cx + 68 * scale, horizonY - 165 * scale],
          [cx + 12 * scale, horizonY - 160 * scale],
        ],
        rgb(206, 222, 240)
      );
      break;
    }
    case 'glacial_fjord': {
      // Deep blue-slate fjord water strip near horizon
      canvas.fillRect(
        cx - 340 * scale,
        horizonY - 14,
        680 * scale,
        26,
        rgb(26, 76, 122)
      );
      // Distant headwall ridge
      canvas.fillPolygon(
        [
          [cx - 210 * scale, horizonY],
          [cx - 40 * scale, horizonY - 155 * scale],
          [cx + 55 * scale, horizonY - 148 * scale],
          [cx + 210 * scale, horizonY],
        ],
        rgb(68, 82, 98)
      );
      // Steep twin dark U-valley cliff walls
      canvas.fillPolygon(
        [
          [cx - 340 * scale, horizonY],
          [cx - 295 * scale, horizonY - 245 * scale],
          [cx - 135 * scale, horizonY - 210 * scale],
          [cx - 65 * scale, horizonY],
        ],
        rgb(52, 62, 76)
      );
      canvas.fillPolygon(
        [
          [cx + 65 * scale, horizonY],
          [cx + 140 * scale, horizonY - 220 * scale],
          [cx + 305 * scale, horizonY - 255 * scale],
          [cx + 340 * scale, horizonY],
        ],
        rgb(44, 54, 68)
      );
      // Hanging glacier snowfield + thin waterfall threads
      canvas.fillPolygon(
        [
          [cx - 115 * scale, horizonY - 130 * scale],
          [cx - 45 * scale, horizonY - 165 * scale],
          [cx + 50 * scale, horizonY - 158 * scale],
          [cx + 95 * scale, horizonY - 122 * scale],
        ],
        rgb(236, 246, 255)
      );
      canvas.fillRect(
        cx - 168 * scale,
        horizonY - 185 * scale,
        5,
        175 * scale,
        rgb(228, 244, 255, 200)
      );
      canvas.fillRect(
        cx + 158 * scale,
        horizonY - 195 * scale,
        4,
        185 * scale,
        rgb(228, 244, 255, 190)
      );
      break;
    }
    case 'snow_volcano': {
      // Foreground lake strip
      canvas.fillRect(
        cx - 320 * scale,
        horizonY - 10,
        640 * scale,
        20,
        rgb(34, 92, 148)
      );
      // Symmetrical stratovolcano cone with concave flanks
      canvas.fillPolygon(
        [
          [cx - 310 * scale, horizonY],
          [cx - 155 * scale, horizonY - 120 * scale],
          [cx - 48 * scale, horizonY - 235 * scale],
          [cx + 48 * scale, horizonY - 235 * scale],
          [cx + 155 * scale, horizonY - 120 * scale],
          [cx + 310 * scale, horizonY],
        ],
        rgb(72, 82, 108)
      );
      // Jagged summit snowcap
      canvas.fillPolygon(
        [
          [cx - 112 * scale, horizonY - 162 * scale],
          [cx - 48 * scale, horizonY - 235 * scale],
          [cx + 48 * scale, horizonY - 235 * scale],
          [cx + 112 * scale, horizonY - 162 * scale],
          [cx + 62 * scale, horizonY - 142 * scale],
          [cx + 22 * scale, horizonY - 168 * scale],
          [cx - 18 * scale, horizonY - 138 * scale],
          [cx - 64 * scale, horizonY - 164 * scale],
        ],
        rgb(246, 250, 255)
      );
      break;
    }
    case 'granite_spire': {
      // Glacial tarn strip
      canvas.fillRect(
        cx - 280 * scale,
        horizonY - 10,
        560 * scale,
        18,
        rgb(48, 132, 168)
      );
      // Flanking granite needles + central Fitz Roy monolith
      canvas.fillPolygon(
        [
          [cx - 220 * scale, horizonY],
          [cx - 135 * scale, horizonY - 205 * scale],
          [cx - 70 * scale, horizonY],
        ],
        rgb(138, 128, 132)
      );
      canvas.fillPolygon(
        [
          [cx - 110 * scale, horizonY],
          [cx - 42 * scale, horizonY - 270 * scale],
          [cx - 8 * scale, horizonY - 290 * scale],
          [cx + 24 * scale, horizonY - 255 * scale],
          [cx + 85 * scale, horizonY],
        ],
        rgb(164, 148, 148)
      );
      canvas.fillPolygon(
        [
          [cx + 40 * scale, horizonY],
          [cx + 130 * scale, horizonY - 225 * scale],
          [cx + 225 * scale, horizonY],
        ],
        rgb(122, 114, 120)
      );
      // Glacial snow apron at base
      canvas.fillPolygon(
        [
          [cx - 165 * scale, horizonY],
          [cx - 80 * scale, horizonY - 95 * scale],
          [cx + 10 * scale, horizonY - 82 * scale],
          [cx + 105 * scale, horizonY - 98 * scale],
          [cx + 175 * scale, horizonY],
        ],
        rgb(236, 244, 252)
      );
      break;
    }
    case 'dolomite_towers': {
      const paleStone = rgb(216, 198, 184);
      const warmStone = rgb(232, 212, 194);
      const shadeStone = rgb(174, 154, 144);
      canvas.fillPolygon(
        [
          [cx - 235 * scale, horizonY],
          [cx - 195 * scale, horizonY - 220 * scale],
          [cx - 135 * scale, horizonY - 235 * scale],
          [cx - 95 * scale, horizonY],
        ],
        paleStone
      );
      canvas.fillPolygon(
        [
          [cx - 115 * scale, horizonY],
          [cx - 75 * scale, horizonY - 265 * scale],
          [cx + 15 * scale, horizonY - 275 * scale],
          [cx + 68 * scale, horizonY - 230 * scale],
          [cx + 95 * scale, horizonY],
        ],
        warmStone
      );
      canvas.fillPolygon(
        [
          [cx + 15 * scale, horizonY - 275 * scale],
          [cx + 68 * scale, horizonY - 230 * scale],
          [cx + 95 * scale, horizonY],
          [cx + 18 * scale, horizonY],
        ],
        shadeStone
      );
      canvas.fillPolygon(
        [
          [cx + 85 * scale, horizonY],
          [cx + 138 * scale, horizonY - 210 * scale],
          [cx + 185 * scale, horizonY - 190 * scale],
          [cx + 235 * scale, horizonY],
        ],
        paleStone
      );
      // Scree talus fans at base
      canvas.fillPolygon(
        [
          [cx - 250 * scale, horizonY],
          [cx - 140 * scale, horizonY - 72 * scale],
          [cx, horizonY - 58 * scale],
          [cx + 140 * scale, horizonY - 74 * scale],
          [cx + 250 * scale, horizonY],
        ],
        rgb(162, 152, 142)
      );
      break;
    }
    case 'andean_valley': {
      // High snow-dusted cordillera backdrop
      canvas.fillPolygon(
        [
          [cx - 280 * scale, horizonY],
          [cx - 120 * scale, horizonY - 220 * scale],
          [cx + 15 * scale, horizonY - 255 * scale],
          [cx + 150 * scale, horizonY - 210 * scale],
          [cx + 290 * scale, horizonY],
        ],
        rgb(108, 118, 134)
      );
      canvas.fillPolygon(
        [
          [cx - 70 * scale, horizonY - 190 * scale],
          [cx + 15 * scale, horizonY - 255 * scale],
          [cx + 95 * scale, horizonY - 185 * scale],
          [cx + 15 * scale, horizonY - 168 * scale],
        ],
        rgb(242, 246, 252)
      );
      // Foreground ochre/terracotta terraced valley slopes
      canvas.fillPolygon(
        [
          [cx - 330 * scale, horizonY],
          [cx - 210 * scale, horizonY - 135 * scale],
          [cx - 65 * scale, horizonY - 78 * scale],
          [cx - 15 * scale, horizonY],
        ],
        rgb(156, 114, 76)
      );
      canvas.fillPolygon(
        [
          [cx + 15 * scale, horizonY],
          [cx + 85 * scale, horizonY - 88 * scale],
          [cx + 225 * scale, horizonY - 142 * scale],
          [cx + 335 * scale, horizonY],
        ],
        rgb(138, 98, 66)
      );
      break;
    }
    case 'mountain_pass': {
      // Distant divide peak seen through the saddle
      canvas.fillPolygon(
        [
          [cx - 180 * scale, horizonY],
          [cx, horizonY - 195 * scale],
          [cx + 180 * scale, horizonY],
        ],
        rgb(118, 128, 146)
      );
      canvas.fillPolygon(
        [
          [cx - 58 * scale, horizonY - 132 * scale],
          [cx, horizonY - 195 * scale],
          [cx + 58 * scale, horizonY - 132 * scale],
        ],
        rgb(244, 248, 255)
      );
      // V-notch pass ridges + snowdrift patches
      canvas.fillPolygon(
        [
          [cx - 340 * scale, horizonY],
          [cx - 265 * scale, horizonY - 190 * scale],
          [cx - 48 * scale, horizonY - 68 * scale],
          [cx + 10 * scale, horizonY],
        ],
        rgb(94, 96, 102)
      );
      canvas.fillPolygon(
        [
          [cx - 10 * scale, horizonY],
          [cx + 52 * scale, horizonY - 72 * scale],
          [cx + 275 * scale, horizonY - 200 * scale],
          [cx + 340 * scale, horizonY],
        ],
        rgb(82, 84, 92)
      );
      canvas.fillPolygon(
        [
          [cx - 210 * scale, horizonY - 140 * scale],
          [cx - 135 * scale, horizonY - 115 * scale],
          [cx - 160 * scale, horizonY - 92 * scale],
        ],
        rgb(242, 246, 252, 220)
      );
      canvas.fillPolygon(
        [
          [cx + 145 * scale, horizonY - 125 * scale],
          [cx + 225 * scale, horizonY - 155 * scale],
          [cx + 195 * scale, horizonY - 104 * scale],
        ],
        rgb(242, 246, 252, 220)
      );
      break;
    }
    case 'koutoubia': {
      const terra = rgb(186, 96, 68);
      const h = 195 * scale;
      canvas.fillRect(cx - 24, horizonY - h, 48, h, terra);
      canvas.fillRect(cx - 16, horizonY - h - 28, 32, 28, rgb(168, 82, 56));
      canvas.fillCircle(cx, horizonY - h - 38, 12, rgb(245, 198, 66));
      break;
    }
    case 'sugarloaf_bay': {
      canvas.fillRect(cx - 300, horizonY - 12, 600, 24, rgb(24, 118, 196));
      canvas.fillPolygon(
        [
          [cx - 95, horizonY],
          [cx - 35, horizonY - 150 * scale],
          [cx + 35, horizonY - 142 * scale],
          [cx + 98, horizonY],
        ],
        rgb(74, 96, 86)
      );
      break;
    }
    case 'times_square':
    case 'shibuya_towers': {
      const towerColor = rgb(44, 54, 72);
      canvas.fillRect(cx - 70, horizonY - 210 * scale, 56, 210 * scale, towerColor);
      canvas.fillRect(cx - 6, horizonY - 250 * scale, 68, 250 * scale, rgb(34, 42, 58));
      canvas.fillRect(cx + 68, horizonY - 180 * scale, 52, 180 * scale, towerColor);
      // Glowing billboard panels
      canvas.fillRect(cx + 2, horizonY - 155 * scale, 52, 42, location.accentColor);
      canvas.fillRect(cx - 62, horizonY - 135 * scale, 40, 32, rgb(56, 189, 248));
      break;
    }
    default: {
      const _exhaustive: never = location.landmark;
      return _exhaustive;
    }
  }
}

function isNearRoad(deg: number, roadBearings: number[], marginDeg: number): boolean {
  for (const rb of roadBearings) {
    if (Math.abs(angularDifference(deg, rb)) < marginDeg) {
      return true;
    }
  }
  return false;
}

function drawRoads(
  canvas: PixelCanvas,
  location: CatalogLocation,
  node: CatalogNodeSpec
): void {
  const horizonY = EQUIRECT_HEIGHT / 2;
  const mountainEnv = isMountainEnvironment(location);
  const vergeColor = mountainEnv
    ? lerpColor(location.groundColor, rgb(128, 122, 112), 0.52)
    : rgb(162, 166, 174);

  for (const bearing of node.roadBearings) {
    const cx = azToX(bearing);
    const topHalfW = 14;
    const botHalfW = 178;

    // Gravel/grass mountain verges or urban concrete sidewalks flanking the road
    canvas.fillPolygon(
      [
        [cx - topHalfW - 8, horizonY],
        [cx + topHalfW + 8, horizonY],
        [cx + botHalfW + 56, EQUIRECT_HEIGHT],
        [cx - botHalfW - 56, EQUIRECT_HEIGHT],
      ],
      vergeColor
    );

    // Asphalt road surface
    canvas.fillPolygon(
      [
        [cx - topHalfW, horizonY],
        [cx + topHalfW, horizonY],
        [cx + botHalfW, EQUIRECT_HEIGHT],
        [cx - botHalfW, EQUIRECT_HEIGHT],
      ],
      location.roadColor
    );

    // Dashed centerline
    for (let seg = 0; seg < 6; seg++) {
      const t0 = seg / 6 + 0.04;
      const t1 = Math.min(1, t0 + 0.09);
      const y0 = horizonY + t0 * (EQUIRECT_HEIGHT - horizonY);
      const y1 = horizonY + t1 * (EQUIRECT_HEIGHT - horizonY);
      const w0 = 2 + t0 * 5;
      const w1 = 2 + t1 * 5;
      canvas.fillPolygon(
        [
          [cx - w0, y0],
          [cx + w0, y0],
          [cx + w1, y1],
          [cx - w1, y1],
        ],
        location.roadLineColor
      );
    }

    if (mountainEnv) {
      // Roadside snow/guide marker bollards instead of urban zebra crosswalks
      for (const t of [0.18, 0.36]) {
        const my = horizonY + t * (EQUIRECT_HEIGHT - horizonY);
        const halfRoad = topHalfW + t * (botHalfW - topHalfW) + 12;
        for (const side of [-1, 1]) {
          const mx = cx + side * halfRoad;
          canvas.fillRect(mx - 2, my - 18, 4, 18, rgb(236, 240, 244));
          canvas.fillRect(mx - 2, my - 16, 4, 5, location.accentColor);
        }
      }
    } else {
      // Pedestrian crosswalk near intersection
      const cwY = horizonY + 110;
      for (let s = -4; s <= 4; s++) {
        canvas.fillRect(cx + s * 16 - 5, cwY, 9, 18, rgb(240, 242, 245, 200));
      }
    }

    // Driving-side indicator car on the road (helps deduction!)
    const laneOffset = location.drivingSide === 'left' ? -46 : 46;
    const carX = cx + laneOffset;
    const carY = horizonY + 95;
    const carBody =
      location.id === 'nyc-midtown'
        ? rgb(250, 204, 21)
        : location.id === 'london-westminster'
          ? rgb(204, 28, 36)
          : rgb(226, 232, 240);
    const carH = location.id === 'london-westminster' ? 42 : 24;
    canvas.fillRect(carX - 24, carY - carH, 48, carH, carBody);
    canvas.fillRect(carX - 18, carY - carH + 4, 36, 10, rgb(56, 189, 248, 200));
    canvas.fillCircle(carX - 15, carY, 6, rgb(24, 24, 27));
    canvas.fillCircle(carX + 15, carY, 6, rgb(24, 24, 27));
  }
}

function drawTree(
  canvas: PixelCanvas,
  location: CatalogLocation,
  tx: number,
  trunkY: number
): void {
  canvas.fillRect(tx - 3, trunkY - 46, 6, 46, rgb(104, 72, 48));
  if (location.vegetation === 'palm') {
    for (let a = -2; a <= 2; a++) {
      canvas.drawLine(
        tx,
        trunkY - 46,
        tx + a * 18,
        trunkY - 56 + Math.abs(a) * 6,
        4,
        rgb(34, 139, 64)
      );
    }
  } else if (location.vegetation === 'alpine') {
    // Distinct tiered alpine spruce silhouette
    canvas.fillPolygon(
      [
        [tx - 24, trunkY - 20],
        [tx, trunkY - 58],
        [tx + 24, trunkY - 20],
      ],
      rgb(24, 78, 48)
    );
    canvas.fillPolygon(
      [
        [tx - 19, trunkY - 40],
        [tx, trunkY - 76],
        [tx + 19, trunkY - 40],
      ],
      rgb(30, 92, 56)
    );
    canvas.fillPolygon(
      [
        [tx - 13, trunkY - 60],
        [tx, trunkY - 94],
        [tx + 13, trunkY - 60],
      ],
      rgb(36, 106, 66)
    );
  } else if (location.vegetation === 'pine') {
    canvas.fillPolygon(
      [
        [tx - 20, trunkY - 26],
        [tx, trunkY - 78],
        [tx + 20, trunkY - 26],
      ],
      rgb(28, 92, 54)
    );
  } else if (location.vegetation === 'desert') {
    canvas.fillEllipse(tx, trunkY - 48, 16, 10, rgb(92, 138, 72));
  } else {
    canvas.fillCircle(tx, trunkY - 52, 20, rgb(42, 128, 68));
  }
}

function drawBuildingsAndTrees(
  canvas: PixelCanvas,
  location: CatalogLocation,
  node: CatalogNodeSpec,
  rand: () => number
): void {
  const horizonY = EQUIRECT_HEIGHT / 2;
  const mountainEnv = isMountainEnvironment(location);
  const landmarkClearanceDeg = mountainEnv ? 40 : 16;
  const hasBuildingColors = location.buildingColors.length > 0;

  for (let deg = 6; deg < 360; deg += 15) {
    if (isNearRoad(deg, node.roadBearings, 20)) continue;
    if (Math.abs(angularDifference(deg, location.landmarkAzimuthDeg)) < landmarkClearanceDeg) {
      // Keep landmark sightline open
      continue;
    }

    const bx = azToX(deg);

    if (mountainEnv) {
      // Sparse low-rise pitched-roof alpine chalets/cabins + abundant conifers
      const drawChalet = hasBuildingColors && rand() > 0.65;
      if (drawChalet) {
        const bw = 54 + Math.round(rand() * 24);
        const bh = 36 + Math.round(rand() * 24);
        const bColor =
          location.buildingColors[
            Math.floor(rand() * location.buildingColors.length)
          ] ?? rgb(148, 108, 76);
        const botY = horizonY + 28;
        const topY = botY - bh;
        const roofPeakY = topY - Math.round(18 + rand() * 8);

        // Chalet wall
        canvas.fillRect(bx - bw / 2, topY, bw, bh, bColor);
        canvas.strokeRect(
          bx - bw / 2,
          topY,
          bw,
          bh,
          2,
          lerpColor(bColor, rgb(24, 24, 28), 0.3)
        );
        // Pitched gable timber/slate roof
        canvas.fillPolygon(
          [
            [bx - bw / 2 - 8, topY + 2],
            [bx, roofPeakY],
            [bx + bw / 2 + 8, topY + 2],
          ],
          lerpColor(bColor, rgb(48, 36, 28), 0.55)
        );
        // Small warm chalet windows
        const cols = Math.max(2, Math.floor((bw - 14) / 18));
        for (let c = 0; c < cols; c++) {
          const wx = bx - bw / 2 + 10 + c * 17;
          const wy = topY + 10;
          const lit = rand() > 0.45;
          canvas.fillRect(
            wx,
            wy,
            8,
            10,
            lit ? rgb(254, 240, 138, 220) : rgb(30, 41, 59, 200)
          );
        }
      }

      if (rand() > 0.28) {
        const tx = bx + (rand() - 0.5) * 36;
        const trunkY = horizonY + 34;
        drawTree(canvas, location, tx, trunkY);
      }
      continue;
    }

    if (hasBuildingColors) {
      const bw = 62 + Math.round(rand() * 28);
      const bh = 95 + Math.round(rand() * 145);
      const bColor =
        location.buildingColors[
          Math.floor(rand() * location.buildingColors.length)
        ] ?? rgb(180, 184, 192);
      const topY = horizonY - bh + 28;
      const botY = horizonY + 28;

      // Building facade
      canvas.fillRect(bx - bw / 2, topY, bw, bh, bColor);
      canvas.strokeRect(
        bx - bw / 2,
        topY,
        bw,
        bh,
        2,
        lerpColor(bColor, rgb(20, 24, 32), 0.25)
      );

      // Windows grid
      const cols = Math.max(2, Math.floor((bw - 16) / 16));
      const rows = Math.max(2, Math.floor((bh - 30) / 22));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = bx - bw / 2 + 10 + c * 15;
          const wy = topY + 12 + r * 20;
          const lit = rand() > 0.65;
          canvas.fillRect(
            wx,
            wy,
            8,
            12,
            lit ? rgb(254, 240, 138, 220) : rgb(30, 41, 59, 210)
          );
        }
      }

      // Storefront awning / door
      canvas.fillRect(
        bx - bw / 2 + 6,
        botY - 24,
        bw - 12,
        8,
        location.accentColor
      );
    }

    // Occasional street tree in front
    if (rand() > 0.45) {
      const tx = bx + (rand() - 0.5) * 32;
      const trunkY = horizonY + 34;
      drawTree(canvas, location, tx, trunkY);
    }
  }
}

function drawHorizonRanges(
  canvas: PixelCanvas,
  location: CatalogLocation,
  rand: () => number
): void {
  const horizonY = EQUIRECT_HEIGHT / 2;

  if (!isMountainEnvironment(location)) {
    // Distant rolling hills / horizon band
    for (let x = 0; x < EQUIRECT_WIDTH; x += 48) {
      const peak = 18 + Math.round(rand() * 34);
      canvas.fillPolygon(
        [
          [x - 36, horizonY],
          [x, horizonY - peak],
          [x + 36, horizonY],
        ],
        lerpColor(location.skyHorizon, rgb(70, 86, 104), 0.55)
      );
    }
    return;
  }

  // Far 360-degree snow-tipped alpine range
  const farRock = lerpColor(location.skyHorizon, rgb(76, 90, 112), 0.58);
  for (let x = 0; x < EQUIRECT_WIDTH; x += 64) {
    const peak = 55 + Math.round(rand() * 60);
    const halfW = 54 + Math.round(rand() * 20);
    canvas.fillPolygon(
      [
        [x - halfW, horizonY],
        [x, horizonY - peak],
        [x + halfW, horizonY],
      ],
      farRock
    );
    if (peak >= 70) {
      const snowRatio = 0.38;
      canvas.fillPolygon(
        [
          [x - halfW * snowRatio, horizonY - peak * (1 - snowRatio)],
          [x, horizonY - peak],
          [x + halfW * snowRatio, horizonY - peak * (1 - snowRatio)],
        ],
        rgb(242, 247, 252, 230)
      );
    }
  }

  // Mid foothill ridge band
  const midRidge = lerpColor(location.groundColor, rgb(56, 72, 68), 0.55);
  for (let x = 0; x < EQUIRECT_WIDTH; x += 52) {
    const peak = 25 + Math.round(rand() * 40);
    canvas.fillPolygon(
      [
        [x - 42, horizonY],
        [x, horizonY - peak],
        [x + 42, horizonY],
      ],
      midRidge
    );
  }
}

export function renderProceduralPanorama(
  location: CatalogLocation,
  nodeIndex: number
): { width: number; height: number; data: Uint8Array } {
  const horizonY = EQUIRECT_HEIGHT / 2;

  if (location.nodes.length === 0) {
    const canvas = new PixelCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
    const rand = seededRand(hashString(`${location.id}:empty`));
    drawSunAndClouds(canvas, location, rand);
    drawHorizonRanges(canvas, location, rand);
    drawLandmark(canvas, location, 0);
    canvas.fillGradientRect(
      0,
      horizonY,
      EQUIRECT_WIDTH,
      EQUIRECT_HEIGHT - horizonY,
      location.groundColor,
      lerpColor(location.groundColor, rgb(20, 24, 30), 0.32)
    );
    return {
      width: EQUIRECT_WIDTH,
      height: EQUIRECT_HEIGHT,
      data: canvas.data,
    };
  }

  const node = location.nodes[nodeIndex] ?? location.nodes[0];
  const canvas = new PixelCanvas(EQUIRECT_WIDTH, EQUIRECT_HEIGHT);
  const rand = seededRand(hashString(`${location.id}:${node.key}`));

  // 1. Sky + Sun + Clouds
  drawSunAndClouds(canvas, location, rand);

  // 2. Distant rolling hills / 360-degree mountain ranges
  drawHorizonRanges(canvas, location, rand);

  // 3. Signature landmark
  drawLandmark(canvas, location, nodeIndex);

  // 4. Ground plane
  canvas.fillGradientRect(
    0,
    horizonY,
    EQUIRECT_WIDTH,
    EQUIRECT_HEIGHT - horizonY,
    location.groundColor,
    lerpColor(location.groundColor, rgb(20, 24, 30), 0.32)
  );

  // 5. Buildings & regional vegetation
  drawBuildingsAndTrees(canvas, location, node, rand);

  // 6. Road corridors & driving-side vehicles
  drawRoads(canvas, location, node);

  // 7. Crisp readable street/regional signs (placed at clear heights)
  for (const sign of node.signs) {
    const sx = azToX(sign.azimuthDeg);
    const sy = sign.elevationPx ?? 410;
    canvas.drawSignBoard({
      centerX: sx,
      topY: sy,
      lines: sign.lines,
      bgColor: sign.bgColor,
      borderColor: sign.borderColor,
      textColor: sign.textColor,
      scale: sign.scale ?? 3,
      groundY: horizonY + 88,
    });
  }

  // 8. Subtle compass horizon reference ticks on road surface far nadir
  canvas.drawText(
    `NODE ${nodeIndex + 1}`,
    azToX(node.initialHeading) - 42,
    EQUIRECT_HEIGHT - 44,
    2,
    rgb(255, 255, 255, 75)
  );

  return {
    width: EQUIRECT_WIDTH,
    height: EQUIRECT_HEIGHT,
    data: canvas.data,
  };
}
