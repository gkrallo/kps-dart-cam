import React, { useRef, useEffect, useState } from 'react';

interface CameraFeedProps {
  onVideoReady?: (videoElement: HTMLVideoElement) => void;
  onContainerResize?: (width: number, height: number) => void;
  zoomLevel?: number;
  children?: React.ReactNode;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ onVideoReady, onContainerResize, zoomLevel = 1, children }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    const initCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Prioritera den bakre kameran
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });

        const track = stream.getVideoTracks()[0];
        if (track) {
          videoTrackRef.current = track;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
             videoRef.current?.play();
             if (videoRef.current && onVideoReady) {
               onVideoReady(videoRef.current);
             }
             syncCanvasSize();
          };
        }
      } catch (err) {
        console.error('Kamera åtkomst nekades:', err);
        setError('Kunde inte få åtkomst till kameran. Kontrollera webbläsarens behörigheter. Om du är i en iFrame, försök öppna appen i en ny flik.');
      }
    };

    initCamera();

    window.addEventListener('resize', syncCanvasSize);

    return () => {
      window.removeEventListener('resize', syncCanvasSize);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onVideoReady]);

  // Handle camera optical / digital zoom
  useEffect(() => {
    if (videoTrackRef.current) {
      const track = videoTrackRef.current;
      const capabilities = track.getCapabilities ? (track.getCapabilities() as any) : {};
      
      if (capabilities.zoom) {
        const min = capabilities.zoom.min || 1;
        const max = capabilities.zoom.max || 5;
        const targetZoom = Math.min(Math.max(zoomLevel, min), max);
        
        track.applyConstraints({
          advanced: [{ zoom: targetZoom } as any]
        }).catch((err) => {
          console.log('Hardware zoom not supported or failed, fallback to digital zoom:', err);
        });
      }
    }
  }, [zoomLevel]);

  const syncCanvasSize = () => {
    if (containerRef.current && canvasRef.current) {
      // Use actual layout container rect (unaffected by video CSS transform scale)
      const rect = containerRef.current.getBoundingClientRect();
      canvasRef.current.width = rect.width;
      canvasRef.current.height = rect.height;
      
      if (onContainerResize) {
        onContainerResize(rect.width, rect.height);
      }
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-slate-900 text-red-500 p-4 text-center">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-black flex items-center justify-center">
      {/* Videoström med digital/hårdvaru-zoom support */}
      <video
        ref={videoRef}
        className="absolute top-0 left-0 w-full h-full object-cover transition-transform duration-200"
        style={{ transform: `scale(${zoomLevel})` }}
        autoPlay
        playsInline
        muted
      />
      {/* Canvas överlägg (transparent, används för ritning) */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full object-cover pointer-events-none transition-transform duration-200"
        style={{ transform: `scale(${zoomLevel})` }}
      />
      {children}
    </div>
  );
};
