import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Minus, Navigation, Plus, RotateCcw } from 'lucide-react';
import {
  angularDifference,
  clampCamera,
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
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
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
          const centerY = (0.5 - cur.pitch / 180) * img.naturalHeight;
          const sx = centerX - srcW / 2;
          const sy = Math.max(
            0,
            Math.min(img.naturalHeight - srcH, centerY - srcH / 2)
          );

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
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b1020]">
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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b1020]/60 backdrop-blur-sm">
          <div className="geo-glass px-4 py-2 text-sm text-[#eef1f8] shadow-xl">
            Loading street view…
          </div>
        </div>
      )}

      {/* Bottom-Left Compact Controls: Back to start, Zoom in, Zoom out */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onReturnToStart}
          title="Back to start"
          aria-label="Back to start"
          className="geo-glass grid h-11 w-11 place-items-center text-white hover:border-white/30 disabled:opacity-40 transition"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            applyCamera(camera.heading, camera.pitch, camera.zoom + 0.5)
          }
          title="Zoom in"
          aria-label="Zoom in"
          className="geo-glass grid h-11 w-11 place-items-center text-white hover:border-white/30 disabled:opacity-40 transition"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            applyCamera(camera.heading, camera.pitch, camera.zoom - 0.5)
          }
          title="Zoom out"
          aria-label="Zoom out"
          className="geo-glass grid h-11 w-11 place-items-center text-white hover:border-white/30 disabled:opacity-40 transition"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom-Center: Street Movement Chevrons + Sleek Compass Strip */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-2.5">
        {availableMoves.length > 0 && !useMapillaryView && (
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
            {availableMoves.map((move) => (
              <button
                key={move.nodeId}
                type="button"
                disabled={disabled}
                onClick={() => onMove({ nodeId: move.nodeId })}
                title={`Move ${move.relativeDirection} (${move.distanceMeters}m)`}
                className="geo-glass flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white hover:border-[#22c55e]/60 active:scale-95 disabled:opacity-50 transition"
              >
                <Navigation
                  style={{
                    transform: `rotate(${angularDifference(
                      camera.heading,
                      move.bearingDeg
                    )}deg)`,
                  }}
                  className="h-3.5 w-3.5 text-[#22c55e] transition-transform"
                />
                <span className="capitalize">{move.relativeDirection}</span>
              </button>
            ))}
          </div>
        )}

        <div className="geo-glass relative h-9 w-56 overflow-hidden px-4">
          <div className="absolute left-1/2 top-0 h-1.5 w-0.5 -translate-x-1/2 bg-[#22c55e]" />
          {COMPASS_MARKS.map((mark) => {
            const delta = angularDifference(camera.heading, mark.deg);
            if (Math.abs(delta) > 80) return null;
            const leftPct = 50 + (delta / 78) * 50;
            return (
              <span
                key={mark.label}
                style={{ left: `${leftPct}%` }}
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[13px] tracking-widest ${
                  mark.label === 'N'
                    ? 'font-extrabold text-[#f87171]'
                    : mark.major
                      ? 'font-bold text-[#eef1f8]'
                      : 'text-[11px] text-[#8d97ae]'
                }`}
              >
                {mark.label}
              </span>
            );
          })}
        </div>

        {mapillaryImageId && mapillaryAccessToken && (
          <button
            type="button"
            onClick={() => setUseMapillaryView((v) => !v)}
            className="pointer-events-auto text-xs font-semibold text-[#8d97ae] hover:text-white transition"
          >
            {useMapillaryView ? 'Use 360° Sphere' : 'Use MapillaryJS'}
          </button>
        )}
      </div>
    </div>
  );
}
