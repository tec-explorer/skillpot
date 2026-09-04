import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { AddResult, MarketSkill, SourceInfo } from '../types';
import { Toast } from '../App';

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
    <div className="panel">
      <div className="doctor-head">
        <h2>市场</h2>
        <button className="btn" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? '取消' : '添加源'}
        </button>
      </div>

      {showAdd && (
        <div className="form-row">
          <input
            className="input grow"
            placeholder="git 仓库地址，如 https://github.com/owner/skills.git"
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
          <button className="btn" onClick={addSource} disabled={!newUrl.trim()}>
            确定
          </button>
        </div>
      )}

      <div className="form-row">
        {sources.map((s) => (
          <button
            key={s.url}
            className={s.url === selected ? 'seg-btn active' : 'seg-btn'}
            onClick={() => pickSource(s.url)}
            title={s.url}
          >
            {s.name}
            {s.builtin && <span className="dim">（内置）</span>}
          </button>
        ))}
        {current && !current.builtin && (
          <button className="seg-btn danger-btn" onClick={() => removeSource(current.url)}>
            移除此源
          </button>
        )}
      </div>

      <div className="form-row" style={{ justifyContent: 'space-between' }}>
        <span className="dim small mono">{selected}</span>
        <button className="btn small-btn" onClick={() => scan(selected, true)} disabled={scanning}>
          {scanning ? '克隆/扫描中…（首次较慢）' : '刷新'}
        </button>
      </div>

      <div className="toolbar">
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
            : `${filteredSkills.length}/${(skills ?? []).length} · ${clonedNote}`}
        </span>
      </div>

      {!skills ? null : skills.length === 0 ? (
        <p className="dim">该仓库中没有找到 SKILL.md 目录。</p>
      ) : (
        <>
          {visibleSkills.length === 0 ? (
            <p className="dim">没有匹配的 skill（换个关键词试试）。</p>
          ) : (
            <table className="matrix update-table">
              <thead>
                <tr>
                  <th className="skill-col">Skill</th>
                  <th>说明</th>
                  <th>子目录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleSkills.map((s) => (
                  <tr key={s.subdir}>
                    <td className="skill-name">{s.name}</td>
                    <td className="dim small">{s.description.slice(0, 90)}</td>
                    <td className="dim small mono">{s.subdir}</td>
                    <td>
                      {s.installed ? (
                        <span className="dim small">已安装</span>
                      ) : (
                        <button
                          className="btn small-btn"
                          disabled={installing !== null}
                          onClick={() => install(s)}
                        >
                          {installing === s.subdir ? '安装中…' : '安装'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filteredSkills.length > visible && (
            <div className="load-more">
              <button className="btn" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                加载更多（已显示 {visible}/{filteredSkills.length}）
              </button>
            </div>
          )}
          <p className="legend">
            安装 = 拷贝进中央仓库，默认不对任何 Agent 开放（去「开关矩阵」打勾或安装时先收着）。
            官方源中 docx/pdf/pptx/xlsx 为 source-available 许可，使用前请阅原仓库说明。
          </p>
        </>
      )}
    </div>
  );
}
