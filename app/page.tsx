'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Demo } from '@/lib/types';
import { useToast } from '@/components/Toast';

interface DemoWithThumb extends Demo {
  firstImagePath: string | null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
function thumbUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/screenshots/${path}`;
}

export default function Dashboard() {
  const [demos, setDemos] = useState<DemoWithThumb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { toast } = useToast();

  async function loadDemos() {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/demos');
      if (!r.ok) throw new Error('Failed to load');
      setDemos(await r.json());
    } catch {
      setError('Failed to load demos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDemos(); }, []);

  async function createDemo() {
    setCreating(true);
    try {
      const r = await fetch('/api/demos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!r.ok) throw new Error('Failed to create');
      const demo: DemoWithThumb = await r.json();
      router.push(`/build/${demo.id}`);
    } catch {
      toast('Failed to create demo', 'error');
      setCreating(false);
    }
  }

  async function renameDemo(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) { setEditingId(null); return; }
    try {
      const r = await fetch(`/api/demos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!r.ok) throw new Error();
      const updated: DemoWithThumb = await r.json();
      setDemos(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
    } catch {
      toast('Failed to rename demo', 'error');
    }
    setEditingId(null);
  }

  async function deleteDemo(id: string) {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/demos/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      setDemos(prev => prev.filter(d => d.id !== id));
      toast('Demo deleted', 'success');
    } catch {
      toast('Failed to delete demo', 'error');
    }
    setDeletingId(null);
  }

  function startEdit(demo: DemoWithThumb) {
    setEditingId(demo.id);
    setEditValue(demo.title);
    setTimeout(() => editRef.current?.select(), 0);
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">ClickDemo</h1>
          <button
            onClick={createDemo}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {creating ? 'Creating…' : '+ New demo'}
          </button>
        </div>

        {loading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => (
              <div key={i} className="rounded-xl overflow-hidden border border-gray-200 bg-white animate-pulse">
                <div className="aspect-video bg-gray-200" />
                <div className="p-3">
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <span className="text-red-700">{error}</span>
            <button onClick={loadDemos} className="text-red-600 underline text-sm">Retry</button>
          </div>
        )}

        {!loading && !error && demos.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">🎬</div>
            <p className="text-gray-500 text-lg mb-6">No demos yet</p>
            <button
              onClick={createDemo}
              disabled={creating}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Create your first demo
            </button>
          </div>
        )}

        {!loading && !error && demos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {demos.map(demo => (
              <div
                key={demo.id}
                className="group rounded-xl overflow-hidden border border-gray-200 bg-white hover:border-blue-400 hover:shadow-md transition-all cursor-pointer"
                onClick={() => router.push(`/build/${demo.id}`)}
              >
                {/* Thumbnail */}
                <div className="aspect-video bg-gray-100 overflow-hidden relative">
                  {demo.firstImagePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrl(demo.firstImagePath)}
                      alt={demo.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-gray-300">
                        <rect x="4" y="6" width="24" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M4 11h24" stroke="currentColor" strokeWidth="1.5"/>
                        <circle cx="8" cy="8.5" r="1" fill="currentColor"/>
                        <circle cx="12" cy="8.5" r="1" fill="currentColor"/>
                      </svg>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-3 py-2.5">
                  {editingId === demo.id ? (
                    <input
                      ref={editRef}
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => renameDemo(demo.id, editValue)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameDemo(demo.id, editValue);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      className="w-full border-b border-blue-400 outline-none text-gray-900 font-medium text-sm py-0.5 bg-transparent"
                      maxLength={120}
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900 truncate">{demo.title}</p>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-gray-400">
                      {new Date(demo.created_at).toLocaleDateString()}
                    </span>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => startEdit(demo)}
                        className="text-xs text-gray-500 hover:text-gray-800 focus:outline-none"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => { if (confirm(`Delete "${demo.title}"? This can't be undone.`)) deleteDemo(demo.id); }}
                        disabled={deletingId === demo.id}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 focus:outline-none"
                      >
                        {deletingId === demo.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
