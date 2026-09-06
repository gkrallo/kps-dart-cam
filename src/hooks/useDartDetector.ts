import { useEffect, useRef, RefObject } from 'react';
import { Point } from '../types';

export const useDartDetector = (
  cv: any,
  videoElement: HTMLVideoElement | null,
  transformMatrix: any | null,
  isActive: boolean,
  motionThreshold: number,
  debugCanvasRef: RefObject<HTMLCanvasElement | null>,
  onDartDetected: (tip: Point) => void,
  onDebugState?: (state: string, noise: number) => void
) => {
  const baselineMatRef = useRef<any>(null);
  const previousMatRef = useRef<any>(null);
  const isStabilizingRef = useRef(false);
  const lastMotionTimeRef = useRef(0);
  const loopIdRef = useRef<number>(0);
  const targetSize = 800;
  
  const motionThresholdRef = useRef(motionThreshold);
  useEffect(() => {
    motionThresholdRef.current = motionThreshold;
  }, [motionThreshold]);

  // We keep track of all detected darts to draw them continuously on the debug canvas
  const detectedDartsRef = useRef<Point[]>([]);

  // When inactive (e.g. user recalibrating), clear our tracking state
  useEffect(() => {
    if (!isActive) {
      if (baselineMatRef.current) {
        baselineMatRef.current.delete();
        baselineMatRef.current = null;
      }
      if (previousMatRef.current) {
        previousMatRef.current.delete();
        previousMatRef.current = null;
      }
      detectedDartsRef.current = [];
      isStabilizingRef.current = false;
    }
  }, [isActive]);

  useEffect(() => {
    if (!cv || !videoElement || !transformMatrix || !isActive || !debugCanvasRef.current) return;

    const hiddenCanvas = document.createElement('canvas');
    const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) return;

    const dsize = new cv.Size(targetSize, targetSize);
    
    const warpedMat = new cv.Mat();
    const grayMat = new cv.Mat();
    const diffMat = new cv.Mat();
    const threshMat = new cv.Mat();
    const diffPreviousMat = new cv.Mat();
    const threshPreviousMat = new cv.Mat();
    
    let isCleanedUp = false;

    // Set initial baseline
    hiddenCanvas.width = videoElement.videoWidth;
    hiddenCanvas.height = videoElement.videoHeight;
    ctx.drawImage(videoElement, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
    let tempMat = cv.imread(hiddenCanvas);
    cv.warpPerspective(tempMat, warpedMat, transformMatrix, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));
    cv.cvtColor(warpedMat, grayMat, cv.COLOR_RGBA2GRAY);
    
    if (baselineMatRef.current) baselineMatRef.current.delete();
    if (previousMatRef.current) previousMatRef.current.delete();
    baselineMatRef.current = grayMat.clone();
    previousMatRef.current = grayMat.clone();
    tempMat.delete();
    
    const processFrame = () => {
      if (isCleanedUp) return;
      
      if (!videoElement || videoElement.paused || videoElement.ended) {
        loopIdRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      // Grab current frame
      hiddenCanvas.width = videoElement.videoWidth;
      hiddenCanvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
      tempMat = cv.imread(hiddenCanvas);
      
      // Warp perspective and convert to grayscale
      cv.warpPerspective(tempMat, warpedMat, transformMatrix, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 255));
      cv.cvtColor(warpedMat, grayMat, cv.COLOR_RGBA2GRAY);
      tempMat.delete();
      
      // 1. Baseline Noise (for dart detection)
      cv.absdiff(grayMat, baselineMatRef.current, diffMat);
      cv.threshold(diffMat, threshMat, 30, 255, cv.THRESH_BINARY);
      const baselineNoise = cv.countNonZero(threshMat);
      
      // 2. Movement Noise (frame-to-frame for stability)
      let movementNoise = 0;
      if (previousMatRef.current) {
        cv.absdiff(grayMat, previousMatRef.current, diffPreviousMat);
        cv.threshold(diffPreviousMat, threshPreviousMat, 30, 255, cv.THRESH_BINARY);
        movementNoise = cv.countNonZero(threshPreviousMat);
      }
      
      // Update previous mat
      if (previousMatRef.current) previousMatRef.current.delete();
      previousMatRef.current = grayMat.clone();
      
      const now = performance.now();
      let currentState = 'STABLE';
      
      if (movementNoise > motionThresholdRef.current) {
        // Active motion detected
        lastMotionTimeRef.current = now;
        isStabilizingRef.current = true;
        currentState = 'MOTION';
      } else {
        // Scene is physically still (no major frame-to-frame movement)
        if (baselineNoise > 500) {
          // There is a difference from the baseline
          if (!isStabilizingRef.current) {
            isStabilizingRef.current = true;
            lastMotionTimeRef.current = now;
          }
          
          if (now - lastMotionTimeRef.current > 500) {
            isStabilizingRef.current = false;
            currentState = 'ANALYZING';
            
            // Lower threshold slightly to better capture the full shape of the dart
            cv.threshold(diffMat, threshMat, 15, 255, cv.THRESH_BINARY);
            cv.GaussianBlur(threshMat, threshMat, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
            
            const contours = new cv.MatVector();
            const hierarchy = new cv.Mat();
            cv.findContours(threshMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            let maxArea = 0;
            let maxContourIdx = -1;
            for (let i = 0; i < contours.size(); ++i) {
              const area = cv.contourArea(contours.get(i));
              if (area > maxArea) {
                maxArea = area;
                maxContourIdx = i;
              }
            }
            
            if (maxContourIdx !== -1 && maxArea > 100) {
              if (maxArea < 15000) { // Ignore massive changes like shadows/hands
                const dartContour = contours.get(maxContourIdx);
                let closestPoint = { x: 0, y: 0 };
                let minDistance = Infinity;
                const center = { x: targetSize / 2, y: targetSize / 2 };
                
                for (let i = 0; i < dartContour.rows; ++i) {
                  const pt = {
                    x: dartContour.data32S[i * 2],
                    y: dartContour.data32S[i * 2 + 1]
                  };
                  const dist = Math.pow(pt.x - center.x, 2) + Math.pow(pt.y - center.y, 2);
                  if (dist < minDistance) {
                    minDistance = dist;
                    closestPoint = pt;
                  }
                }
                
                detectedDartsRef.current.push(closestPoint);
                onDartDetected(closestPoint);
              } else {
                console.log("Ignored large contour (area:", maxArea, ") - likely a shadow or hand.");
              }
            }
            
            contours.delete();
            hierarchy.delete();
            
            // Update baseline after settling
            baselineMatRef.current.delete();
            baselineMatRef.current = grayMat.clone();
          } else {
            currentState = 'STABILIZING';
          }
        } else {
          // No movement and no significant diff
          isStabilizingRef.current = false;
          currentState = 'STABLE';
        }
      }
      
      if (onDebugState) {
        onDebugState(currentState, movementNoise);
      }

      const centerPt = new cv.Point(targetSize / 2, targetSize / 2);

      // Draw official 2D dartboard wireframe overlay on the warped 800x800 matrix
      // Double Ring (360px - 385px)
      cv.circle(warpedMat, centerPt, 385, new cv.Scalar(59, 130, 246, 255), 2);
      cv.circle(warpedMat, centerPt, 360, new cv.Scalar(96, 165, 250, 255), 1);
      // Triple Ring (216px - 242px)
      cv.circle(warpedMat, centerPt, 242, new cv.Scalar(239, 68, 68, 255), 2);
      cv.circle(warpedMat, centerPt, 216, new cv.Scalar(248, 113, 113, 255), 1);
      // Bullseye Rings (16px & 38px)
      cv.circle(warpedMat, centerPt, 38, new cv.Scalar(34, 197, 94, 255), 2);
      cv.circle(warpedMat, centerPt, 16, new cv.Scalar(239, 68, 68, 255), -1);

      // Radial Sector Lines
      for (let i = 0; i < 20; i++) {
        const rad = ((i * 18 - 9 - 90) * Math.PI) / 180;
        const p1 = new cv.Point(
          targetSize / 2 + 38 * Math.cos(rad),
          targetSize / 2 + 38 * Math.sin(rad)
        );
        const p2 = new cv.Point(
          targetSize / 2 + 385 * Math.cos(rad),
          targetSize / 2 + 385 * Math.sin(rad)
        );
        cv.line(warpedMat, p1, p2, new cv.Scalar(148, 163, 184, 180), 1);
      }

      // Draw all detected darts with crosshair reticles & vibrant markers
      detectedDartsRef.current.forEach((pt, idx) => {
        const dartPt = new cv.Point(pt.x, pt.y);
        // Outer target ring
        cv.circle(warpedMat, dartPt, 16, new cv.Scalar(239, 68, 68, 255), 2);
        // Inner dot
        cv.circle(warpedMat, dartPt, 6, new cv.Scalar(34, 197, 94, 255), -1);
        // Crosshair ticks
        cv.line(warpedMat, new cv.Point(pt.x - 22, pt.y), new cv.Point(pt.x + 22, pt.y), new cv.Scalar(255, 255, 255, 255), 1);
        cv.line(warpedMat, new cv.Point(pt.x, pt.y - 22), new cv.Point(pt.x, pt.y + 22), new cv.Scalar(255, 255, 255, 255), 1);
        // Dart number badge
        cv.putText(
          warpedMat,
          `P${idx + 1}`,
          new cv.Point(pt.x + 10, pt.y - 10),
          cv.FONT_HERSHEY_SIMPLEX,
          0.7,
          new cv.Scalar(255, 255, 0, 255),
          2
        );
      });

      // Visual indicator of motion (red border during movement)
      if (isStabilizingRef.current || currentState === 'MOTION') {
        cv.rectangle(warpedMat, new cv.Point(5, 5), new cv.Point(targetSize - 5, targetSize - 5), new cv.Scalar(0, 0, 255, 255), 10);
      }
      
      // Show the result in our debug canvas
      if (debugCanvasRef.current) {
        cv.imshow(debugCanvasRef.current, warpedMat);
      }
      
      loopIdRef.current = requestAnimationFrame(processFrame);
    };
    
    loopIdRef.current = requestAnimationFrame(processFrame);
    
    return () => {
      isCleanedUp = true;
      cancelAnimationFrame(loopIdRef.current);
      warpedMat.delete();
      grayMat.delete();
      diffMat.delete();
      threshMat.delete();
      diffPreviousMat.delete();
      threshPreviousMat.delete();
    };
  }, [cv, videoElement, transformMatrix, isActive, debugCanvasRef, onDartDetected]);
};
