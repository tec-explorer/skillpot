import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { StateResp } from './types';
import { MatrixView } from './views/MatrixView';
import { DoctorView } from './views/DoctorView';
import { AdoptView } from './views/AdoptView';
import { AddView } from './views/AddView';

export interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

type Tab = 'matrix' | 'doctor' | 'adopt' | 'add';

const TABS: { id: Tab; label: string }[] = [
  { id: 'matrix', label: '开关矩阵' },
  { id: 'doctor', label: '体检' },
  { id: 'adopt', label: '收编' },
  { id: 'add', label: '安装' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('matrix');
  const [state, setState] = useState<StateResp | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((text: string, bad = false) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, bad }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4000);
  }, []);

  const reload = useCallback(() => {
    return api<StateResp>('/api/state')
      .then(setState)
      .catch((e: Error) => toast(e.message, true));
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const skillCount = state ? Object.keys(state.skills).length : 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          🍲 SkillPot <span className="ver">v{state?.version ?? '…'}</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'tab active' : 'tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="meta">{skillCount} 个 skill · 中央仓库 ~/.skillpot</div>
      </header>

      <main className="content">
        {!state ? (
          <div className="loading">加载中…（首次会探测本机 Agent，可能需要数秒）</div>
        ) : tab === 'matrix' ? (
          <MatrixView state={state} reload={reload} toast={toast} />
        ) : tab === 'doctor' ? (
          <DoctorView toast={toast} />
        ) : tab === 'adopt' ? (
          <AdoptView reload={reload} toast={toast} />
        ) : (
          <AddView agents={state.matrix.agents} reload={reload} toast={toast} />
        )}
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={t.bad ? 'toast bad' : 'toast'}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
