import fs from 'node:fs/promises';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import {
  normalizeHeading,
  toRadians,
  type CameraView,
  type LocationMode,
  type PanoramaProviderChoice,
  type TargetLocationInfo,
} from '@geoguessr-mcp/shared';
import type { ServerConfig } from '../config.js';
import {
  LOCATION_CATALOG,
  type CatalogLocation,
  type LocationCategory,
} from './catalog.js';
import {
  encodeEquirectangularJpeg,
  renderPerspectiveFrame,
} from './equirectangular.js';
import {
  MAPILLARY_WORLD_SEEDS,
  type MapillaryWorldSeed,
} from './mapillarySeeds.js';
import { renderProceduralPanorama } from './proceduralRenderer.js';

export interface InternalNodeLink {
  targetRealNodeKey: string;
  bearingDeg: number;
  distanceMeters: number;
  label?: string;
}

export interface InternalRoundNode {
  realNodeKey: string;
  nodeIndex: number;
  lat: number;
  lng: number;
  initialHeading: number;
  links: InternalNodeLink[];
  mapillaryImageId?: string;
  externalEquirectUrl?: string;
  wikimediaFile?: string;
  googlePanoMode?: boolean;
}

export interface BuiltRoundScene {
  location: CatalogLocation;
  targetInfo: TargetLocationInfo;
  spawnRealKey: string;
  nodes: Map<string, InternalRoundNode>;
  providerUsed: string;
  mapillarySeedId?: string;
}

interface CachedEquirect {
  width: number;
  height: number;
  data: Uint8Array;
  jpegBytes?: Buffer;
  isFallback?: boolean;
}

function bearingBetweenDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLambda = toRadians(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function approxMetersBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos(toRadians((lat1 + lat2) / 2));
  return Math.max(5, Math.round(Math.hypot(dLat, dLng)));
}

function decodeImageBytes(bytes: Buffer): {
  width: number;
  height: number;
  data: Uint8Array;
} | null {
  // Check PNG signature
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const png = PNG.sync.read(bytes);
    return {
      width: png.width,
      height: png.height,
      data: new Uint8Array(png.data),
    };
  }
  // Check JPEG signature
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return {
      width: decoded.width,
      height: decoded.height,
      data: decoded.data,
    };
  }
  return null;
}

export function matchesLocationMode(
  categories: readonly LocationCategory[],
  locationMode: LocationMode
): boolean {
  switch (locationMode) {
    case 'standard':
      return true;
    case 'big_cities':
      return categories.includes('big_city');
    case 'mountain_regions':
      return categories.includes('mountain');
  }
}

export class PanoramaProviderManager {
  private readonly config: ServerConfig;
  private readonly equirectCache = new Map<string, CachedEquirect>();
  private readonly inFlightBuffers = new Map<
    string,
    Promise<CachedEquirect>
  >();
  private readonly externalFailureCooldown = new Map<string, number>();
  private readonly externalCooldownMs = 15_000;
  private readonly maxCacheEntries = 16;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  public resolveEffectiveProvider(
    requested: PanoramaProviderChoice
  ): 'open' | 'wikimedia' | 'mapillary' | 'google' {
    if (requested === 'open') return 'open';
    if (requested === 'mapillary' && this.config.mapillaryAccessToken) {
      return 'mapillary';
    }
    if (requested === 'google' && this.config.googleMapsApiKey) {
      return 'google';
    }
    if (requested === 'wikimedia') return 'wikimedia';

    // 'auto' or missing API key fallback
    if (requested === 'auto') {
      if (this.config.mapillaryAccessToken) return 'mapillary';
      if (this.config.googleMapsApiKey) return 'google';
      if (this.config.enableWikimediaFetch) return 'wikimedia';
    }
    return 'open';
  }

