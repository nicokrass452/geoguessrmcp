import jpeg from 'jpeg-js';
import { headingToCompass, type CameraView } from '@geoguessr-mcp/shared';
import { PixelCanvas, rgb } from './bitmapFont.js';

/**
 * Projects a perspective camera view out of an equirectangular RGBA buffer
 * using the exact right-handed spherical convention (no mirroring):
 *   0 deg = North (+Z), 90 deg = East (+X), 180 deg = South (-Z), 270 deg = West (-X)
 */
export function renderPerspectiveFrame(
  eqData: Uint8Array,
  eqWidth: number,
  eqHeight: number,
  camera: CameraView,
  outWidth = 640,
  outHeight = 480,
  options?: { includeCompassOverlay?: boolean }
): Buffer {
  const out = new Uint8Array(outWidth * outHeight * 4);

  const vFovRad = (camera.fov * Math.PI) / 180;
  const f = outHeight / 2 / Math.tan(vFovRad / 2);

  const hRad = (camera.heading * Math.PI) / 180;
  const pRad = (camera.pitch * Math.PI) / 180;
  const cosH = Math.cos(hRad);
  const sinH = Math.sin(hRad);
  const cosP = Math.cos(pRad);
  const sinP = Math.sin(pRad);

  const halfW = outWidth / 2 - 0.5;
  const halfH = outHeight / 2 - 0.5;

  for (let py = 0; py < outHeight; py++) {
    const cy = -(py - halfH);
    const ry = cy * cosP + f * sinP;
    const rz = -cy * sinP + f * cosP;

    for (let px = 0; px < outWidth; px++) {
      const cx = px - halfW;

      const wx = cx * cosH + rz * sinH;
      const wy = ry;
      const wz = -cx * sinH + rz * cosH;

      const r = Math.hypot(wx, wy, wz);
      const az = Math.atan2(wx, wz);
      const u = ((az / (2 * Math.PI)) % 1 + 1) % 1;
      const elev = Math.asin(Math.max(-1, Math.min(1, wy / r)));
      const v = 0.5 - elev / Math.PI;

      const sx = u * eqWidth;
      const sy = Math.max(0, Math.min(eqHeight - 1, v * (eqHeight - 1)));

      const x0 = Math.floor(sx) % eqWidth;
      const x1 = (x0 + 1) % eqWidth;
      const y0 = Math.floor(sy);
      const y1 = Math.min(eqHeight - 1, y0 + 1);
      const fx = sx - Math.floor(sx);
      const fy = sy - y0;

      const i00 = (y0 * eqWidth + x0) * 4;
      const i10 = (y0 * eqWidth + x1) * 4;
      const i01 = (y1 * eqWidth + x0) * 4;
      const i11 = (y1 * eqWidth + x1) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const outIdx = (py * outWidth + px) * 4;
      out[outIdx] = Math.round(
        eqData[i00] * w00 +
          eqData[i10] * w10 +
          eqData[i01] * w01 +
          eqData[i11] * w11
      );
      out[outIdx + 1] = Math.round(
        eqData[i00 + 1] * w00 +
          eqData[i10 + 1] * w10 +
          eqData[i01 + 1] * w01 +
          eqData[i11 + 1] * w11
      );
      out[outIdx + 2] = Math.round(
        eqData[i00 + 2] * w00 +
          eqData[i10 + 2] * w10 +
          eqData[i01 + 2] * w01 +
          eqData[i11 + 2] * w11
      );
      out[outIdx + 3] = 255;
    }
  }

  if (options?.includeCompassOverlay) {
    const hud = new PixelCanvas(outWidth, outHeight);
    hud.data.set(out);
    const label = `${headingToCompass(camera.heading)} ${Math.round(camera.heading)} DEG  ZOOM ${camera.zoom.toFixed(1)}X`;
    hud.fillRect(12, 12, 240, 28, rgb(15, 23, 42, 185));
    hud.strokeRect(12, 12, 240, 28, 1, rgb(56, 189, 248, 220));
    hud.drawText(label, 22, 20, 2, rgb(248, 250, 252));
    out.set(hud.data);
  }

  const encoded = jpeg.encode(
    {
      data: out,
      width: outWidth,
      height: outHeight,
    },
    85
  );
  return Buffer.from(encoded.data);
}

export function encodeEquirectangularJpeg(
  eqData: Uint8Array,
  width: number,
  height: number,
  quality = 82
): Buffer {
  const encoded = jpeg.encode({ data: eqData, width, height }, quality);
  return Buffer.from(encoded.data);
}
