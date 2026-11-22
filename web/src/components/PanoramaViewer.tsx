import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Compass,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
} from 'lucide-react';
import {
  angularDifference,
  clampCamera,
  headingToCompass,
  normalizeHeading,
  zoomToFov,
  type AvailableMove,
  type CameraView,
  type MoveDirection,
} from '@geoguessr-mcp/shared';

interface PanoramaViewerProps {
  panoramaUrl: string;
  currentNodeId: string;
  spawnNodeId: string;
  initialCamera: CameraView;
  availableMoves: AvailableMove[];
  mapillaryImageId?: string;
  mapillaryAccessToken?: string | null;
  disabled?: boolean;
  onCameraChange: (heading: number, pitch: number, zoom: number) => void;
  onMove: (opts: { direction?: MoveDirection; nodeId?: string }) => void;
  onReturnToStart: () => void;
}

const COMPASS_MARKS: Array<{ deg: number; label: string; major: boolean }> = [
  { deg: 0, label: 'N', major: true },
  { deg: 45, label: 'NE', major: false },
  { deg: 90, label: 'E', major: true },
  { deg: 135, label: 'SE', major: false },
  { deg: 180, label: 'S', major: true },
  { deg: 225, label: 'SW', major: false },
  { deg: 270, label: 'W', major: true },
  { deg: 315, label: 'NW', major: false },
];

