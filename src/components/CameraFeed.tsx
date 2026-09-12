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
  /** Först när videon levererar bildrutor är det säkert att röra zoomen. */
  const [videoReady, setVideoReady] = useState(false);

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
            setVideoReady(true);
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

  // Android Chrome PAUSAR videoelementet när appen går i bakgrunden (byte till
  // annan app, skärmen slocknar) och återupptar det INTE när man kommer
  // tillbaka. Strömmen mår bra - spåret är "live", omutat och aktivt, och
  // video.readyState är 4 - men `paused` är true, så detektorn analyserar
  // samma frusna bildruta i evighet och ingen pil kan hittas. Appen ser
  // levande ut (React och rAF-loopen går som vanligt), vilket gör felet
  // extra lömskt. Uppmätt på Kristians S25 2026-09-12: efter ett appbyte
  // stod video.currentTime helt still medan rAF gick i 60 fps.
  //
  // Skärmlåset håller dessutom skärmen tänd, så att fallet inte uppstår bara
  // för att telefonen lämnas i stativet mellan turerna.
  useEffect(() => {
    const video = videoRef.current;
    let lock: { released?: boolean; release?: () => Promise<void> } | null = null;

    const resume = () => {
      const v = videoRef.current;
      if (v && v.paused) v.play().catch(() => undefined);
    };

    const acquireLock = async () => {
      try {
        const wl = (navigator as any).wakeLock;
        if (wl) lock = await wl.request('screen');
      } catch {
        // Nekas bl.a. när sidan är i bakgrunden. Inte kritiskt.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      resume();
      if (!lock || lock.released) void acquireLock();
    };

    document.addEventListener('visibilitychange', onVisibility);
    video?.addEventListener('pause', resume);
    void acquireLock();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      video?.removeEventListener('pause', resume);
      void lock?.release?.().catch(() => undefined);
    };
  }, []);

  // Hårdvaruzoom. Väntar på att videon FAKTISKT levererar bildrutor:
  // applyConstraints på ett spår som ännu inte hunnit starta låser strömmen
  // på Galaxy S25 - `track.readyState` blir "live" men videoelementet står
  // kvar på readyState 0, `play()` returnerar ett promise som aldrig löses,
  // och bilden är svart. Uppmätt 2026-09-12 när en sparad kalibrering började
  // återställa zoomen direkt vid uppstart.
  useEffect(() => {
    const track = videoTrackRef.current;
    if (!track || !videoReady) return;
    const caps: any = track.getCapabilities?.() ?? {};
    if (!caps.zoom) return;

    const target = Math.min(Math.max(zoomLevel, caps.zoom.min ?? 1), caps.zoom.max ?? 1);
    track
      .applyConstraints({ advanced: [{ zoom: target } as any] })
      .catch((err) => console.warn('Hårdvaruzoom misslyckades:', err));
  }, [zoomLevel, videoReady]);

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
