// Pure-TypeScript RGBA equirectangular canvas + crisp 5x7 bitmap font renderer

const FONT_5X7: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '°': ['01100', '10010', '10010', '01100', '00000', '00000', '00000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
  '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

export function normalizeSignText(text: string): string {
  return text
    .replace(/[Øø]/g, 'O')
    .replace(/[Ææ]/g, 'AE')
    .replace(/[Œœ]/g, 'OE')
    .replace(/ß/g, 'SS')
    .replace(/[ÐðĐđ]/g, 'D')
    .replace(/[Łł]/g, 'L')
    .replace(/[Þþ]/g, 'TH')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function hasGlyph(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(FONT_5X7, ch);
}

export type Rgba = [number, number, number, number];

export function rgb(r: number, g: number, b: number, a = 255): Rgba {
  return [r, g, b, a];
}

export function lerpColor(c1: Rgba, c2: Rgba, t: number): Rgba {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * k),
    Math.round(c1[1] + (c2[1] - c1[1]) * k),
    Math.round(c1[2] + (c2[2] - c1[2]) * k),
    Math.round(c1[3] + (c2[3] - c1[3]) * k),
  ];
}

export class PixelCanvas {
  public readonly width: number;
  public readonly height: number;
  public readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  public wrapX(x: number): number {
    const r = Math.floor(x) % this.width;
    return r < 0 ? r + this.width : r;
  }

  public setPixel(x: number, y: number, color: Rgba): void {
    const iy = Math.floor(y);
    if (iy < 0 || iy >= this.height) return;
    const ix = this.wrapX(x);
    const idx = (iy * this.width + ix) * 4;
    const alpha = color[3] / 255;
    if (alpha >= 0.996) {
      this.data[idx] = color[0];
      this.data[idx + 1] = color[1];
      this.data[idx + 2] = color[2];
      this.data[idx + 3] = 255;
      return;
    }
    if (alpha <= 0) return;
    const inv = 1 - alpha;
    this.data[idx] = Math.round(this.data[idx] * inv + color[0] * alpha);
    this.data[idx + 1] = Math.round(this.data[idx + 1] * inv + color[1] * alpha);
    this.data[idx + 2] = Math.round(this.data[idx + 2] * inv + color[2] * alpha);
    this.data[idx + 3] = 255;
  }

