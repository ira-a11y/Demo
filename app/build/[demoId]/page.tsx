'use client';

import { useEffect, useState, useRef, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { Demo, Screen, Hotspot } from '@/lib/types';
import { useToast } from '@/components/Toast';
import {
  toFraction, rectFromPoints, clampRect, moveRect, resizeRect, nudgeRect,
  rectToCss, FractionRect, isValidRect,
} from '@/lib/coords';
import { validateImageType, validateImageSize } from '@/lib/validation';

type Mode = 'pointer' | 'add';
type SaveStatus = 'saved' | 'saving' | 'error';
type Corner = 'tl' | 'tr' | 'bl' | 'br';

interface UploadTile { tempId: string; file: File; status: 'uploading' | 'error'; error?: string }

export default function BuilderPage({ params }: { params: Promise<{ demoId: string }> }) {
  const { demoId } = use(params);
  const router = useRouter();
  const { toast } = useToast();

  const [demo, setDemo] = useState<Demo | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [hotspots, setHotspots] = useState<Record<string, Hotspot[]>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [activeScreenId, setActiveScreenId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('pointer');
  const [selectedHotspotIds, setSelectedHotspotIds] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  const [uploadTiles, setUploadTiles] = useState<UploadTile[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [titleEdit, setTitleEdit] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [zoom, setZoom] = useState(1);

  const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  function zoomIn() { setZoom(z => ZOOM_STEPS[Math.min(ZOOM_STEPS.indexOf(z) + 1, ZOOM_STEPS.length - 1)] ?? z); }
  function zoomOut() { setZoom(z => ZOOM_STEPS[Math.max(ZOOM_STEPS.indexOf(z) - 1, 0)] ?? z); }

  // Draw state
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ fx: number; fy: number } | null>(null);
  const [drawRect, setDrawRect] = useState<FractionRect | null>(null);

  // Drag/resize state
  const [dragging, setDragging] = useState<{ hotspotId: string; startFx: number; startFy: number; origRect: FractionRect } | null>(null);
  const [resizing, setResizing] = useState<{ hotspotId: string; corner: Corner; startFx: number; startFy: number; origRect: FractionRect } | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<{ startFx: number; startFy: number; rect: FractionRect | null } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceScreenRef = useRef<HTMLInputElement>(null);
  const replacingScreenId = useRef<string | null>(null);
  const copiedHotspots = useRef<Hotspot[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeScreen = screens.find(s => s.id === activeScreenId) ?? null;
  const activeHotspots = activeScreenId ? (hotspots[activeScreenId] ?? []) : [];
  const selectedHotspots = activeHotspots.filter(h => selectedHotspotIds.includes(h.id));
  const selectedHotspot = selectedHotspots.length === 1 ? selectedHotspots[0] : null;

  // Load demo + screens + hotspots
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [dr, sr] = await Promise.all([
          fetch(`/api/demos/${demoId}`),
          fetch(`/api/demos/${demoId}/screens`),
        ]);
        if (!dr.ok) { setNotFound(true); return; }
        const d: Demo = await dr.json();
        if ('error' in d) { setNotFound(true); return; }
        setDemo(d);
        setTitleEdit(d.title);

        if (sr.ok) {
          const ss: Screen[] = await sr.json();
          setScreens(ss);
          if (ss.length > 0) setActiveScreenId(ss[0].id);

          // Load hotspots for all screens
          const hs = await Promise.all(ss.map(s => fetch(`/api/screens/${s.id}/hotspots`).then(r => r.json())));
          const map: Record<string, Hotspot[]> = {};
          ss.forEach((s, i) => { map[s.id] = Array.isArray(hs[i]) ? hs[i] : []; });
          setHotspots(map);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [demoId]);

  // Stable refs — updated every render so the keyboard handler (registered once) always sees fresh data
  const activeHotspotsRef = useRef(activeHotspots);
  const activeScreenIdRef = useRef(activeScreenId);
  const selectedHotspotIdsRef = useRef(selectedHotspotIds);
  const hotspotsRef = useRef(hotspots);
  useEffect(() => { activeHotspotsRef.current = activeHotspots; });
  useEffect(() => { activeScreenIdRef.current = activeScreenId; });
  useEffect(() => { selectedHotspotIdsRef.current = selectedHotspotIds; });
  useEffect(() => { hotspotsRef.current = hotspots; });

  // Undo stack
  const undoStackRef = useRef<Array<{ screenId: string; hotspots: Hotspot[]; selectedIds: string[] }>>([]);
  const lastArrowPushRef = useRef(0);

  function pushUndo() {
    const sid = activeScreenIdRef.current;
    if (!sid) return;
    const snap = (activeHotspotsRef.current ?? []).map(h => ({ ...h }));
    const sel = [...selectedHotspotIdsRef.current];
    // Skip if nothing changed since last entry
    const last = undoStackRef.current.at(-1);
    if (last?.screenId === sid && last.hotspots.length === snap.length &&
        last.hotspots.every((h, i) => h.id === snap[i]?.id && h.x === snap[i]?.x && h.y === snap[i]?.y && h.w === snap[i]?.w && h.h === snap[i]?.h)) return;
    undoStackRef.current = [...undoStackRef.current.slice(-49), { screenId: sid, hotspots: snap, selectedIds: sel }];
  }

  async function performUndo() {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);

    const { screenId, hotspots: prev, selectedIds } = entry;
    const cur = hotspotsRef.current[screenId] ?? [];

    setHotspots(h => ({ ...h, [screenId]: prev }));
    setSelectedHotspotIds(selectedIds);

    const toDelete = cur.filter(c => !prev.find(p => p.id === c.id));
    const toCreate = prev.filter(p => !cur.find(c => c.id === p.id));
    const toModify = prev.filter(p => {
      const c = cur.find(c => c.id === p.id);
      return c && (c.x !== p.x || c.y !== p.y || c.w !== p.w || c.h !== p.h ||
        c.action !== p.action || c.target_screen !== p.target_screen ||
        c.tooltip_text !== p.tooltip_text || c.radius_tl !== p.radius_tl ||
        c.radius_tr !== p.radius_tr || c.radius_br !== p.radius_br || c.radius_bl !== p.radius_bl);
    });

    setSaveStatus('saving');
    try {
      await Promise.all(toDelete.map(h => fetch(`/api/hotspots/${h.id}`, { method: 'DELETE' })));

      for (const h of toCreate) {
        const res = await fetch(`/api/screens/${screenId}/hotspots`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ x: h.x, y: h.y, w: h.w, h: h.h }),
        });
        if (res.ok) {
          const newH: Hotspot = await res.json();
          await fetch(`/api/hotspots/${newH.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: h.action, targetScreen: h.target_screen, tooltipText: h.tooltip_text, radius_tl: h.radius_tl ?? 0, radius_tr: h.radius_tr ?? 0, radius_br: h.radius_br ?? 0, radius_bl: h.radius_bl ?? 0 }),
          });
          setHotspots(hs => ({ ...hs, [screenId]: (hs[screenId] ?? []).map(s => s.id === h.id ? { ...h, id: newH.id } : s) }));
        }
      }

      await Promise.all(toModify.map(h => fetch(`/api/hotspots/${h.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: h.x, y: h.y, w: h.w, h: h.h, action: h.action, targetScreen: h.target_screen, tooltipText: h.tooltip_text, radius_tl: h.radius_tl ?? 0, radius_tr: h.radius_tr ?? 0, radius_br: h.radius_br ?? 0, radius_bl: h.radius_bl ?? 0 }),
      })));
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }

  // Keyboard handler — registered once on mount, reads everything from refs
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditing = ['INPUT', 'TEXTAREA'].includes(tag) || (e.target as HTMLElement)?.isContentEditable;
      const ids = selectedHotspotIdsRef.current;
      const screenId = activeScreenIdRef.current;
      const isMod = e.metaKey || e.ctrlKey;

      // Undo
      if (isMod && e.key === 'z' && !isEditing) {
        e.preventDefault();
        performUndo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length > 0 && !isEditing) {
        e.preventDefault();
        pushUndo();
        const prev = activeHotspotsRef.current;
        setHotspots(h => screenId ? { ...h, [screenId]: (h[screenId] ?? []).filter(x => !ids.includes(x.id)) } : h);
        setSelectedHotspotIds([]);
        Promise.all(ids.map(id => fetch(`/api/hotspots/${id}`, { method: 'DELETE' }))).then(results => {
          if (results.some(r => !r.ok)) setHotspots(h => screenId ? { ...h, [screenId]: prev } : h);
        });
      }

      if (ids.length > 0 && !isEditing && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
        // Push undo only on the first keydown of a hold sequence (debounced 600ms)
        const now = Date.now();
        if (now - lastArrowPushRef.current > 600) { pushUndo(); lastArrowPushRef.current = now; }
        const w = wrapperRef.current?.getBoundingClientRect().width || 1000;
        const h = wrapperRef.current?.getBoundingClientRect().height || 600;
        const pxStep = e.shiftKey ? 5 : 1;
        const dx = (e.key === 'ArrowLeft' ? -pxStep : e.key === 'ArrowRight' ? pxStep : 0) / w;
        const dy = (e.key === 'ArrowUp' ? -pxStep : e.key === 'ArrowDown' ? pxStep : 0) / h;
        const spots = activeHotspotsRef.current.filter(s => ids.includes(s.id));
        if (!spots.length || !screenId) return;
        const moved = spots.map(s => ({ id: s.id, ...nudgeRect({ x: s.x, y: s.y, w: s.w, h: s.h }, dx, dy) }));
        setHotspots(prev => ({ ...prev, [screenId]: (prev[screenId] ?? []).map(s => { const m = moved.find(x => x.id === s.id); return m ? { ...s, ...m } : s; }) }));
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        setSaveStatus('saving');
        saveTimerRef.current = setTimeout(() => {
          Promise.all(moved.map(m => fetch(`/api/hotspots/${m.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x: m.x, y: m.y, w: m.w, h: m.h }),
          }))).then(results => { if (results.every(r => r.ok)) setSaveStatus('saved'); else setSaveStatus('error'); });
        }, 400);
      }

      if (isMod && e.key === 'c' && ids.length > 0 && !isEditing) {
        const spots = activeHotspotsRef.current.filter(s => ids.includes(s.id));
        if (spots.length) copiedHotspots.current = spots.map(s => ({ ...s }));
      }
      if (isMod && e.key === 'v' && !isEditing && screenId) {
        const srcs = copiedHotspots.current;
        if (!srcs.length) return;
        e.preventDefault();
        pushUndo();
        Promise.all(srcs.map(src =>
          fetch(`/api/screens/${screenId}/hotspots`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              x: src.x, y: src.y, w: src.w, h: src.h,
              action: src.action,
              target_screen: src.target_screen,
              tooltip_text: src.tooltip_text,
              radius_tl: src.radius_tl ?? 0,
              radius_tr: src.radius_tr ?? 0,
              radius_br: src.radius_br ?? 0,
              radius_bl: src.radius_bl ?? 0,
            }),
          }).then(r => r.json())
        )).then((created: Hotspot[]) => {
          setHotspots(prev => ({ ...prev, [screenId]: [...(prev[screenId] ?? []), ...created] }));
          setSelectedHotspotIds(created.map(h => h.id));
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function getWrapperRect() { return wrapperRef.current?.getBoundingClientRect() ?? null; }

  // --- Auto-save helpers ---
  function scheduleSave(fn: () => Promise<void>) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try { await fn(); setSaveStatus('saved'); }
      catch { setSaveStatus('error'); toast('Couldn\'t save — check connection', 'error'); }
    }, 400);
  }

  function immediatelySave(fn: () => Promise<void>) {
    setSaveStatus('saving');
    fn().then(() => setSaveStatus('saved')).catch(() => {
      setSaveStatus('error');
      toast('Couldn\'t save — check connection', 'error');
    });
  }

  // --- Title save ---
  async function saveTitle(title: string) {
    const t = title.trim() || 'Untitled demo';
    setDemo(prev => prev ? { ...prev, title: t } : prev);
    setEditingTitle(false);
    await fetch(`/api/demos/${demoId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }),
    });
  }

  // --- Upload ---
  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    for (const file of arr) {
      if (!validateImageType(file.type)) { toast(`${file.name}: unsupported type`, 'error'); continue; }
      if (!validateImageSize(file.size)) { toast(`${file.name}: max 10 MB`, 'error'); continue; }
      const tempId = Math.random().toString(36).slice(2);
      setUploadTiles(prev => [...prev, { tempId, file, status: 'uploading' }]);
      uploadFile(tempId, file);
    }
  }

  async function uploadFile(tempId: string, file: File) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const urlRes = await fetch(`/api/demos/${demoId}/upload-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ext }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { path, signedUrl } = await urlRes.json();

      await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

      // Read dimensions in browser
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });

      const baseName = file.name.replace(/\.[^/.]+$/, '').slice(0, 80) || 'Untitled screen';
      const regRes = await fetch(`/api/demos/${demoId}/screens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: path, width: dims.w, height: dims.h, name: baseName }),
      });
      if (!regRes.ok) throw new Error('Failed to register screen');
      const screen: Screen = await regRes.json();
      setScreens(prev => [...prev, screen]);
      setHotspots(prev => ({ ...prev, [screen.id]: [] }));
      if (!activeScreenId) setActiveScreenId(screen.id);
      setUploadTiles(prev => prev.filter(t => t.tempId !== tempId));
    } catch {
      setUploadTiles(prev => prev.map(t => t.tempId === tempId ? { ...t, status: 'error', error: 'Upload failed' } : t));
    }
  }

  // --- Screen actions ---
  async function renameScreen(id: string, name: string) {
    const t = name.trim();
    if (!t) return;
    setScreens(prev => prev.map(s => s.id === id ? { ...s, name: t } : s));
    immediatelySave(() => fetch(`/api/screens/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: t }),
    }).then(r => { if (!r.ok) throw new Error(); }));
  }

  async function deleteScreen(id: string) {
    if (!confirm('Delete this screen and its hotspots? This can\'t be undone.')) return;
    const prev = screens;
    setScreens(s => s.filter(x => x.id !== id));
    if (activeScreenId === id) {
      const remaining = screens.filter(s => s.id !== id);
      setActiveScreenId(remaining[0]?.id ?? null);
    }
    setSelectedHotspotIds([]);
    try {
      const r = await fetch(`/api/screens/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      setHotspots(h => { const n = { ...h }; delete n[id]; return n; });
    } catch {
      setScreens(prev);
      toast('Failed to delete screen', 'error');
    }
  }

  async function replaceScreen(screenId: string, file: File) {
    if (!validateImageType(file.type)) { toast(`${file.name}: unsupported type`, 'error'); return; }
    if (!validateImageSize(file.size)) { toast(`${file.name}: max 10 MB`, 'error'); return; }
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const urlRes = await fetch(`/api/demos/${demoId}/upload-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ext }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { path, signedUrl } = await urlRes.json();
      await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
      const patchRes = await fetch(`/api/screens/${screenId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagePath: path, width: dims.w, height: dims.h }),
      });
      if (!patchRes.ok) throw new Error('Failed to update screen');
      const updated: Screen = await patchRes.json();
      setScreens(prev => prev.map(s => s.id === screenId ? updated : s));
      toast('Image replaced', 'success');
    } catch {
      toast('Replace failed', 'error');
    }
  }

  async function reorderScreens(newOrder: Screen[]) {
    const prev = screens;
    setScreens(newOrder);
    try {
      const r = await fetch(`/api/demos/${demoId}/screens/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedScreenIds: newOrder.map(s => s.id) }),
      });
      if (!r.ok) throw new Error();
      const updated: Screen[] = await r.json();
      setScreens(updated);
    } catch {
      setScreens(prev);
      toast('Failed to reorder', 'error');
    }
  }

  // --- Hotspot drawing ---
  function onWrapperMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (mode === 'pointer') {
      // Deselect if clicking directly on the wrapper or img (not on a hotspot)
      const target = e.target as HTMLElement;
      if (target === wrapperRef.current || target.tagName === 'IMG') {
        const wRect = getWrapperRect();
        if (!wRect) { setSelectedHotspotIds([]); return; }
        const { fx, fy } = toFraction(e.clientX, e.clientY, wRect);
        setMarquee({ startFx: fx, startFy: fy, rect: null });
        e.preventDefault();
      }
      return;
    }
    if (mode !== 'add') return;
    const rect = getWrapperRect();
    if (!rect) return;
    const { fx, fy } = toFraction(e.clientX, e.clientY, rect);
    setDrawing(true);
    setDrawStart({ fx, fy });
    setDrawRect(null);
    e.preventDefault();
  }

  function onWrapperMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = getWrapperRect();
    if (!rect) return;
    const { fx, fy } = toFraction(e.clientX, e.clientY, rect);

    if (mode === 'add' && drawing && drawStart) {
      setDrawRect(rectFromPoints(drawStart.fx, drawStart.fy, fx, fy));
    }
    if (marquee) {
      setMarquee(prev => prev ? { ...prev, rect: rectFromPoints(prev.startFx, prev.startFy, fx, fy) } : null);
    }
    if (dragging) {
      const { hotspotId, startFx, startFy, origRect } = dragging;
      const moved = moveRect(origRect, fx - startFx, fy - startFy);
      updateHotspotLocal(hotspotId, moved);
    }
    if (resizing) {
      const { hotspotId, corner, startFx, startFy, origRect } = resizing;
      const dfx = fx - startFx, dfy = fy - startFy;
      const resized = resizeRect(origRect, corner, dfx, dfy);
      updateHotspotLocal(hotspotId, resized);
    }
  }

  function updateHotspotLocal(id: string, r: FractionRect) {
    if (activeScreenId) {
      setHotspots(prev => ({
        ...prev,
        [activeScreenId]: (prev[activeScreenId] ?? []).map(h =>
          h.id === id ? { ...h, ...r } : h
        ),
      }));
    }
  }

  async function onWrapperMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    const rect = getWrapperRect();
    if (rect && mode === 'add' && drawing && drawStart && activeScreenId) {
      const { fx, fy } = toFraction(e.clientX, e.clientY, rect);
      const r = rectFromPoints(drawStart.fx, drawStart.fy, fx, fy);
      setDrawing(false); setDrawStart(null); setDrawRect(null);
      if (r.w < 0.01 || r.h < 0.01) return; // too small, discard
      if (!isValidRect(r)) return;
      pushUndo();
      try {
        const res = await fetch(`/api/screens/${activeScreenId}/hotspots`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(r),
        });
        if (!res.ok) throw new Error();
        const hotspot: Hotspot = await res.json();
        setHotspots(prev => ({ ...prev, [activeScreenId]: [...(prev[activeScreenId] ?? []), hotspot] }));
        setSelectedHotspotIds([hotspot.id]);
        setMode('pointer');
        setSaveStatus('saved');
      } catch {
        toast('Failed to create hotspot', 'error');
      }
    }

    if (marquee) {
      const sel = marquee.rect;
      if (sel && (sel.w > 0.005 || sel.h > 0.005)) {
        // Select all hotspots that intersect the marquee rect
        const hits = activeHotspots.filter(h =>
          h.x < sel.x + sel.w && h.x + h.w > sel.x &&
          h.y < sel.y + sel.h && h.y + h.h > sel.y
        );
        setSelectedHotspotIds(hits.map(h => h.id));
      } else {
        // Plain click on empty canvas — deselect
        setSelectedHotspotIds([]);
      }
      setMarquee(null);
    }

    if (dragging) {
      const spot = activeHotspots.find(h => h.id === dragging.hotspotId);
      if (spot) commitHotspotPos(dragging.hotspotId, { x: spot.x, y: spot.y, w: spot.w, h: spot.h });
      setDragging(null);
    }
    if (resizing) {
      const spot = activeHotspots.find(h => h.id === resizing.hotspotId);
      if (spot) commitHotspotPos(resizing.hotspotId, { x: spot.x, y: spot.y, w: spot.w, h: spot.h });
      setResizing(null);
    }
  }

  function commitHotspotPos(id: string, r: FractionRect) {
    immediatelySave(() => fetch(`/api/hotspots/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: r.x, y: r.y, w: r.w, h: r.h }),
    }).then(res => { if (!res.ok) throw new Error(); }));
  }

  function nudgeHotspot(id: string, dx: number, dy: number) {
    const spot = activeHotspots.find(h => h.id === id);
    if (!spot) return;
    const moved = nudgeRect({ x: spot.x, y: spot.y, w: spot.w, h: spot.h }, dx, dy);
    updateHotspotLocal(id, moved);
    scheduleSave(() => fetch(`/api/hotspots/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: moved.x, y: moved.y, w: moved.w, h: moved.h }),
    }).then(res => { if (!res.ok) throw new Error(); }));
  }

  async function deleteHotspot(id: string) {
    if (!activeScreenId) return;
    pushUndo();
    setHotspots(prev => ({ ...prev, [activeScreenId]: (prev[activeScreenId] ?? []).filter(h => h.id !== id) }));
    setSelectedHotspotIds([]);
    toast('Hotspot deleted', 'info');
    try {
      const r = await fetch(`/api/hotspots/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
    } catch {
      toast('Failed to delete hotspot', 'error');
    }
  }

  // Drawer patch
  function patchHotspot(id: string, patch: Partial<Hotspot>) {
    if (!activeScreenId) return;
    setHotspots(prev => ({ ...prev, [activeScreenId]: (prev[activeScreenId] ?? []).map(h => h.id === id ? { ...h, ...patch } : h) }));
    const body: Record<string, unknown> = {};
    if (patch.action !== undefined) body.action = patch.action;
    if (patch.target_screen !== undefined) body.targetScreen = patch.target_screen;
    if (patch.tooltip_text !== undefined) body.tooltipText = patch.tooltip_text;
    if (patch.radius_tl !== undefined) body.radius_tl = patch.radius_tl;
    if (patch.radius_tr !== undefined) body.radius_tr = patch.radius_tr;
    if (patch.radius_br !== undefined) body.radius_br = patch.radius_br;
    if (patch.radius_bl !== undefined) body.radius_bl = patch.radius_bl;
    if (patch.layover_image_path !== undefined) body.layoverImagePath = patch.layover_image_path;
    if (patch.layover_full_screen !== undefined) body.layoverFullScreen = patch.layover_full_screen;
    scheduleSave(() => fetch(`/api/hotspots/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(res => { if (!res.ok) throw new Error(); }));
  }

  // Rail drag-to-reorder (simple state)
  const dragScreenRef = useRef<string | null>(null);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-400 animate-pulse">Loading builder…</div>
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4">
      <p className="text-gray-500">Demo not found.</p>
      <button onClick={() => router.push('/')} className="text-blue-600 underline">Back to dashboard</button>
    </div>
  );

  const slug = demo?.public_slug ?? '';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const shareUrl = `${baseUrl}/demo/${slug}`;

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#EEEEEE' }}>
      {/* Toolbar */}
      <header className="border-b px-4 py-2 flex items-center gap-4 shrink-0" style={{ background: '#FAFAFA', borderColor: '#D8D8D8' }}>
        <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-800 text-sm focus:outline-none rounded" aria-label="Back to dashboard">
          ← Dashboard
        </button>
        {editingTitle ? (
          <input
            autoFocus
            value={titleEdit}
            onChange={e => setTitleEdit(e.target.value)}
            onBlur={() => saveTitle(titleEdit)}
            onKeyDown={e => { if (e.key === 'Enter') saveTitle(titleEdit); if (e.key === 'Escape') { setTitleEdit(demo?.title ?? ''); setEditingTitle(false); } }}
            className="outline-none font-semibold text-gray-900 bg-transparent w-48 border-b"
            style={{ borderColor: '#B6D4D6' }}
            maxLength={120}
          />
        ) : (
          <span className="font-semibold text-gray-900 cursor-pointer hover:opacity-70" onClick={() => setEditingTitle(true)}>{demo?.title ?? ''}</span>
        )}
        <div className="flex-1" />
        {/* Mode toggle */}
        <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: '#E4E4E4' }}>
          <button
            onClick={() => setMode('pointer')}
            title="Pointer — select & move hotspots"
            className={`px-3 py-1.5 rounded transition-colors focus:outline-none
              ${mode === 'pointer' ? 'shadow text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
            style={mode === 'pointer' ? { background: '#FAFAFA' } : {}}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 1L13 8.5L8.2 9.6L6 14L3 1Z" fill="currentColor"/>
            </svg>
          </button>
          <button
            onClick={() => setMode('add')}
            title="Add hotspot — draw a new region"
            className={`px-3 py-1.5 rounded transition-colors focus:outline-none
              ${mode === 'add' ? 'shadow text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
            style={mode === 'add' ? { background: '#FAFAFA' } : {}}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="1" fill="currentColor"/>
              <line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="flex-1" />
        {/* Zoom controls */}
        <div className="flex items-center gap-1 rounded-lg px-1 border" style={{ borderColor: '#D8D8D8' }}>
          <button onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]} className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-800 disabled:opacity-30 rounded focus:outline-none" aria-label="Zoom out">−</button>
          <span className="text-xs text-gray-600 w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-gray-800 disabled:opacity-30 rounded focus:outline-none" aria-label="Zoom in">+</button>
        </div>

        <div className="w-px h-5" style={{ background: '#D8D8D8' }} />
        <span className={`text-xs ${saveStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
          {saveStatus === 'saved' ? 'All changes saved' : saveStatus === 'saving' ? 'Saving…' : 'Couldn\'t save — retry'}
        </span>
        <button onClick={() => setShowShare(true)} className="px-3 py-1.5 rounded text-sm font-medium text-gray-900 focus:outline-none" style={{ background: '#F7F859' }}>Share</button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Screen Rail */}
        <aside className="w-52 border-r flex flex-col overflow-y-auto shrink-0" style={{ background: '#FAFAFA', borderColor: '#D8D8D8' }}>
          <div className="p-2 border-b" style={{ borderColor: '#EEEEEE' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-1.5 border border-dashed rounded text-sm text-gray-500 hover:text-gray-800 focus:outline-none transition-colors"
              style={{ borderColor: '#B6D4D6' }}
            >
              + Upload
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
            <input ref={replaceScreenRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f && replacingScreenId.current) replaceScreen(replacingScreenId.current, f);
                replacingScreenId.current = null;
                e.target.value = '';
              }} />
          </div>
          <ul className="flex-1 p-1 space-y-1">
            {uploadTiles.map(t => (
              <li key={t.tempId} className="border rounded p-1 text-xs text-gray-500" style={{ background: '#F3F3F3', borderColor: '#D8D8D8' }}>
                {t.status === 'uploading' ? (
                  <div className="flex items-center gap-1"><span className="animate-spin">⟳</span> {t.file.name.slice(0, 20)}</div>
                ) : (
                  <div>
                    <p className="text-red-500 truncate">{t.error}</p>
                    <div className="flex gap-1 mt-0.5">
                      <button onClick={() => uploadFile(t.tempId, t.file)} className="text-blue-500 underline">Retry</button>
                      <button onClick={() => setUploadTiles(prev => prev.filter(x => x.tempId !== t.tempId))} className="text-gray-400 underline">Dismiss</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {screens.map((screen, idx) => (
              <RailTile
                key={screen.id}
                screen={screen}
                isFirst={idx === 0}
                isActive={screen.id === activeScreenId}
                onSelect={() => { setActiveScreenId(screen.id); setSelectedHotspotIds([]); }}
                onRename={name => renameScreen(screen.id, name)}
                onDelete={() => deleteScreen(screen.id)}
                onReplace={() => { replacingScreenId.current = screen.id; replaceScreenRef.current?.click(); }}
                onDragStart={() => { dragScreenRef.current = screen.id; }}
                onDrop={() => {
                  if (!dragScreenRef.current || dragScreenRef.current === screen.id) return;
                  const fromId = dragScreenRef.current;
                  const fromIdx = screens.findIndex(s => s.id === fromId);
                  const toIdx = idx;
                  if (fromIdx === -1) return;
                  const arr = [...screens];
                  const [item] = arr.splice(fromIdx, 1);
                  arr.splice(toIdx, 0, item);
                  reorderScreens(arr);
                  dragScreenRef.current = null;
                }}
              />
            ))}
          </ul>
          {screens.length === 0 && uploadTiles.length === 0 && (
            <div className="p-4 text-xs text-gray-400 text-center">Upload a screenshot to start building your demo</div>
          )}
        </aside>

        {/* Canvas */}
        <main className="flex-1 overflow-auto">
          {!activeScreen ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-400">
              <p>Upload a screenshot to start building your demo.</p>
              <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 rounded text-gray-900 font-medium" style={{ background: '#F7F859' }}>Upload image</button>
            </div>
          ) : (
            <div className="p-6">
            <div style={{ width: `${Math.round(zoom * 100)}%`, minWidth: 200, margin: '0 auto', transition: 'width 0.15s' }}>
              {activeHotspots.length === 0 && (
                <p className="text-xs text-center text-gray-400 mb-2">Switch to Add hotspot and drag on the image to create a click region</p>
              )}
              <div
                ref={wrapperRef}
                className="relative w-full select-none"
                style={{ cursor: mode === 'add' ? 'crosshair' : marquee ? 'crosshair' : 'default' }}
                onMouseDown={onWrapperMouseDown}
                onMouseMove={onWrapperMouseMove}
                onMouseUp={onWrapperMouseUp}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getPublicUrl(activeScreen.image_path)} alt={activeScreen.name} className="block w-full h-auto" draggable={false} />

                {/* Hotspot overlays */}
                {activeHotspots.map(spot => {
                  const css = rectToCss(spot);
                  const isSelected = selectedHotspotIds.includes(spot.id);
                  return (
                    <div
                      key={spot.id}
                      className="absolute transition-colors"
                      style={{
                        ...css,
                        zIndex: isSelected ? 20 : 10,
                        pointerEvents: mode === 'pointer' ? 'auto' : 'none',
                        cursor: mode === 'pointer' ? 'move' : undefined,
                        borderRadius: `${spot.radius_tl ?? 0}px ${spot.radius_tr ?? 0}px ${spot.radius_br ?? 0}px ${spot.radius_bl ?? 0}px`,
                        border: isSelected
                          ? '0.5px dashed #3b82f6'
                          : spot.action === 'tooltip'
                          ? '0.5px dashed rgba(96,165,250,0.7)'
                          : '0.5px dashed rgba(250,204,21,0.8)',
                        backgroundColor: isSelected
                          ? 'rgba(59,130,246,0.08)'
                          : spot.action === 'tooltip'
                          ? 'rgba(96,165,250,0.08)'
                          : 'rgba(250,204,21,0.08)',
                      }}
                      onMouseDown={e => {
                        if (mode !== 'pointer') return;
                        e.stopPropagation();
                        if (e.shiftKey) {
                          setSelectedHotspotIds(prev => prev.includes(spot.id) ? prev.filter(id => id !== spot.id) : [...prev, spot.id]);
                          return;
                        }
                        pushUndo();
                        setSelectedHotspotIds([spot.id]);
                        const wRect = getWrapperRect();
                        if (!wRect) return;
                        const { fx, fy } = toFraction(e.clientX, e.clientY, wRect);
                        setDragging({ hotspotId: spot.id, startFx: fx, startFy: fy, origRect: { x: spot.x, y: spot.y, w: spot.w, h: spot.h } });
                      }}
                      onClick={e => { if (mode === 'pointer' && !e.shiftKey) { e.stopPropagation(); } }}
                    >
                      {/* Corner resize handles */}
                      {isSelected && (['tl','tr','bl','br'] as Corner[]).map(corner => (
                        <div
                          key={corner}
                          className="absolute w-3 h-3 bg-blue-500 border border-white rounded-sm"
                          style={{
                            top: corner.startsWith('t') ? -6 : undefined,
                            bottom: corner.startsWith('b') ? -6 : undefined,
                            left: corner.endsWith('l') ? -6 : undefined,
                            right: corner.endsWith('r') ? -6 : undefined,
                            cursor: `${corner}-resize`,
                          }}
                          onMouseDown={e => {
                            e.stopPropagation();
                            pushUndo();
                            const wRect = getWrapperRect();
                            if (!wRect) return;
                            const { fx, fy } = toFraction(e.clientX, e.clientY, wRect);
                            setResizing({ hotspotId: spot.id, corner, startFx: fx, startFy: fy, origRect: { x: spot.x, y: spot.y, w: spot.w, h: spot.h } });
                            setDragging(null);
                          }}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* Draw preview */}
                {drawing && drawRect && (
                  <div
                    className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
                    style={{ ...rectToCss(drawRect), zIndex: 30 }}
                  />
                )}

                {/* Marquee selection */}
                {marquee?.rect && (marquee.rect.w > 0.002 || marquee.rect.h > 0.002) && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      ...rectToCss(marquee.rect),
                      zIndex: 40,
                      border: '1.5px dashed #3b82f6',
                      backgroundColor: 'rgba(59,130,246,0.07)',
                    }}
                  />
                )}

              </div>
            </div>
            </div>
          )}
        </main>

        {/* Right drawer — always present */}
        {drawerOpen ? (
          <HotspotDrawer
            hotspot={selectedHotspot}
            selectedHotspots={selectedHotspots}
            screens={screens}
            activeScreenId={activeScreenId ?? ''}
            demoId={demoId}
            onPatch={patch => { if (selectedHotspot) { pushUndo(); patchHotspot(selectedHotspot.id, patch); } }}
            onPatchMany={patch => { pushUndo(); selectedHotspots.forEach(h => patchHotspot(h.id, patch)); }}
            onDelete={() => { if (selectedHotspot) deleteHotspot(selectedHotspot.id); }}
            onDeleteMany={() => { pushUndo(); selectedHotspots.forEach(h => deleteHotspot(h.id)); }}
            onClose={() => setDrawerOpen(false)}
          />
        ) : (
          /* Floating reopen tab */
          <button
            onClick={() => setDrawerOpen(true)}
            title="Open inspector"
            className="absolute right-0 top-1/2 -translate-y-1/2 border border-r-0 rounded-l-lg px-1.5 py-3 shadow text-gray-400 hover:text-gray-700 focus:outline-none z-10"
            style={{ background: '#FAFAFA', borderColor: '#D8D8D8' }}
            style={{ writingMode: 'vertical-rl' }}
          >
            Inspector
          </button>
        )}
      </div>

      {/* Share modal */}
      {showShare && (
        <ShareModal url={shareUrl} onClose={() => setShowShare(false)} />
      )}

    </div>
  );
}

function getPublicUrl(path: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  return `${url}/storage/v1/object/public/screenshots/${path}`;
}

// --- Rail tile ---
function RailTile({ screen, isFirst, isActive, onSelect, onRename, onDelete, onReplace, onDragStart, onDrop }:
  { screen: Screen; isFirst: boolean; isActive: boolean; onSelect: () => void; onRename: (n: string) => void; onDelete: () => void; onReplace: () => void; onDragStart: () => void; onDrop: () => void }
) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(screen.name);
  const [dragOver, setDragOver] = useState(false);
  const imgUrl = getPublicUrl(screen.image_path);

  return (
    <li
      draggable
      onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop(); }}
      onDragEnd={() => setDragOver(false)}
      onClick={onSelect}
      className="rounded border cursor-grab active:cursor-grabbing transition-all p-1"
      style={{
        borderColor: dragOver ? '#B6D4D6' : isActive ? '#B6D4D6' : '#E0E0E0',
        background: dragOver ? 'rgba(182,212,214,0.18)' : isActive ? 'rgba(182,212,214,0.15)' : '#FAFAFA',
        transform: dragOver ? 'scale(1.02)' : undefined,
      }}
    >
      {isFirst && <span className="text-[10px] font-semibold uppercase tracking-wide px-0.5" style={{ color: '#6aabae' }}>Start</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imgUrl} alt={screen.name} className="w-full h-20 object-cover rounded" loading="lazy" />
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={() => { onRename(val); setEditing(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { onRename(val); setEditing(false); }
            if (e.key === 'Escape') { setVal(screen.name); setEditing(false); }
          }}
          onClick={e => e.stopPropagation()}
          className="w-full text-xs text-gray-900 outline-none mt-3 bg-transparent border-b"
          style={{ borderColor: '#B6D4D6' }}
          maxLength={80}
        />
      ) : (
        <p className="text-xs text-gray-700 truncate mt-3 px-0.5" onDoubleClick={e => { e.stopPropagation(); setEditing(true); }}>{screen.name}</p>
      )}
      <div className="flex gap-2 mt-1">
        <button
          onClick={e => { e.stopPropagation(); onReplace(); }}
          className="text-[10px] focus:outline-none hover:opacity-70"
          style={{ color: '#5fa0a3' }}
          aria-label="Replace image"
        >Replace</button>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="text-[10px] text-red-400 hover:text-red-600 focus:outline-none"
          aria-label="Delete screen"
        >Delete</button>
      </div>
    </li>
  );
}

// --- Hotspot drawer ---
function DestinationPicker({ screens, activeScreenId, value, onChange }: {
  screens: Screen[]; activeScreenId: string; value: string | null; onChange: (id: string) => void;
}) {
  const [previewScreen, setPreviewScreen] = useState<Screen | null>(null);

  return (
    <div>
      <label className="text-xs text-gray-500 font-medium mb-1.5 block">Destination screen</label>
      <div className="flex flex-col gap-1">
        {screens.map(s => {
          const isCurrent = s.id === activeScreenId;
          const isSelected = s.id === value;
          return (
            <div
              key={s.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors cursor-pointer
                ${isCurrent ? 'opacity-40 cursor-not-allowed border-gray-100 bg-gray-50' : isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
              onClick={() => { if (!isCurrent) onChange(s.id); }}
            >
              <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                ${isSelected ? 'border-blue-500' : 'border-gray-300'}`}>
                {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 block" />}
              </span>
              <span className="flex-1 text-xs text-gray-800 truncate">{s.name}{isCurrent ? ' (current)' : ''}</span>
              {!isCurrent && (
                <button
                  onClick={e => { e.stopPropagation(); setPreviewScreen(prev => prev?.id === s.id ? null : s); }}
                  className="text-[10px] text-gray-400 hover:text-blue-500 underline focus:outline-none flex-shrink-0"
                >
                  {previewScreen?.id === s.id ? 'Hide' : 'Preview'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!value && <p className="text-xs text-yellow-600 mt-1">No destination set — hotspot will be inert</p>}

      {/* Preview popup */}
      {previewScreen && (
        <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 relative">
          <div className="flex items-center justify-between px-2 py-1 bg-gray-100 border-b border-gray-200">
            <span className="text-[10px] text-gray-500 font-medium truncate">{previewScreen.name}</span>
            <button onClick={() => setPreviewScreen(null)} className="text-gray-400 hover:text-gray-600 text-sm leading-none focus:outline-none">×</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={getPublicUrl(previewScreen.image_path)} alt={previewScreen.name} className="w-full h-auto max-h-48 object-contain" />
        </div>
      )}
    </div>
  );
}

function HotspotDrawer({ hotspot, selectedHotspots, screens, activeScreenId, demoId, onPatch, onPatchMany, onDelete, onDeleteMany, onClose }:
  { hotspot: Hotspot | null; selectedHotspots: Hotspot[]; screens: Screen[]; activeScreenId: string; demoId: string; onPatch: (p: Partial<Hotspot>) => void; onPatchMany: (p: Partial<Hotspot>) => void; onDelete: () => void; onDeleteMany: () => void; onClose: () => void }
) {
  const [tooltipVal, setTooltipVal] = useState(hotspot?.tooltip_text ?? '');
  const [showTooltip, setShowTooltip] = useState(!!(hotspot?.tooltip_text));
  const [radiusLinked, setRadiusLinked] = useState(true);
  const [corners, setCorners] = useState({ tl: 0, tr: 0, br: 0, bl: 0 });
  const [layoverUploading, setLayoverUploading] = useState(false);
  const layoverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTooltipVal(hotspot?.tooltip_text ?? '');
    setShowTooltip(!!(hotspot?.tooltip_text));
    setCorners({
      tl: hotspot?.radius_tl ?? 0,
      tr: hotspot?.radius_tr ?? 0,
      br: hotspot?.radius_br ?? 0,
      bl: hotspot?.radius_bl ?? 0,
    });
  }, [hotspot?.id, hotspot?.tooltip_text, hotspot?.radius_tl, hotspot?.radius_tr, hotspot?.radius_br, hotspot?.radius_bl]);

  async function uploadLayover(file: File) {
    if (!hotspot) return;
    setLayoverUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const urlRes = await fetch(`/api/demos/${demoId}/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext }),
      });
      if (!urlRes.ok) throw new Error('Failed to get upload URL');
      const { signedUrl, path } = await urlRes.json();
      const putRes = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!putRes.ok) throw new Error('Upload failed');
      onPatch({ layover_image_path: path });
    } catch {
      alert('Image upload failed. Please try again.');
    } finally {
      setLayoverUploading(false);
    }
  }

  function commitCorners(next: typeof corners) {
    onPatch({ radius_tl: next.tl, radius_tr: next.tr, radius_br: next.br, radius_bl: next.bl });
  }

  return (
    <aside className="w-64 border-l flex flex-col shrink-0" style={{ background: '#FAFAFA', borderColor: '#D8D8D8' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#EEEEEE' }}>
        <h3 className="font-medium text-gray-800 text-sm">Inspector</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none focus:outline-none rounded" aria-label="Close inspector">×</button>
      </div>

      {selectedHotspots.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
          <div className="text-2xl">↖</div>
          <p className="text-xs text-gray-400">Select a hotspot to edit it. Shift+click to multi-select.</p>
        </div>
      ) : selectedHotspots.length > 1 ? (
        <MultiSelectPanel hotspots={selectedHotspots} onPatchMany={onPatchMany} onDeleteMany={onDeleteMany} />
      ) : hotspot ? (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

          {/* Action at top */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1.5 block">Action on click</label>
            <div className="flex rounded-lg p-0.5 gap-0.5" style={{ background: '#E8E8E8' }}>
              {([['navigate','Go to screen'],['tooltip','Tooltip'],['layover','Layover']] as const).map(([a, label]) => (
                <button
                  key={a}
                  onClick={() => onPatch({ action: a })}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors focus:outline-none"
                  style={hotspot.action === a ? { background: '#F7F859', color: '#111' } : { color: '#888' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Destination (navigate only) */}
          {hotspot.action === 'navigate' && (
            <DestinationPicker
              screens={screens}
              activeScreenId={activeScreenId}
              value={hotspot.target_screen}
              onChange={id => onPatch({ target_screen: id || null })}
            />
          )}

          {/* Layover image (layover only) */}
          {hotspot.action === 'layover' && (
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1.5 block">Layover image</label>
              <input
                ref={layoverInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadLayover(f); e.target.value = ''; }}
              />
              {hotspot.layover_image_path ? (
                <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-gray-50">
                  <img
                    src={getPublicUrl(hotspot.layover_image_path)}
                    alt="Layover preview"
                    className="w-full h-28 object-contain"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <button
                    onClick={() => onPatch({ layover_image_path: null })}
                    className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-black/80 focus:outline-none"
                    title="Remove image"
                  >×</button>
                  <button
                    onClick={() => layoverInputRef.current?.click()}
                    className="absolute bottom-1 right-1 bg-black/60 text-white rounded text-xs px-2 py-0.5 hover:bg-black/80 focus:outline-none"
                  >Replace</button>
                </div>
              ) : (
                <button
                  onClick={() => layoverInputRef.current?.click()}
                  disabled={layoverUploading}
                  className="w-full border-2 border-dashed rounded-lg py-4 text-xs text-gray-400 hover:opacity-80 transition-colors focus:outline-none disabled:opacity-50"
                  style={{ borderColor: '#B6D4D6' }}
                >
                  {layoverUploading ? 'Uploading…' : '+ Upload image'}
                </button>
              )}
              {hotspot.layover_image_path && (
                <div className="mt-2 flex flex-col gap-1">
                  <label className="text-xs text-gray-500 font-medium">Size</label>
                  {([true, false] as const).map(full => (
                    <button
                      key={String(full)}
                      onClick={() => onPatch({ layover_full_screen: full })}
                      className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border transition-colors focus:outline-none"
                      style={{ borderColor: hotspot.layover_full_screen === full ? '#B6D4D6' : '#E0E0E0', background: hotspot.layover_full_screen === full ? 'rgba(182,212,214,0.15)' : 'transparent', color: hotspot.layover_full_screen === full ? '#2d7a7e' : '#666' }}
                    >
                      <span className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                        style={{ borderColor: hotspot.layover_full_screen === full ? '#B6D4D6' : '#ccc' }}>
                        {hotspot.layover_full_screen === full && <span className="w-1.5 h-1.5 rounded-full block" style={{ background: '#B6D4D6' }} />}
                      </span>
                      {full ? 'Cover screen' : 'Keep original size'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Divider */}
          <div className="border-t" style={{ borderColor: '#EEEEEE' }} />

          {/* Optional tooltip */}
          <div>
            <button
              onClick={() => {
                const next = !showTooltip;
                setShowTooltip(next);
                if (!next) { setTooltipVal(''); onPatch({ tooltip_text: null }); }
              }}
              className="flex items-center gap-2 w-full text-left group focus:outline-none"
            >
              <div className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0 transition-colors"
                style={{ background: showTooltip ? '#B6D4D6' : 'transparent', borderColor: showTooltip ? '#B6D4D6' : '#ccc', color: '#fff' }}>
                {showTooltip && '✓'}
              </div>
              <span className="text-xs font-medium text-gray-600 group-hover:text-gray-800">Add tooltip on hover</span>
            </button>

            {showTooltip && (
              <div className="mt-2">
                <textarea
                  value={tooltipVal}
                  maxLength={280}
                  onChange={e => setTooltipVal(e.target.value)}
                  onBlur={() => onPatch({ tooltip_text: tooltipVal || null })}
                  className="w-full rounded-lg px-2 py-1.5 text-sm text-gray-900 resize-none h-20 focus:outline-none border"
                  style={{ borderColor: '#D8D8D8', background: '#F5F5F5' }}
                  placeholder="Text shown when hovering…"
                />
                <p className="text-xs text-gray-400 text-right">{tooltipVal.length}/280</p>
              </div>
            )}
          </div>

          {/* Corner radius */}
          <div className="border-t pt-4" style={{ borderColor: '#EEEEEE' }}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">Corner radius</label>
              <button
                onClick={() => setRadiusLinked(l => !l)}
                title={radiusLinked ? 'Unlock corners' : 'Lock all corners'}
                className={`w-7 h-7 flex items-center justify-center rounded transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 ${radiusLinked ? 'text-blue-500 bg-blue-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
              >
                {radiusLinked ? (
                  /* Linked: two chain links connected */
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6.5 9.5L4.5 11.5a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.3-.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    <path d="M9.5 6.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                ) : (
                  /* Unlinked: broken chain */
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M6.5 9.5L4.5 11.5a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.3-.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    <path d="M9.5 6.5l2-2a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    <line x1="6" y1="6" x2="6" y2="4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                    <line x1="10" y1="12" x2="10" y2="10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                )}
              </button>
            </div>

            {radiusLinked ? (
              <div className="flex items-center rounded-lg overflow-hidden border" style={{ borderColor: '#D8D8D8', background: '#F5F5F5' }}>
                <input
                  type="number" min={0} max={999} step={1}
                  value={corners.tl}
                  onChange={e => {
                    const v = Math.max(0, Math.min(999, parseInt(e.target.value, 10) || 0));
                    const next = { tl: v, tr: v, br: v, bl: v };
                    setCorners(next);
                  }}
                  onBlur={() => commitCorners(corners)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm text-gray-900 text-center outline-none bg-transparent"
                />
                <span className="pr-2 text-xs text-gray-400 pointer-events-none">px</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {([['tl','↖'],['tr','↗'],['bl','↙'],['br','↘']] as [keyof typeof corners, string][]).map(([key, icon]) => (
                  <div key={key} className="flex items-center gap-1 rounded-lg px-2 py-1.5 border" style={{ borderColor: '#D8D8D8', background: '#F5F5F5' }}>
                    <span className="text-xs text-gray-400 select-none">{icon}</span>
                    <input
                      type="number" min={0} max={999} step={1}
                      value={corners[key]}
                      onChange={e => {
                        const v = Math.max(0, Math.min(999, parseInt(e.target.value, 10) || 0));
                        setCorners(prev => ({ ...prev, [key]: v }));
                      }}
                      onBlur={() => commitCorners(corners)}
                      className="flex-1 min-w-0 outline-none text-sm text-gray-900 text-center bg-transparent"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="mt-auto pt-2 border-t" style={{ borderColor: '#EEEEEE' }}>
            <button
              onClick={onDelete}
              className="text-sm text-red-400 hover:text-red-600 focus:outline-none rounded"
            >
              Delete hotspot
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

// --- Multi-select panel ---
function MultiSelectPanel({ hotspots, onPatchMany, onDeleteMany }:
  { hotspots: Hotspot[]; onPatchMany: (p: Partial<Hotspot>) => void; onDeleteMany: () => void }
) {
  const allW = hotspots.map(h => h.w);
  const allH = hotspots.map(h => h.h);
  const sameW = allW.every(v => Math.abs(v - allW[0]) < 0.0001);
  const sameH = allH.every(v => Math.abs(v - allH[0]) < 0.0001);

  const [wVal, setWVal] = useState(sameW ? Math.round(allW[0] * 1000) / 10 : '');
  const [hVal, setHVal] = useState(sameH ? Math.round(allH[0] * 1000) / 10 : '');

  useEffect(() => {
    setWVal(sameW ? Math.round(allW[0] * 1000) / 10 : '');
    setHVal(sameH ? Math.round(allH[0] * 1000) / 10 : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots.map(h => h.id).join(','), hotspots.map(h => h.w).join(','), hotspots.map(h => h.h).join(',')]);

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      <p className="text-xs text-gray-500 font-medium">{hotspots.length} hotspots selected</p>

      <div>
        <label className="text-xs text-gray-500 font-medium mb-2 block">Size (% of screen)</label>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-gray-400 mb-1">Width</p>
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <input
                type="number" min={1} max={100} step={0.1}
                value={wVal}
                placeholder="—"
                onChange={e => setWVal(e.target.value === '' ? '' : Number(e.target.value))}
                onBlur={() => {
                  const n = parseFloat(String(wVal));
                  if (!isNaN(n) && n > 0 && n <= 100) onPatchMany({ w: n / 100 });
                }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm text-gray-900 text-center outline-none bg-transparent"
              />
              <span className="pr-2 text-xs text-gray-400 pointer-events-none">%</span>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 mb-1">Height</p>
            <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
              <input
                type="number" min={1} max={100} step={0.1}
                value={hVal}
                placeholder="—"
                onChange={e => setHVal(e.target.value === '' ? '' : Number(e.target.value))}
                onBlur={() => {
                  const n = parseFloat(String(hVal));
                  if (!isNaN(n) && n > 0 && n <= 100) onPatchMany({ h: n / 100 });
                }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className="flex-1 min-w-0 px-2 py-1.5 text-sm text-gray-900 text-center outline-none bg-transparent"
              />
              <span className="pr-2 text-xs text-gray-400 pointer-events-none">%</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">Sets the same size on all selected hotspots</p>
      </div>

      <div className="mt-auto pt-2 border-t" style={{ borderColor: '#EEEEEE' }}>
        <button
          onClick={onDeleteMany}
          className="text-sm text-red-400 hover:text-red-600 focus:outline-none rounded"
        >
          Delete {hotspots.length} hotspots
        </button>
      </div>
    </div>
  );
}

// --- Share modal ---
function ShareModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="rounded-xl p-6 w-full max-w-md shadow-xl" style={{ background: '#FAFAFA' }} onClick={e => e.stopPropagation()}>
        <h2 className="font-semibold text-gray-900 mb-1">Share demo</h2>
        <p className="text-xs text-gray-400 mb-4">Anyone with this link can view the demo. No sign-in required.</p>
        <div className="flex gap-2">
          <input readOnly value={url} className="flex-1 rounded px-3 py-2 text-sm text-gray-700 focus:outline-none border" style={{ background: '#EEEEEE', borderColor: '#D8D8D8' }} />
          <button
            onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="px-3 py-2 rounded text-sm font-medium text-gray-900 focus:outline-none"
            style={{ background: '#F7F859' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => window.open(url, '_blank')}
            className="flex items-center gap-1.5 px-3 py-2 rounded text-sm text-gray-700 hover:opacity-80 focus:outline-none border"
            style={{ borderColor: '#D8D8D8', background: '#EEEEEE' }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Review
          </button>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600 focus:outline-none">Close</button>
        </div>
      </div>
    </div>
  );
}