  public async buildRoundScene(
    location: CatalogLocation,
    requestedProvider: PanoramaProviderChoice,
    excludeSeedIds?: Set<string>,
    locationMode: LocationMode = 'standard'
  ): Promise<BuiltRoundScene> {
    const effectiveLocation = matchesLocationMode(location.categories, locationMode)
      ? location
      : this.pickRandomLocations(1, locationMode)[0];
    const effective = this.resolveEffectiveProvider(requestedProvider);

    if (effective === 'mapillary') {
      const mapillaryScene = await this.tryBuildGlobalMapillaryScene(
        effectiveLocation,
        excludeSeedIds,
        locationMode
      );
      if (mapillaryScene) return mapillaryScene;
    }

    if (effective === 'google') {
      const googleScene = await this.tryBuildGoogleScene(effectiveLocation);
      if (googleScene) return googleScene;
    }

    const useWikimedia =
      effective === 'wikimedia' &&
      this.config.enableWikimediaFetch &&
      Boolean(effectiveLocation.wikimediaFile);
    const providerLabel = useWikimedia
      ? 'wikimedia-commons'
      : 'open-procedural-360';

    const nodes = new Map<string, InternalRoundNode>();
    effectiveLocation.nodes.forEach((n, idx) => {
      nodes.set(n.key, {
        realNodeKey: n.key,
        nodeIndex: idx,
        lat: n.lat,
        lng: n.lng,
        initialHeading: n.initialHeading,
        links: n.links.map((l) => ({
          targetRealNodeKey: l.targetKey,
          bearingDeg: l.bearingDeg,
          distanceMeters: l.distanceMeters,
          label: l.label,
        })),
        wikimediaFile:
          idx === 0 && useWikimedia ? effectiveLocation.wikimediaFile : undefined,
      });
    });

    const spawn = effectiveLocation.nodes[0];
    return {
      location: effectiveLocation,
      targetInfo: {
        latitude: spawn.lat,
        longitude: spawn.lng,
        name: effectiveLocation.name,
        city: effectiveLocation.city,
        country: effectiveLocation.country,
        region: effectiveLocation.region,
        provider: providerLabel,
      },
      spawnRealKey: spawn.key,
      nodes,
      providerUsed: providerLabel,
    };
  }

  private async tryBuildGlobalMapillaryScene(
    fallbackLocation: CatalogLocation,
    excludeSeedIds?: Set<string>,
    locationMode: LocationMode = 'standard'
  ): Promise<BuiltRoundScene | null> {
    if (!this.config.mapillaryAccessToken) return null;

    const modeSeeds = MAPILLARY_WORLD_SEEDS.filter((s) =>
      matchesLocationMode(s.categories, locationMode)
    );
    if (modeSeeds.length === 0) {
      console.warn(
        `[Mapillary] No seeds available for locationMode=${locationMode}; falling back`
      );
      return null;
    }

    const candidates = modeSeeds.filter(
      (s) => !excludeSeedIds?.has(s.id)
    );
    const pool = candidates.length > 0 ? [...candidates] : [...modeSeeds];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Race 4 shuffled seeds in parallel (up to 2 batches) for fast real 360 coverage
    for (let offset = 0; offset < 8; offset += 4) {
      const batch = pool.slice(offset, offset + 4);
      if (batch.length === 0) break;
      const controller = new AbortController();
      try {
        const winner = await Promise.any(
          batch.map(async (seed) => {
            const scene = await this.tryFetchMapillarySeedScene(
              seed,
              fallbackLocation,
              controller.signal
            );
            if (!scene) {
              throw new Error(`No 360 scene in ${seed.city}`);
            }
            return scene;
          })
        );
        controller.abort();
        return winner;
      } catch {
        controller.abort();
      }
    }

    console.warn('[Mapillary] Exhausted 8 random seeds without 360 coverage; falling back to open-procedural-360');
    return null;
  }

