/* eslint-disable @next/next/no-html-link-for-pages -- Full document navigation resets the existing harness client and its event subscriptions. */
'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { ArrowUp, ChevronDown, ChevronLeft, ExternalLink, FolderOpen, History, Mic, Plus, RotateCcw, Settings, UserRound, X } from 'lucide-react';
import { projectHref } from './project-url';

export default function Workspace({ name, preview, demo, initialError }: { name: string; preview: string; demo: boolean; initialError: string }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const [retry, setRetry] = useState(0);
  const settings = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!demo) return;
    const controller = new AbortController();
    fetch('/api/invoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'git:history' }), signal: controller.signal })
      .then(async (res) => { if (!res.ok || !(await res.json()).ok) throw new Error(); setConnected(true); setConnectionError(''); })
      .catch(() => { if (!controller.signal.aborted) setConnectionError('Start the desktop harness on port 5173, then reconnect.'); });
    return () => controller.abort();
  }, [demo, retry]);

  // Foreign projects: editing enables only on a supervised match — the
  // harness actively runs THIS project and the iframe shows its proxy URL.
  // A stale/bookmarked ?preview= (dead port, unsupervised server) stays
  // preview-only instead of failing edits confusingly.
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const norm = (u: string) => u.replace(/\/+$/, '');
    fetch('/api/projects/active', { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json();
        const v = body.value;
        if (body.ok && v && v.name === name && norm(v.previewUrl) === norm(preview)) {
          setConnected(true);
          setConnectionError('');
        } else {
          setConnected(false);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setConnectionError('Start the desktop harness on port 5173, then reconnect.'); });
    return () => controller.abort();
  }, [demo, name, preview, retry]);

  return (
    <main className={`project-workspace bg-blueprint-grid ${historyOpen ? 'with-history' : ''}`}>
      <header className="workspace-header" data-gaze-overlay>
        <div className="workspace-project workspace-glass">
          <a href="/gallery" className="icon-button" aria-label="Back to projects"><ChevronLeft size={18} /></a>
          <span className="project-divider" />
          <details className="project-menu"><summary><span className="project-name">{name}</span><ChevronDown size={14} /></summary><div className="workspace-menu workspace-glass"><a href="/gallery"><FolderOpen size={16} /> View projects</a><button onClick={() => settings.current?.showModal()}><Settings size={16} /> Project settings</button></div></details>
        </div>
        <div className="workspace-view-label"><span className="status-dot" />{demo ? 'Live playground' : 'Local preview'}</div>
        <button className={`icon-button workspace-glass history-toggle ${historyOpen ? 'is-active' : ''}`} aria-label="Version history" aria-expanded={historyOpen} aria-controls="version-history" onClick={() => setHistoryOpen(!historyOpen)}><History size={20} /></button>
      </header>

      <section className="preview-area" aria-label="Project preview">
        <div className="preview-address"><span className="status-dot" /><span>{demo ? 'localhost:5173 / demo' : preview || 'No preview connected'}</span><div><button className="icon-button" aria-label="Reload preview" disabled={!preview} onClick={() => { if (frame.current) frame.current.src = preview; }}><RotateCcw size={14} /></button>{preview && <a href={preview} target="_blank" rel="noreferrer" className="icon-button" aria-label="Open preview in a new tab"><ExternalLink size={14} /></a>}</div></div>
        {preview && connected ? <iframe ref={frame} id="preview" title={`${name} live preview`} src={preview} /> : <div className="preview-empty"><span className="empty-orbit"><span className="workspace-brand">e</span></span><h1>{demo ? 'Your playground is almost ready.' : 'A space for your next idea.'}</h1><p>{initialError || connectionError || (demo ? 'Connecting to the live preview…' : preview ? 'This preview is not supervised — open the project from the gallery to start its server and enable editing.' : 'Connect your localhost dev server to see your project here.')}</p>{connectionError ? <button className="workspace-primary" onClick={() => setRetry(retry + 1)}>Reconnect</button> : !demo && preview && !connected ? <a className="workspace-primary" href="/gallery">Open gallery</a> : !demo && !preview && <button className="workspace-primary" onClick={() => settings.current?.showModal()}>Connect preview</button>}</div>}
      </section>

      <aside id="version-history" className="history-panel workspace-glass" hidden={!historyOpen} data-gaze-overlay>
        <div className="history-heading"><div><p className="workspace-eyebrow">Your progress</p><h2>Version history</h2></div><button className="icon-button" aria-label="Close history" onClick={() => setHistoryOpen(false)}><X size={18} /></button></div>
        <button id="new-version" className="save-version" disabled={!connected}><Plus size={16} /> New version</button>
        <p className="history-caption">{demo ? 'Edits and saved versions from your playground.' : 'Version history becomes available when source editing is connected.'}</p>
        <ol id="history" className="version-list" />
      </aside>

      <footer className="workspace-footer" data-gaze-overlay>
        <details className="account-menu"><summary className="icon-button workspace-glass" aria-label="Account menu"><UserRound size={20} /></summary><div className="workspace-menu workspace-glass"><p>gaze workspace</p><a href="/gallery"><FolderOpen size={16} /> View projects</a><button onClick={() => settings.current?.showModal()}><Settings size={16} /> Settings</button></div></details>
        <div className="voice-dock workspace-glass">
          <div className="voice-status"><span className="voice-wave" aria-hidden><i /><i /><i /><i /><i /></span><span id="status" role="status">{demo || connected ? 'Click an element, then describe your change.' : 'Preview mode · open from the gallery to edit'}</span></div>
          <div id="point" className="point-status">{demo || connected ? 'Click the preview to select a target' : 'Your dev server stays in control'}</div>
          <div id="fail" role="alert" className="workspace-error" style={{ display: 'none' }} />
          {connected && connectionError && <p role="alert" className="workspace-error">{connectionError}</p>}
          <div className="voice-input"><label className="sr-only" htmlFor="transcript">Describe your change</label><input id="transcript" placeholder={demo || connected ? 'Tell gaze what to change…' : 'Open from the gallery to enable editing'} disabled={!connected} /><button id="mic-toggle" className="icon-button mic-button" disabled={!connected} aria-label="Toggle microphone"><Mic size={18} /></button><button id="send" className="send-button" disabled={!connected} aria-label="Apply change"><ArrowUp size={18} /></button></div>
          <span id="mic" className="mic-status">{demo || connected ? 'Mic off · browser speech' : 'Preview only'}</span>
        </div>
        <button id="undo" className="undo-circle workspace-glass" style={{ display: 'none' }} aria-label="Undo last edit"><RotateCcw size={20} /> Undo</button>
      </footer>

      <dialog ref={settings} className="project-settings workspace-glass">
        <div className="history-heading"><h2>Project settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => settings.current?.close()}><X size={18} /></button></div>
        <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); try { window.location.assign(projectHref(name, String(data.get('preview')))); } catch (err) { setSettingsError(err instanceof Error ? err.message : 'Invalid address.'); } }}>
          <label htmlFor="settings-preview">Localhost preview address</label><input id="settings-preview" name="preview" type="url" defaultValue={demo ? 'http://localhost:5173/demo/preview.html' : preview} placeholder="http://localhost:3001" required />
          <p className="field-hint">Use a different port from gaze. The project must allow embedding in an iframe. Custom previews do not enable source editing.</p>
          {settingsError && <p role="alert" className="workspace-error">{settingsError}</p>}
          <button type="submit" className="workspace-primary">Connect preview</button>
        </form>
      </dialog>
      {/* ponytail: reuse the existing harness client and its contract-backed controls. */}
      {connected && <Script src="/harness/src/renderer.js" type="module" onError={() => setConnectionError('Could not load the editor controls. Reload to reconnect.')} />}
    </main>
  );
}
