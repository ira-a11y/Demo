'use client';

import React from 'react';
import { rectToCss, FractionRect } from '@/lib/coords';

export interface CanvasHotspot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: 'navigate' | 'tooltip';
  target_screen: string | null;
  tooltip_text: string | null;
}

interface HotspotCanvasProps {
  imageUrl: string;
  hotspots: CanvasHotspot[];
  renderOverlay?: (spot: CanvasHotspot, rect: FractionRect) => React.ReactNode;
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: (e: React.MouseEvent<HTMLDivElement>) => void;
  wrapperRef?: React.RefObject<HTMLDivElement | null>;
  cursor?: string;
  className?: string;
}

/** §8 rendering container: image + absolutely-positioned hotspot overlays */
export default function HotspotCanvas({
  imageUrl,
  hotspots,
  renderOverlay,
  onImageLoad,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  wrapperRef,
  cursor = 'default',
  className = '',
}: HotspotCanvasProps) {
  return (
    <div
      ref={wrapperRef}
      className={`relative w-full select-none ${className}`}
      style={{ cursor }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt="Screen"
        className="block w-full h-auto"
        onLoad={onImageLoad}
        draggable={false}
      />
      {hotspots.map(spot => {
        const r: FractionRect = { x: spot.x, y: spot.y, w: spot.w, h: spot.h };
        const css = rectToCss(r);
        return (
          <div
            key={spot.id}
            className="absolute"
            style={{ ...css, pointerEvents: 'none' }}
          >
            {renderOverlay?.(spot, r)}
          </div>
        );
      })}
    </div>
  );
}