export function PanoramaViewer({
  panoramaUrl,
  currentNodeId,
  spawnNodeId,
  initialCamera,
  availableMoves,
  mapillaryImageId,
  mapillaryAccessToken,
  disabled = false,
  onCameraChange,
  onMove,
  onReturnToStart,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapillaryContainerRef = useRef<HTMLDivElement | null>(null);
  const [camera, setCamera] = useState<CameraView>(initialCamera);
  const cameraRef = useRef<CameraView>(initialCamera);
  const [loadingTexture, setLoadingTexture] = useState(true);
  const [useMapillaryView, setUseMapillaryView] = useState(false);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const threeCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sphereMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackImgRef = useRef<HTMLImageElement | null>(null);
  const lastSyncMs = useRef(0);
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });

  // Reset camera when jumping back to spawn or new round
  const lastNodeKey = useRef(`${panoramaUrl}:${currentNodeId}`);
  useEffect(() => {
    const key = `${panoramaUrl}:${currentNodeId}`;
    if (key !== lastNodeKey.current) {
      lastNodeKey.current = key;
      if (currentNodeId === spawnNodeId) {
        const next = clampCamera(
          initialCamera.heading,
          initialCamera.pitch,
          initialCamera.zoom
        );
        cameraRef.current = next;
        setCamera(next);
      }
    }
  }, [panoramaUrl, currentNodeId, spawnNodeId, initialCamera]);

  const applyCamera = useCallback(
    (heading: number, pitch: number, zoom: number, syncServer = true) => {
      const next = clampCamera(heading, pitch, zoom);
      cameraRef.current = next;
      setCamera(next);

      if (syncServer) {
        const now = Date.now();
        if (now - lastSyncMs.current >= 140) {
          lastSyncMs.current = now;
          onCameraChange(next.heading, next.pitch, next.zoom);
        }
      }
    },
    [onCameraChange]
  );

  // Initialize Three.js WebGL sphere (or clean 2D fallback)
  useEffect(() => {
    const host = containerRef.current;
    if (!host || useMapillaryView) return;

    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      host.innerHTML = '';
      host.appendChild(renderer.domElement);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
    } catch {
      renderer = null;
    }

    if (!renderer) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      host.innerHTML = '';
      host.appendChild(canvas);
      fallbackCanvasRef.current = canvas;
    }

    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    const threeCam = new THREE.PerspectiveCamera(
      cameraRef.current.fov,
      width / height,
      0.1,
      1100
    );
    threeCamRef.current = threeCam;

    const geo = new THREE.SphereGeometry(500, 64, 40);
    geo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    sphereMatRef.current = mat;
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    let rafId = 0;
    const renderLoop = () => {
      rafId = requestAnimationFrame(renderLoop);
      const cur = cameraRef.current;
      if (rendererRef.current && threeCamRef.current) {
        const cam = threeCamRef.current;
        const targetFov = zoomToFov(cur.zoom);
        if (Math.abs(cam.fov - targetFov) > 0.05) {
          cam.fov = targetFov;
          cam.updateProjectionMatrix();
        }
        const hRad = (cur.heading * Math.PI) / 180;
        const pRad = (cur.pitch * Math.PI) / 180;
        cam.lookAt(
          Math.cos(pRad) * Math.cos(hRad),
          Math.sin(pRad),
          Math.cos(pRad) * Math.sin(hRad)
        );
        rendererRef.current.render(scene, cam);
      } else if (fallbackCanvasRef.current && fallbackImgRef.current?.complete) {
        const cvs = fallbackCanvasRef.current;
        const ctx = cvs.getContext('2d');
        const img = fallbackImgRef.current;
        if (ctx && img.naturalWidth > 0) {
          const w = cvs.width;
          const h = cvs.height;
          const hFov = cur.fov * (w / h);
          const srcW = (hFov / 360) * img.naturalWidth;
          const srcH = (cur.fov / 180) * img.naturalHeight;
          const centerX = (normalizeHeading(cur.heading) / 360) * img.naturalWidth;
          const centerY = ((0.5 - cur.pitch / 180) * img.naturalHeight);
          const sx = centerX - srcW / 2;
          const sy = Math.max(0, Math.min(img.naturalHeight - srcH, centerY - srcH / 2));

          ctx.clearRect(0, 0, w, h);
          if (sx < 0) {
            const leftPart = -sx;
            const leftRatio = leftPart / srcW;
            ctx.drawImage(
              img,
              img.naturalWidth - leftPart,
              sy,
              leftPart,
              srcH,
              0,
              0,
              w * leftRatio,
              h
            );
            ctx.drawImage(
              img,
              0,
              sy,
              srcW - leftPart,
              srcH,
              w * leftRatio,
              0,
              w * (1 - leftRatio),
              h
            );
          } else if (sx + srcW > img.naturalWidth) {
            const firstPart = img.naturalWidth - sx;
            const firstRatio = firstPart / srcW;
            ctx.drawImage(img, sx, sy, firstPart, srcH, 0, 0, w * firstRatio, h);
            ctx.drawImage(
              img,
              0,
              sy,
              srcW - firstPart,
              srcH,
              w * firstRatio,
              0,
              w * (1 - firstRatio),
              h
            );
          } else {
            ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, w, h);
          }
        }
      }
    };
    renderLoop();

    const handleResize = () => {
      if (!host) return;
      const nw = host.clientWidth || window.innerWidth;
      const nh = host.clientHeight || window.innerHeight;
      if (rendererRef.current && threeCamRef.current) {
        threeCamRef.current.aspect = nw / nh;
        threeCamRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(nw, nh);
      } else if (fallbackCanvasRef.current) {
        fallbackCanvasRef.current.width = nw;
        fallbackCanvasRef.current.height = nh;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      geo.dispose();
      mat.dispose();
      renderer?.dispose();
      rendererRef.current = null;
      threeCamRef.current = null;
      sphereMatRef.current = null;
    };
  }, [useMapillaryView]);

  // Load equirectangular panorama texture whenever URL updates
  useEffect(() => {
    if (useMapillaryView || !panoramaUrl) return;
    let active = true;
    setLoadingTexture(true);

    if (rendererRef.current && sphereMatRef.current) {
      const loader = new THREE.TextureLoader();
      loader.load(
        panoramaUrl,
        (tex) => {
          if (!active) {
            tex.dispose();
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          const old = sphereMatRef.current?.map;
          if (sphereMatRef.current) {
            sphereMatRef.current.map = tex;
            sphereMatRef.current.needsUpdate = true;
          }
          old?.dispose();
          setLoadingTexture(false);
        },
        undefined,
        () => {
          if (active) setLoadingTexture(false);
        }
      );
    } else {
      const img = new Image();
      img.onload = () => {
        if (!active) return;
        fallbackImgRef.current = img;
        setLoadingTexture(false);
      };
      img.onerror = () => {
        if (active) setLoadingTexture(false);
      };
      img.src = panoramaUrl;
    }

    return () => {
      active = false;
    };
  }, [panoramaUrl, useMapillaryView]);

  // Optional MapillaryJS viewer when API token & image ID exist
  useEffect(() => {
    if (!useMapillaryView || !mapillaryImageId || !mapillaryAccessToken) return;
    const container = mapillaryContainerRef.current;
    if (!container) return;
    let destroyed = false;
    let viewerInstance: { remove: () => void } | null = null;

    (async () => {
      try {
        const [{ Viewer }] = await Promise.all([
          import('mapillary-js'),
          import('mapillary-js/dist/mapillary.css'),
        ]);
        if (destroyed) return;
        const viewer = new Viewer({
          accessToken: mapillaryAccessToken,
          container,
          imageId: mapillaryImageId,
        });
        viewerInstance = viewer;
      } catch {
        if (!destroyed) setUseMapillaryView(false);
      }
    })();

    return () => {
      destroyed = true;
      viewerInstance?.remove();
    };
  }, [useMapillaryView, mapillaryImageId, mapillaryAccessToken]);

  // Keyboard navigation
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }
      const cur = cameraRef.current;
      const step = Math.max(4, cur.fov / 8);
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        applyCamera(cur.heading - step, cur.pitch, cur.zoom);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        applyCamera(cur.heading + step, cur.pitch, cur.zoom);
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        applyCamera(cur.heading, cur.pitch + step * 0.7, cur.zoom);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        applyCamera(cur.heading, cur.pitch - step * 0.7, cur.zoom);
      } else if (e.key === '+' || e.key === '=') {
        applyCamera(cur.heading, cur.pitch, cur.zoom + 0.4);
      } else if (e.key === '-') {
        applyCamera(cur.heading, cur.pitch, cur.zoom - 0.4);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, applyCamera]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || useMapillaryView) return;
    dragRef.current = { active: true, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || disabled || useMapillaryView) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    const cur = cameraRef.current;
    const sens = cur.fov / 480;
    applyCamera(cur.heading - dx * sens, cur.pitch + dy * sens, cur.zoom);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.active) {
      dragRef.current.active = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const cur = cameraRef.current;
      onCameraChange(cur.heading, cur.pitch, cur.zoom);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (disabled || useMapillaryView) return;
    const cur = cameraRef.current;
    const delta = e.deltaY < 0 ? 0.35 : -0.35;
    applyCamera(cur.heading, cur.pitch, cur.zoom + delta);
  };

  const movesByDirection = useMemo(() => {
    const map = new Map<MoveDirection, AvailableMove>();
    for (const move of availableMoves) {
      const prev = map.get(move.relativeDirection);
      if (!prev) {
        map.set(move.relativeDirection, move);
      }
    }
    return map;
  }, [availableMoves]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      {/* Main 360 Viewport */}
      {useMapillaryView && mapillaryImageId ? (
        <div ref={mapillaryContainerRef} className="h-full w-full" />
      ) : (
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          className="h-full w-full cursor-grab active:cursor-grabbing touch-none"
        />
      )}

      {loadingTexture && !useMapillaryView && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm">
          <div className="rounded-xl border border-slate-700/80 bg-slate-900/90 px-4 py-2 text-sm text-slate-200 shadow-xl">
            Rendering 360° street panorama...
          </div>
        </div>
      )}

      {/* Top-Center Interactive Compass Strip */}
      <div className="pointer-events-none absolute top-16 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-1.5">
        <div className="relative h-9 w-72 sm:w-88 overflow-hidden rounded-full border border-white/15 bg-slate-950/75 backdrop-blur-md shadow-lg">
          <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-sky-400/90 z-10" />
          {COMPASS_MARKS.map((mark) => {
            const delta = angularDifference(camera.heading, mark.deg);
            if (Math.abs(delta) > 78) return null;
            const leftPct = 50 + (delta / 75) * 50;
            return (
              <div
                key={mark.label}
                style={{ left: `${leftPct}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              >
                <span
                  className={
                    mark.label === 'N'
                      ? 'text-xs font-extrabold text-rose-400'
                      : mark.major
                        ? 'text-xs font-bold text-slate-100'
                        : 'text-[10px] font-medium text-slate-400'
                  }
                >
                  {mark.label}
                </span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/75 px-3 py-0.5 text-[11px] font-medium text-slate-300 backdrop-blur-md">
          <Compass className="h-3 w-3 text-sky-400" />
          <span>
            {Math.round(camera.heading)}° {headingToCompass(camera.heading)}
          </span>
          <span className="text-slate-600">•</span>
          <span>Zoom {(1 + camera.zoom).toFixed(1)}x</span>
          {mapillaryImageId && mapillaryAccessToken && (
            <>
              <span className="text-slate-600">•</span>
              <button
                type="button"
                onClick={() => setUseMapillaryView((v) => !v)}
                className="pointer-events-auto text-emerald-400 hover:underline font-semibold"
              >
                {useMapillaryView ? 'Switch to 360° Sphere' : 'Switch to MapillaryJS'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bottom-Center On-Street Movement Chevrons */}
      {availableMoves.length > 0 && !useMapillaryView && (
        <div className="pointer-events-none absolute bottom-7 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-slate-950/70 px-3 py-2 backdrop-blur-md shadow-2xl">
            {availableMoves.map((move) => (
              <button
                key={move.nodeId}
                type="button"
                disabled={disabled}
                onClick={() => onMove({ nodeId: move.nodeId })}
                title={`Move ${move.relativeDirection} (${move.bearingDeg}° ${move.compassDirection})`}
                className="group flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-sky-400/60 hover:bg-sky-500/20 active:scale-95 disabled:opacity-50"
              >
                <Navigation
                  style={{
                    transform: `rotate(${angularDifference(
                      camera.heading,
                      move.bearingDeg
                    )}deg)`,
                  }}
                  className="h-3.5 w-3.5 text-sky-400 transition-transform"
                />
                <span className="capitalize">{move.relativeDirection}</span>
                <span className="text-[10px] text-slate-400">
                  {move.label ? `${move.label} · ` : ''}
                  {move.distanceMeters}m
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom-Left Camera & Navigation Dock */}
      <div className="absolute bottom-5 left-5 z-20 flex flex-col gap-2">
        {/* Directional D-Pad */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/15 bg-slate-950/80 p-1.5 backdrop-blur-md shadow-xl w-fit">
          <div />
          <button
            type="button"
            disabled={disabled || !movesByDirection.has('forward')}
            onClick={() => onMove({ direction: 'forward' })}
            title="Step Forward"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-sky-500/25 disabled:opacity-25 transition"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <div />
          <button
            type="button"
            disabled={disabled || !movesByDirection.has('left')}
            onClick={() => onMove({ direction: 'left' })}
            title="Step Left"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-sky-500/25 disabled:opacity-25 transition"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled || currentNodeId === spawnNodeId}
            onClick={onReturnToStart}
            title="Return to Start"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 disabled:opacity-35 transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={disabled || !movesByDirection.has('right')}
            onClick={() => onMove({ direction: 'right' })}
            title="Step Right"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-sky-500/25 disabled:opacity-25 transition"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <div />
          <button
            type="button"
            disabled={disabled || !movesByDirection.has('backward')}
            onClick={() => onMove({ direction: 'backward' })}
            title="Step Backward"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-sky-500/25 disabled:opacity-25 transition"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <div />
        </div>

        {/* Zoom + Return to Start row */}
        <div className="flex items-center gap-1.5 rounded-2xl border border-white/15 bg-slate-950/80 p-1.5 backdrop-blur-md shadow-xl">
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              applyCamera(camera.heading, camera.pitch, camera.zoom + 0.5)
            }
            title="Zoom In"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-slate-700 transition"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              applyCamera(camera.heading, camera.pitch, camera.zoom - 0.5)
            }
            title="Zoom Out"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-100 hover:bg-slate-700 transition"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onReturnToStart}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 h-8 text-xs font-medium text-slate-200 hover:bg-amber-500/25 hover:text-amber-200 transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Return to Start</span>
          </button>
        </div>
      </div>
    </div>
  );
}
