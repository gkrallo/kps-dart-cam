import React, { useRef, useEffect, useState, useCallback } from 'react';

export interface ZoomCapability {
  supported: boolean;
  min: number;
  max: number;
  step: number;
}

interface CameraFeedProps {
  onVideoReady?: (videoElement: HTMLVideoElement) => void;
  onContainerResize?: (width: number, height: number) => void;
  onZoomCapability?: (cap: ZoomCapability) => void;
  zoomLevel?: number;
  children?: React.ReactNode;
}

/**
 * Kameravy med hårdvaruzoom.
 *
 * OBS: här finns med flit INGEN CSS-transform för zoom. Tidigare gjordes både
 * hårdvaruzoom OCH `transform: scale()`, medan koordinatmatematiken bara
 * kompenserade för den ena - vilket gav dubbel zoom och en felaktig homografi
 * på varje telefon som stödjer zoom-constraint. Hårdvaruzoom ger dessutom
 * riktiga pixlar; CSS-zoom beskär bara bilden.
 */
export const CameraFeed: React.FC<CameraFeedProps> = ({
  onVideoReady,
  onContainerResize,
  onZoomCapability,
  zoomLevel = 1,
  children,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncSize = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    onContainerResize?.(rect.width, rect.height);
  }, [onContainerResize]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    const initCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          'Den här webbläsaren ger ingen kameraåtkomst. Kameran kräver HTTPS - ' +
            'öppna appen via https:// eller localhost.',
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment',
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getVideoTracks()[0] ?? null;
        videoTrackRef.current = track;

        const caps: any = track?.getCapabilities?.() ?? {};
        onZoomCapability?.(
          caps.zoom
            ? {
                supported: true,
                min: caps.zoom.min ?? 1,
                max: Math.min(caps.zoom.max ?? 3, 5),
                step: caps.zoom.step || 0.1,
              }
            : { supported: false, min: 1, max: 1, step: 0.1 },
        );

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play().catch(() => undefined);
            onVideoReady?.(video);
            syncSize();
          };
        }
      } catch (err) {
        console.error('Kameraåtkomst nekades:', err);
        setError(
          'Kunde inte få åtkomst till kameran. Kontrollera behörigheterna i webbläsaren. ' +
            'Kameran kräver dessutom HTTPS.',
        );
      }
    };

    initCamera();
    window.addEventListener('resize', syncSize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', syncSize);
      stream?.getTracks().forEach((track) => track.stop());
      videoTrackRef.current = null;
    };
  }, [onVideoReady, onZoomCapability, syncSize]);

  // Hårdvaruzoom
  useEffect(() => {
    const track = videoTrackRef.current;
    if (!track) return;
    const caps: any = track.getCapabilities?.() ?? {};
    if (!caps.zoom) return;

    const target = Math.min(Math.max(zoomLevel, caps.zoom.min ?? 1), caps.zoom.max ?? 1);
    track
      .applyConstraints({ advanced: [{ zoom: target } as any] })
      .catch((err) => console.warn('Hårdvaruzoom misslyckades:', err));
  }, [zoomLevel]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-slate-900 text-red-400 p-6 text-center text-sm">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        playsInline
        muted
      />
      {children}
    </div>
  );
};
