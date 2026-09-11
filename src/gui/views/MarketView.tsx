import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { AddResult, MarketSkill, SourceInfo } from '../types';
import { Toast } from '../App';
import { MarketPreviewModal } from './MarketPreviewModal';

interface Props {
  /** SSE 变更序号:变化时重新扫描(命中本地克隆缓存,秒回) */
  rev: number;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

const PAGE_SIZE = 20;

export function MarketView({ rev, reload, toast }: Props) {
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [skills, setSkills] = useState<MarketSkill[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [clonedNote, setClonedNote] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<MarketSkill | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const loadSources = useCallback(async (): Promise<SourceInfo[]> => {
    const r = await api<{ sources: SourceInfo[] }>('/api/market/sources');
    setSources(r.sources);
    return r.sources;
  }, []);

  const scan = useCallback(
    async (url: string, refresh = false) => {
      setScanning(true);
      setSkills(null);
      setVisible(PAGE_SIZE);
      try {
        const r = await api<{ skills: MarketSkill[]; cloned: boolean }>(
          `/api/market/scan?url=${encodeURIComponent(url)}${refresh ? '&refresh=1' : ''}`,
        );
        setSkills(r.skills);
        setClonedNote(r.cloned ? '已重新克隆' : '来自本地缓存');
      } catch (e) {
        toast((e as Error).message, true);
        setSkills([]);
      } finally {
        setScanning(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadSources()
      .then((list) => {
        if (list.length) {
          setSelected(list[0].url);
        }
      })
      .catch((e: Error) => toast(e.message, true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) scan(selected);
  }, [selected, scan, rev]);

  const pickSource = (url: string) => {
    if (url !== selected) setSelected(url);
  };

  const addSource = async () => {
    if (!newUrl.trim()) return;
    try {
      const r = await api<{ source: SourceInfo }>('/api/market/sources/add', {
        method: 'POST',
        body: { url: newUrl.trim(), name: newName.trim() || undefined },
      });
      toast(`已添加源 ${r.source.name}`);
      setNewUrl('');
      setNewName('');
      setShowAdd(false);
      const list = await loadSources();
      setSelected(r.source.url);
      void list;
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const removeSource = async (url: string) => {
    if (!window.confirm('确认移除该自定义源？（不会卸载已安装的 skill）')) return;
    try {
      await api('/api/market/sources/remove', { method: 'POST', body: { url } });
      const list = await loadSources();
      if (selected === url) setSelected(list.length ? list[0].url : '');
      toast('已移除源');
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const install = async (s: MarketSkill) => {
    if (installing) return;
    setInstalling(s.subdir);
    try {
      const r = await api<AddResult>('/api/market/install', {
        method: 'POST',
        body: { url: selected, subdir: s.subdir },
      });
      toast(`已安装 ${r.name}`);
      setSkills((prev) =>
        prev ? prev.map((p) => (p.subdir === s.subdir ? { ...p, installed: true } : p)) : prev,
      );
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setInstalling(null);
    }
  };

  const filteredSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills ?? [];
    return (skills ?? []).filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.subdir.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const visibleSkills = useMemo(
    () => filteredSkills.slice(0, visible),
    [filteredSkills, visible],
  );

  if (!sources) return <div className="loading">加载源…</div>;
  const current = sources.find((s) => s.url === selected);

  return (
    <div className="panel market-panel">
      <div className="doctor-head">
        <div>
          <h2>技能市场 (Market)</h2>
          <div className="dim small">浏览生态开源与官方技能，一键拉取并安装至本地中央仓库</div>
        </div>
        <div className="doctor-actions">
          <button className="btn small-btn subtle" onClick={() => setShowAdd((v) => !v)}>
            {showAdd ? '取消' : '+ 添加源'}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="form-row add-source-row">
          <input
            className="input grow"
            placeholder="Git 仓库地址，如 https://github.com/owner/skills.git"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
          <input
            className="input"
            style={{ width: 160 }}
            placeholder="名称（可选）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn small-btn primary" onClick={addSource} disabled={!newUrl.trim()}>
            确定添加
          </button>
        </div>
      )}

      <div className="market-sources-bar">
        <div className="sources-list">
          {sources.map((s) => (
            <button
              key={s.url}
              className={s.url === selected ? 'source-pill active' : 'source-pill'}
              onClick={() => pickSource(s.url)}
              title={s.url}
            >
              <span>{s.name}</span>
              {s.builtin && <span className="source-builtin-badge">内置</span>}
            </button>
          ))}
        </div>
        {current && !current.builtin && (
          <button className="bulk-pill-btn danger" onClick={() => removeSource(current.url)}>
            移除此源
          </button>
        )}
      </div>

      <div className="market-repo-card">
        <div className="repo-meta">
          <span className="repo-url mono" title={selected}>{selected}</span>
          <span className="repo-cache-tag">{clonedNote || '缓存就绪'}</span>
        </div>
        <button className="btn small-btn" onClick={() => scan(selected, true)} disabled={scanning}>
          {scanning ? '克隆/扫描中…' : '刷新缓存'}
        </button>
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <input
          className="input grow"
          placeholder="搜索名称 / 说明 / 子目录…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisible(PAGE_SIZE);
          }}
        />
        <span className="dim small">
          {scanning
            ? '扫描中…'
            : `${filteredSkills.length}/${(skills ?? []).length} 项`}
        </span>
      </div>

      {!skills ? null : skills.length === 0 ? (
        <p className="dim">该仓库中没有找到 SKILL.md 技能目录。</p>
      ) : (
        <>
          {visibleSkills.length === 0 ? (
            <p className="dim">没有匹配的 skill（换个关键词试试）。</p>
          ) : (
            <table className="matrix update-table">
              <thead>
                <tr>
                  <th className="skill-col">Skill 技能</th>
                  <th>说明</th>
                  <th style={{ width: 150 }}>子目录</th>
                  <th style={{ width: 140, textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleSkills.map((s) => (
                  <tr key={s.subdir}>
                    <td
                      className="skill-name link"
                      title="点击查看详情与提示词"
                      onClick={() => setPreviewSkill(s)}
                    >
                      <div className="skill-market-title">
                        <span>{s.name}</span>
                        {s.installed && <span className="badge-installed">已装</span>}
                      </div>
                    </td>
                    <td className="dim small">{s.description || '（无说明）'}</td>
                    <td className="dim small mono">{s.subdir}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
                        <button
                          className="btn small-btn ghost"
                          onClick={() => setPreviewSkill(s)}
                          title="查看 SKILL.md 提示词与安全体检"
                        >
                          详情
                        </button>
                        {s.installed ? (
                          <span className="dim small">已就绪</span>
                        ) : (
                          <button
                            className="btn small-btn primary"
                            disabled={installing !== null}
                            onClick={() => install(s)}
                          >
                            {installing === s.subdir ? '安装中…' : '安装'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filteredSkills.length > visible && (
            <div className="load-more">
              <button className="btn small-btn subtle" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                加载更多（已显示 {visible}/{filteredSkills.length}）
              </button>
            </div>
          )}
          <p className="legend" style={{ marginTop: 14 }}>
            💡 安装提示：内容拷贝进中央仓库后，默认不对任何 Agent 开放，可至「开关矩阵」按需勾选开放。
          </p>
        </>
      )}

      {previewSkill && (
        <MarketPreviewModal
          skill={previewSkill}
          url={selected}
          onClose={() => setPreviewSkill(null)}
          onInstalled={(sub) =>
            setSkills((prev) =>
              prev ? prev.map((p) => (p.subdir === sub ? { ...p, installed: true } : p)) : prev,
            )
          }
          reload={reload}
          toast={toast}
        />
      )}
    </div>
  );
}
