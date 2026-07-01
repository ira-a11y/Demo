'use client';

import { useEffect, useState, useRef, use } from 'react';
import { ViewerBundle, ViewerScreen, ViewerHotspot } from '@/lib/types';
import { rectToCss } from '@/lib/coords';

export default function ViewerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [currentScreenId, setCurrentScreenId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/public/${slug}`)
      .then(async r => {
        if (!r.ok) { setNotFound(true); return; }
        const data: ViewerBundle = await r.json();
        if ('error' in data) { setNotFound(true); return; }
        setBundle(data);
        const start = [...data.screens].sort((a, b) => a.orderIndex - b.orderIndex)[0];
        if (start) setCurrentScreenId(start.id);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-400">Loading…</div>
  );

  if (notFound || !bundle) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white gap-4">
      <h1 className="text-xl font-semibold">This demo isn't available</h1>
      <p className="text-gray-400 text-sm">The link may be incorrect or the demo was deleted.</p>
    </div>
  );

  if (bundle.screens.length === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white gap-4">
      <h1 className="text-xl font-semibold">Demo has no screens yet</h1>
      <p className="text-gray-400 text-sm">Check back later.</p>
    </div>
  );

  const currentScreen = bundle.screens.find(s => s.id === currentScreenId) ?? bundle.screens[0];
  const startScreen = [...bundle.screens].sort((a, b) => a.orderIndex - b.orderIndex)[0];

  function navigate(targetId: string) {
    setHistory(h => [...h, currentScreenId!]);
    setCurrentScreenId(targetId);
    setTooltip(null);
  }

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setCurrentScreenId(prev);
    setTooltip(null);
  }

  function restart() {
    setHistory([]);
    setCurrentScreenId(startScreen.id);
    setTooltip(null);
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col" onClick={() => setTooltip(null)}>
      {/* Chrome */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-800 border-b border-gray-700 shrink-0">
        <span className="text-white font-medium text-sm truncate max-w-xs">{bundle.demo.title}</span>
        <div className="flex gap-2">
          <button
            onClick={goBack}
            disabled={history.length === 0}
            className="px-3 py-1.5 text-sm text-gray-300 border border-gray-600 rounded hover:bg-gray-700 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            ← Back
          </button>
          <button
            onClick={restart}
            className="px-3 py-1.5 text-sm text-gray-300 border border-gray-600 rounded hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            ↺ Restart
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-start justify-center overflow-auto p-6">
        <div className="w-full">
          <ScreenCanvas
            screen={currentScreen}
            onNavigate={navigate}
            onTooltip={(text, x, y) => setTooltip({ text, x, y })}
            onHideTooltip={() => setTooltip(null)}
          />
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-800 text-white text-sm px-3 py-2 rounded shadow-lg pointer-events-none whitespace-pre-wrap break-words"
          style={{
            maxWidth: 240,
            top: tooltip.y + 12,
            ...(tooltip.x + 260 > window.innerWidth
              ? { right: window.innerWidth - tooltip.x + 8, left: 'auto' }
              : { left: tooltip.x + 12 }),
          }}
          onClick={e => e.stopPropagation()}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

function ScreenCanvas({ screen, onNavigate, onTooltip, onHideTooltip }:
  { screen: ViewerScreen; onNavigate: (id: string) => void; onTooltip: (text: string, x: number, y: number) => void; onHideTooltip: () => void }
) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapperRef} className="relative w-full select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={screen.imageUrl} alt={screen.name} className="block w-full h-auto" draggable={false} />
      {screen.hotspots.map(spot => (
        <ViewerHotspotEl
          key={spot.id}
          spot={spot}
          onNavigate={onNavigate}
          onTooltip={onTooltip}
          onHideTooltip={onHideTooltip}
        />
      ))}
    </div>
  );
}

function ViewerHotspotEl({ spot, onNavigate, onTooltip, onHideTooltip }:
  { spot: ViewerHotspot; onNavigate: (id: string) => void; onTooltip: (t: string, x: number, y: number) => void; onHideTooltip: () => void }
) {
  const [hovered, setHovered] = useState(false);
  const [layoverOpen, setLayoverOpen] = useState(false);
  const css = rectToCss({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
  const isNavigate = spot.action === 'navigate';
  const isLayover = spot.action === 'layover';
  const hasTarget = isNavigate && !!spot.targetScreen;
  const hasTooltip = !!spot.tooltipText;
  const cursor = (hasTarget || isLayover) ? 'pointer' : 'default';

  return (
    <>
      <div
        className="absolute"
        style={{
          ...css,
          cursor,
          backgroundColor: hovered ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0)',
          transition: 'background-color 0.1s',
          borderRadius: `${spot.radiusTl ?? 0}px ${spot.radiusTr ?? 0}px ${spot.radiusBr ?? 0}px ${spot.radiusBl ?? 0}px`,
        }}
        onMouseEnter={e => {
          setHovered(true);
          if (hasTooltip) onTooltip(spot.tooltipText!, e.clientX, e.clientY);
        }}
        onMouseMove={e => {
          if (hasTooltip) onTooltip(spot.tooltipText!, e.clientX, e.clientY);
        }}
        onMouseLeave={() => {
          setHovered(false);
          onHideTooltip();
        }}
        onClick={e => {
          e.stopPropagation();
          if (isNavigate && spot.targetScreen) onNavigate(spot.targetScreen);
          if (isLayover && spot.layoverImageUrl) setLayoverOpen(true);
        }}
      />

      {/* Layover overlay */}
      {layoverOpen && spot.layoverImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setLayoverOpen(false)}
        >
          {spot.layoverFullScreen ? (
            <img
              src={spot.layoverImageUrl}
              alt="Layover"
              className="absolute inset-0 w-full h-full object-cover"
              draggable={false}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <img
              src={spot.layoverImageUrl}
              alt="Layover"
              className="max-w-full max-h-full object-contain"
              draggable={false}
              onClick={e => e.stopPropagation()}
            />
          )}
          <button
            onClick={() => setLayoverOpen(false)}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 text-lg leading-none focus:outline-none"
            aria-label="Close"
          >×</button>
        </div>
      )}
    </>
  );
}