  private async tryFetchMapillarySeedScene(
    seed: MapillaryWorldSeed,
    fallbackLocation: CatalogLocation,
    parentSignal?: AbortSignal
  ): Promise<BuiltRoundScene | null> {
    try {
      // Mountain valley roads use tighter jitter & wider bbox than urban grids
      const isMountainOnly =
        seed.categories.includes('mountain') &&
        !seed.categories.includes('big_city');
      const jitterSpan = isMountainOnly ? 0.004 : 0.012;
      const jitterLat = (Math.random() - 0.5) * jitterSpan;
      const jitterLng = (Math.random() - 0.5) * jitterSpan;
      const centerLat = seed.lat + jitterLat;
      const centerLng = seed.lng + jitterLng;
      const delta = isMountainOnly ? 0.006 : 0.0025;
      const bbox = `${centerLng - delta},${centerLat - delta},${centerLng + delta},${centerLat + delta}`;
      const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(
        this.config.mapillaryAccessToken
      )}&fields=id,computed_geometry,compass_angle,thumb_2048_url,sequence&bbox=${bbox}&is_pano=true&limit=6`;

      const timeoutSig = AbortSignal.timeout(10000);
      const signal = parentSignal
        ? AbortSignal.any([parentSignal, timeoutSig])
        : timeoutSig;
      const res = await fetch(url, { signal });
      if (!res.ok) {
        console.warn(`[Mapillary] Graph API returned HTTP ${res.status} for ${seed.city}`);
        return null;
      }
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          computed_geometry?: { coordinates: [number, number] };
          geometry?: { coordinates: [number, number] };
          compass_angle?: number;
          thumb_2048_url?: string;
          sequence?: string;
        }>;
      };
      const getCoords = (d: {
        computed_geometry?: { coordinates: [number, number] };
        geometry?: { coordinates: [number, number] };
      }) => d.computed_geometry?.coordinates ?? d.geometry?.coordinates;

      const items = (json.data || []).filter(
        (d) => Boolean(getCoords(d)) && Boolean(d.thumb_2048_url)
      );
      if (items.length === 0) {
        console.warn(`[Mapillary] No 360 panoramas near ${seed.city}; trying another city`);
        return null;
      }

      // Prefer chaining panos along the same street sequence
      const bySeq = new Map<string, typeof items>();
      for (const item of items) {
        if (!item.sequence) continue;
        const arr = bySeq.get(item.sequence) ?? [];
        arr.push(item);
        bySeq.set(item.sequence, arr);
      }
      const multiSeqs = Array.from(bySeq.values()).filter((a) => a.length >= 2);
      let selected: typeof items;

      if (multiSeqs.length > 0) {
        const chosenSeq = multiSeqs[Math.floor(Math.random() * multiSeqs.length)];
        const anchor = chosenSeq[Math.floor(Math.random() * chosenSeq.length)];
        const [aLng, aLat] = getCoords(anchor)!;
        selected = [...chosenSeq]
          .sort((a, b) => {
            const [al, aa] = getCoords(a)!;
            const [bl, ba] = getCoords(b)!;
            return (
              approxMetersBetween(aLat, aLng, aa, al) -
              approxMetersBetween(aLat, aLng, ba, bl)
            );
          })
          .slice(0, 4);
      } else {
        const anchor = items[Math.floor(Math.random() * items.length)];
        const [aLng, aLat] = getCoords(anchor)!;
        selected = items
          .filter((item) => {
            const [iLng, iLat] = getCoords(item)!;
            return approxMetersBetween(aLat, aLng, iLat, iLng) <= 220;
          })
          .slice(0, 4);
        if (selected.length === 0) selected = [anchor];
      }

      const nodes = new Map<string, InternalRoundNode>();
      selected.forEach((item, idx) => {
        const [lng, lat] = getCoords(item)!;
        const links: InternalNodeLink[] = [];
        if (idx + 1 < selected.length) {
          const [nLng, nLat] = getCoords(selected[idx + 1])!;
          links.push({
            targetRealNodeKey: `m${idx + 1}`,
            bearingDeg: bearingBetweenDeg(lat, lng, nLat, nLng),
            distanceMeters: approxMetersBetween(lat, lng, nLat, nLng),
          });
        }
        if (idx > 0) {
          const [pLng, pLat] = getCoords(selected[idx - 1])!;
          links.push({
            targetRealNodeKey: `m${idx - 1}`,
            bearingDeg: bearingBetweenDeg(lat, lng, pLat, pLng),
            distanceMeters: approxMetersBetween(lat, lng, pLat, pLng),
          });
        }
        nodes.set(`m${idx}`, {
          realNodeKey: `m${idx}`,
          nodeIndex: idx,
          lat,
          lng,
          initialHeading: normalizeHeading(item.compass_angle ?? 0),
          links,
          mapillaryImageId: item.id,
          externalEquirectUrl: item.thumb_2048_url,
        });
      });

      const first = nodes.get('m0')!;
      return {
        location: fallbackLocation,
        targetInfo: {
          latitude: first.lat,
          longitude: first.lng,
          name: `${seed.city} Street View`,
          city: seed.city,
          country: seed.country,
          region: seed.region,
          provider: 'mapillary-v4',
        },
        spawnRealKey: 'm0',
        nodes,
        providerUsed: 'mapillary-v4',
        mapillarySeedId: seed.id,
      };
    } catch (err) {
      console.warn(
        `[Mapillary] Failed to query panoramas for ${seed.city}:`,
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }

  private async tryBuildGoogleScene(
    location: CatalogLocation
  ): Promise<BuiltRoundScene | null> {
    if (!this.config.googleMapsApiKey) return null;
    try {
      const spawn = location.nodes[0];
      const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${spawn.lat},${spawn.lng}&key=${encodeURIComponent(
        this.config.googleMapsApiKey
      )}`;
      const res = await fetch(metaUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const meta = (await res.json()) as {
        status?: string;
        location?: { lat: number; lng: number };
      };
      if (meta.status !== 'OK') return null;

      const nodes = new Map<string, InternalRoundNode>();
      location.nodes.forEach((n, idx) => {
        nodes.set(n.key, {
          realNodeKey: n.key,
          nodeIndex: idx,
          lat: idx === 0 && meta.location ? meta.location.lat : n.lat,
          lng: idx === 0 && meta.location ? meta.location.lng : n.lng,
          initialHeading: n.initialHeading,
          links: n.links.map((l) => ({
            targetRealNodeKey: l.targetKey,
            bearingDeg: l.bearingDeg,
            distanceMeters: l.distanceMeters,
            label: l.label,
          })),
          googlePanoMode: true,
        });
      });

      const first = nodes.get(location.nodes[0].key)!;
      return {
        location,
        targetInfo: {
          latitude: first.lat,
          longitude: first.lng,
          name: location.name,
          city: location.city,
          country: location.country,
          region: location.region,
          provider: 'google-street-view',
        },
        spawnRealKey: first.realNodeKey,
        nodes,
        providerUsed: 'google-street-view',
      };
    } catch {
      return null;
    }
  }