  public fillRect(x: number, y: number, w: number, h: number, color: Rgba): void {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const x0 = Math.floor(x);
    const x1 = Math.ceil(x + w);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, color);
      }
    }
  }

  public fillGradientRect(
    x: number,
    y: number,
    w: number,
    h: number,
    topColor: Rgba,
    bottomColor: Rgba
  ): void {
    const y0 = Math.max(0, Math.floor(y));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const span = Math.max(1, y1 - y0 - 1);
    const x0 = Math.floor(x);
    const x1 = Math.ceil(x + w);
    for (let py = y0; py < y1; py++) {
      const t = (py - y0) / span;
      const c = lerpColor(topColor, bottomColor, t);
      for (let px = x0; px < x1; px++) {
        this.setPixel(px, py, c);
      }
    }
  }

  public strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    thickness: number,
    color: Rgba
  ): void {
    this.fillRect(x, y, w, thickness, color);
    this.fillRect(x, y + h - thickness, w, thickness, color);
    this.fillRect(x, y, thickness, h, color);
    this.fillRect(x + w - thickness, y, thickness, h, color);
  }

  public fillCircle(cx: number, cy: number, radius: number, color: Rgba): void {
    const r2 = radius * radius;
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    const minX = Math.floor(cx - radius);
    const maxX = Math.ceil(cx + radius);
    for (let py = minY; py <= maxY; py++) {
      const dy = py - cy;
      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx;
        if (dx * dx + dy * dy <= r2) {
          this.setPixel(px, py, color);
        }
      }
    }
  }

  public fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: Rgba
  ): void {
    const minY = Math.max(0, Math.floor(cy - ry));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + ry));
    const minX = Math.floor(cx - rx);
    const maxX = Math.ceil(cx + rx);
    for (let py = minY; py <= maxY; py++) {
      const ny = (py - cy) / Math.max(1, ry);
      for (let px = minX; px <= maxX; px++) {
        const nx = (px - cx) / Math.max(1, rx);
        if (nx * nx + ny * ny <= 1) {
          this.setPixel(px, py, color);
        }
      }
    }
  }

  public drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    color: Rgba
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    const half = Math.max(0, (thickness - 1) / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + dx * t;
      const py = y0 + dy * t;
      if (half <= 0.5) {
        this.setPixel(px, py, color);
      } else {
        this.fillCircle(px, py, half, color);
      }
    }
  }

  public fillPolygon(points: Array<[number, number]>, color: Rgba): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.height - 1, Math.ceil(maxY));

    for (let py = yStart; py <= yEnd; py++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= py && y2 > py) || (y2 <= py && y1 > py)) {
          const xInt = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
          intersections.push(xInt);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const startX = Math.floor(intersections[i]);
        const endX = Math.ceil(intersections[i + 1]);
        for (let px = startX; px <= endX; px++) {
          this.setPixel(px, py, color);
        }
      }
    }
  }

  public drawText(
    text: string,
    x: number,
    y: number,
    scale: number,
    color: Rgba,
    spacing = 1
  ): number {
    const clean = normalizeSignText(text);
    let cursorX = Math.round(x);
    const charStep = (5 + spacing) * scale;
    for (const ch of clean) {
      const glyph = FONT_5X7[ch] ?? FONT_5X7[' '];
      for (let row = 0; row < 7; row++) {
        const line = glyph[row];
        for (let col = 0; col < 5; col++) {
          if (line[col] === '1') {
            this.fillRect(
              cursorX + col * scale,
              y + row * scale,
              scale,
              scale,
              color
            );
          }
        }
      }
      cursorX += charStep;
    }
    return cursorX - Math.round(x);
  }

  public measureTextWidth(text: string, scale: number, spacing = 1): number {
    const clean = normalizeSignText(text);
    const len = Array.from(clean).length;
    if (!len) return 0;
    return (len * 5 + Math.max(0, len - 1) * spacing) * scale;
  }

  public drawSignBoard(opts: {
    centerX: number;
    topY: number;
    lines: string[];
    bgColor: Rgba;
    borderColor: Rgba;
    textColor: Rgba;
    scale?: number;
    groundY?: number;
    poleColor?: Rgba;
  }): void {
    const scale = opts.scale ?? 3;
    const padX = 12;
    const padY = 10;
    const lineGap = 6;
    const lineHeight = 7 * scale;

    let maxW = 0;
    for (const line of opts.lines) {
      maxW = Math.max(maxW, this.measureTextWidth(line, scale, 1));
    }
    const boardW = Math.max(80, maxW + padX * 2);
    const boardH =
      padY * 2 +
      opts.lines.length * lineHeight +
      Math.max(0, opts.lines.length - 1) * lineGap;
    const leftX = Math.round(opts.centerX - boardW / 2);

    if (opts.groundY && opts.groundY > opts.topY + boardH) {
      const poleC = opts.poleColor ?? rgb(95, 102, 114);
      this.fillRect(
        Math.round(opts.centerX - 4),
        opts.topY + boardH - 2,
        8,
        opts.groundY - (opts.topY + boardH) + 4,
        poleC
      );
    }

    // Subtle drop shadow
    this.fillRect(leftX + 4, opts.topY + 4, boardW, boardH, rgb(10, 15, 25, 110));
    this.fillRect(leftX, opts.topY, boardW, boardH, opts.bgColor);
    this.strokeRect(leftX, opts.topY, boardW, boardH, 3, opts.borderColor);

    let ty = opts.topY + padY;
    for (const line of opts.lines) {
      const lw = this.measureTextWidth(line, scale, 1);
      const tx = Math.round(opts.centerX - lw / 2);
      this.drawText(line, tx, ty, scale, opts.textColor, 1);
      ty += lineHeight + lineGap;
    }
  }
}