  private setCache(key: string, value: CachedEquirect): void {
    if (this.equirectCache.has(key)) {
      this.equirectCache.delete(key);
    } else if (this.equirectCache.size >= this.maxCacheEntries) {
      const oldestKey = this.equirectCache.keys().next().value;
      if (oldestKey) this.equirectCache.delete(oldestKey);
    }
    this.equirectCache.set(key, value);
  }

  private async refreshMapillaryThumbUrl(
    imageId: string
  ): Promise<string | null> {
    if (!this.config.mapillaryAccessToken) return null;
    try {
      const url = `https://graph.mapillary.com/${encodeURIComponent(
        imageId
      )}?fields=thumb_2048_url&access_token=${encodeURIComponent(
        this.config.mapillaryAccessToken
      )}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { thumb_2048_url?: string };
      return json.thumb_2048_url || null;
    } catch {
      return null;
    }
  }

  private async performExternalEquirectFetch(
    cacheKey: string,
    url: string
  ): Promise<{ entry: CachedEquirect | null; status?: number }> {
    const safeFile = path.join(
      this.config.cacheDir,
      `${cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`
    );

    try {
      const diskBytes = await fs.readFile(safeFile);
      const decoded = decodeImageBytes(diskBytes);
      if (decoded) {
        return { entry: { ...decoded } };
      }
    } catch {
      // Cache miss on disk
    }

    const retryDelaysMs = [400, 900];
    let lastError = 'unknown error';
    let lastStatus: number | undefined;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'GeoGuessr-MCP-Arena/1.0 (https://github.com/geoguessr-mcp)',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          lastStatus = res.status;
          lastError = `HTTP ${res.status}`;
          const retryable = res.status === 429 || res.status >= 500;
          if (!retryable) {
            console.warn(
              `[Panorama] External image HTTP ${res.status} for ${cacheKey}`
            );
            return { entry: null, status: res.status };
          }
          if (attempt < retryDelaysMs.length) {
            await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
            continue;
          }
          console.warn(
            `[Panorama] External image HTTP ${res.status} for ${cacheKey} after ${attempt + 1} attempts`
          );
          return { entry: null, status: res.status };
        }
        const arr = await res.arrayBuffer();
        const bytes = Buffer.from(arr);
        const decoded = decodeImageBytes(bytes);
        if (!decoded || decoded.width < 512) return { entry: null };

        await fs.mkdir(this.config.cacheDir, { recursive: true }).catch(() => {});
        const tmpFile = `${safeFile}.${process.pid}.${Date.now()}.${Math.random()
          .toString(36)
          .slice(2, 6)}.tmp`;
        try {
          await fs.writeFile(tmpFile, bytes);
          await fs.rename(tmpFile, safeFile);
        } catch {
          await fs.unlink(tmpFile).catch(() => {});
        }
        return { entry: { ...decoded } };
      } catch (err) {
        const cause =
          err instanceof Error && err.cause
            ? ` (cause: ${
                err.cause instanceof Error ? err.cause.message : String(err.cause)
              })`
            : '';
        lastError = `${err instanceof Error ? err.message : String(err)}${cause}`;
        if (attempt < retryDelaysMs.length) {
          await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
          continue;
        }
      }
    }

    console.warn(
      `[Panorama] Failed to fetch external image (${cacheKey}) after ${retryDelaysMs.length + 1} attempts: ${lastError}`
    );
    return { entry: null, status: lastStatus };
  }

  public async getEquirectangularBuffer(
    location: CatalogLocation,
    node: InternalRoundNode
  ): Promise<CachedEquirect> {
    const cacheKey = `${location.id}:${node.realNodeKey}:${node.mapillaryImageId || node.wikimediaFile || 'proc'}`;
    const existing = this.equirectCache.get(cacheKey);
    if (existing) return existing;

    const inFlight = this.inFlightBuffers.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = this.resolveEquirectangularBuffer(
      cacheKey,
      location,
      node
    ).finally(() => {
      this.inFlightBuffers.delete(cacheKey);
    });
    this.inFlightBuffers.set(cacheKey, promise);
    return promise;
  }

  private async resolveEquirectangularBuffer(
    cacheKey: string,
    location: CatalogLocation,
    node: InternalRoundNode
  ): Promise<CachedEquirect> {
    const cooldownUntil = this.externalFailureCooldown.get(cacheKey) ?? 0;
    const inCooldown = Date.now() < cooldownUntil;

    if (!inCooldown && node.externalEquirectUrl) {
      let result = await this.performExternalEquirectFetch(
        cacheKey,
        node.externalEquirectUrl
      );
      const urlExpired =
        result.status === 401 ||
        result.status === 403 ||
        result.status === 404 ||
        result.status === 410;
      if (
        !result.entry &&
        urlExpired &&
        node.mapillaryImageId &&
        this.config.mapillaryAccessToken
      ) {
        const refreshedUrl = await this.refreshMapillaryThumbUrl(
          node.mapillaryImageId
        );
        if (refreshedUrl) {
          node.externalEquirectUrl = refreshedUrl;
          result = await this.performExternalEquirectFetch(
            cacheKey,
            refreshedUrl
          );
        }
      }
      if (result.entry) {
        this.externalFailureCooldown.delete(cacheKey);
        this.setCache(cacheKey, result.entry);
        return result.entry;
      }
    }

    if (!inCooldown && node.wikimediaFile) {
      const wikiUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        node.wikimediaFile
      )}?width=2048`;
      const result = await this.performExternalEquirectFetch(cacheKey, wikiUrl);
      if (result.entry) {
        this.externalFailureCooldown.delete(cacheKey);
        this.setCache(cacheKey, result.entry);
        return result.entry;
      }
    }

    const isFallback = Boolean(node.externalEquirectUrl || node.wikimediaFile);
    if (isFallback && !inCooldown) {
      this.externalFailureCooldown.set(
        cacheKey,
        Date.now() + this.externalCooldownMs
      );
    }

    const rendered = renderProceduralPanorama(location, node.nodeIndex);
    const entry: CachedEquirect = {
      width: rendered.width,
      height: rendered.height,
      data: rendered.data,
      isFallback,
    };
    if (!isFallback) {
      this.setCache(cacheKey, entry);
    }
    return entry;
  }

  public async getEquirectangularJpegWithMeta(
    location: CatalogLocation,
    node: InternalRoundNode
  ): Promise<{ jpeg: Buffer; isFallback: boolean }> {
    const buf = await this.getEquirectangularBuffer(location, node);
    if (!buf.jpegBytes) {
      buf.jpegBytes = encodeEquirectangularJpeg(buf.data, buf.width, buf.height, 82);
    }
    return {
      jpeg: buf.jpegBytes,
      isFallback: Boolean(buf.isFallback),
    };
  }

  public async getEquirectangularJpeg(
    location: CatalogLocation,
    node: InternalRoundNode
  ): Promise<Buffer> {
    const { jpeg } = await this.getEquirectangularJpegWithMeta(location, node);
    return jpeg;
  }

  public async renderAgentViewport(
    location: CatalogLocation,
    node: InternalRoundNode,
    camera: CameraView,
    options?: { includeCompassOverlay?: boolean }
  ): Promise<Buffer> {
    if (node.googlePanoMode && this.config.googleMapsApiKey) {
      try {
        const fov = Math.max(20, Math.min(120, Math.round(camera.fov)));
        const gUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${node.lat},${node.lng}&heading=${camera.heading}&pitch=${camera.pitch}&fov=${fov}&key=${encodeURIComponent(
          this.config.googleMapsApiKey
        )}`;
        const res = await fetch(gUrl, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const arr = await res.arrayBuffer();
          const buf = Buffer.from(arr);
          if (buf.length > 2000 && buf[0] === 0xff && buf[1] === 0xd8) {
            return buf;
          }
        }
      } catch {
        // Fall through cleanly to local equirectangular perspective render
      }
    }

    const eq = await this.getEquirectangularBuffer(location, node);
    return renderPerspectiveFrame(
      eq.data,
      eq.width,
      eq.height,
      camera,
      640,
      480,
      options
    );
  }

  public pickRandomLocations(
    count: number,
    locationMode: LocationMode = 'standard'
  ): CatalogLocation[] {
    if (count <= 0) return [];
    const filtered = LOCATION_CATALOG.filter((loc) =>
      matchesLocationMode(loc.categories, locationMode)
    );
    if (filtered.length === 0) {
      throw new Error(
        `No catalog locations available for locationMode '${locationMode}'`
      );
    }
    const picked: CatalogLocation[] = [];
    while (picked.length < count) {
      const pool = [...filtered];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (const loc of pool) {
        picked.push(loc);
        if (picked.length >= count) break;
      }
    }
    return picked;
  }
}
