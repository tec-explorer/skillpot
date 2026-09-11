import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { ManifestInspect, ManifestInspectItem, SyncItem, SYNC_ACTION_LABEL } from '../types';
import { Toast } from '../App';

interface Props {
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

const FILE_KEY = 'sp-team-manifest';

export function TeamView({ reload, toast }: Props) {
  const [file, setFile] = useState('');
  const [report, setReport] = useState<ManifestInspect | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [items, setItems] = useState<SyncItem[] | null>(null);
  const [dryRunItems, setDryRunItems] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(FILE_KEY);
    if (saved) setFile(saved);
  }, []);

  const runInspect = useCallback(
    async (f: string) => {
      if (!f.trim()) return;
      setLoading(true);
      try {
        const r = await api<ManifestInspect>(
          `/api/team/inspect?file=${encodeURIComponent(f.trim())}`,
        );
        setReport(r);
        for (const w of r.warnings) toast(w, true);
      } catch (e) {
        toast((e as Error).message, true);
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const applyPath = () => {
    const f = file.trim();
    if (!f) return;
    localStorage.setItem(FILE_KEY, f);
    setItems(null);
    runInspect(f);
  };

  const runSync = async (dryRun: boolean) => {
    const f = file.trim();
    if (!f || syncing) return;
    setSyncing(true);
    setDryRunItems(dryRun);
    try {
      const r = await api<{ items: SyncItem[] }>('/api/team/sync', {
        method: 'POST',
        body: { file: f, dryRun },
      });
      setItems(r.items);
      toast(dryRun ? '预演完成（未做变更）' : '对齐完成');
      if (!dryRun) {
        await reload();
        await runInspect(f);
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSyncing(false);
    }
  };

  const exportManifest = async () => {
    const f = file.trim();
    if (!f || syncing) return;
    if (!window.confirm(`确认把当前中央仓库导出到 ${f}？（已有内容将被覆盖）`)) return;
    setSyncing(true);
    try {
      const r = await api<{ manifest: { skills: Record<string, unknown> }; warnings: string[] }>(
        '/api/team/export',
        { method: 'POST', body: { file: f } },
      );
      toast(`已导出 ${Object.keys(r.manifest.skills).length} 个 skill`);
      for (const w of r.warnings) toast(w, true);
      await runInspect(f);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSyncing(false);
    }
  };

  const statusOf = (s: ManifestInspectItem): string => {
    if (s.storeMissing) return '✗ 中央仓库缺失（对齐将重装）';
    if (!s.installed) return s.localOnly ? '本机路径无效' : '未安装';
    if (s.checksumMatch === false) return '⚠ 内容偏离版本锁';
    if (s.checksumMatch === true) return '✓ 与版本锁一致';
    return '已安装（未锁版本）';
  };

  return (
    <div className="panel team-panel">
      <div className="doctor-head">
        <div>
          <h2>团队配置对齐 (Team Sync)</h2>
          <div className="dim small">
            通过版本锁清单 <code>.skillpot.yaml</code> 跨成员统一技能来源、版本指纹与 Agent 开放矩阵
          </div>
        </div>
        <div className="doctor-actions">
          <button
            className="btn small-btn subtle"
            onClick={exportManifest}
            disabled={syncing || !file.trim()}
            title="将当前工作区与中央仓库状态导出至该清单文件"
          >
            导出当前配置至清单
          </button>
        </div>
      </div>

      <div className="team-file-card">
        <div className="form-group">
          <label className="form-label">
            <span>项目清单文件路径 (支持绝对路径或相对路径)</span>
          </label>
          <div className="team-input-row">
            <input
              className="input grow mono"
              placeholder="例如: /path/to/my-repo/.skillpot.yaml"
              value={file}
              onChange={(e) => setFile(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyPath()}
            />
            <button className="btn small-btn" onClick={applyPath} disabled={!file.trim() || loading}>
              {loading ? '加载中…' : '预览清单'}
            </button>
            {report && (
              <>
                <button
                  className="btn small-btn subtle"
                  onClick={() => runSync(true)}
                  disabled={syncing}
                >
                  {syncing ? '执行中…' : '预演对齐'}
                </button>
                <button
                  className="btn small-btn primary"
                  onClick={() => runSync(false)}
                  disabled={syncing}
                >
                  {syncing ? '对齐中…' : '执行一键对齐'}
                </button>
              </>
            )}
          </div>
          <div className="input-hint" style={{ marginTop: 8 }}>
            <span>快捷填入：</span>
            <button
              type="button"
              className="bulk-pill-btn"
              onClick={() => {
                const defaultPath = './.skillpot.yaml';
                setFile(defaultPath);
                localStorage.setItem(FILE_KEY, defaultPath);
                runInspect(defaultPath);
              }}
            >
              使用工作区默认 (./.skillpot.yaml)
            </button>
          </div>
        </div>
      </div>

      {!report ? null : (
        <>
          <div className="doctor-stat-bar" style={{ marginTop: 14 }}>
            <span className="stat-label">清单比对概览：</span>
            <span className="stat-pill ok">
              {report.skills.filter((s) => s.checksumMatch === true).length} 吻合锁版本
            </span>
            {report.skills.filter((s) => s.checksumMatch === false).length > 0 && (
              <span className="stat-pill warn">
                {report.skills.filter((s) => s.checksumMatch === false).length} 偏离
              </span>
            )}
            {report.skills.filter((s) => s.storeMissing).length > 0 && (
              <span className="stat-pill error">
                {report.skills.filter((s) => s.storeMissing).length} 缺失待装
              </span>
            )}
            <span className="stat-fixable">（共 {report.skills.length} 项声明）</span>
          </div>

          {report.warnings.length > 0 && (
            <div className="lint-box" style={{ marginTop: 10 }}>
              {report.warnings.map((w, i) => (
                <div key={i} className="warn-text">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          {report.skills.length === 0 ? (
            <p className="dim" style={{ marginTop: 14 }}>清单里没有声明任何 skill。</p>
          ) : (
            <div className="table-responsive" style={{ marginTop: 14 }}>
              <table className="matrix update-table">
                <thead>
                  <tr>
                    <th className="skill-col">Skill 技能</th>
                    <th>来源</th>
                    <th>开放 Agent</th>
                    <th>本机状态与一致性</th>
                  </tr>
                </thead>
                <tbody>
                  {report.skills.map((s) => (
                    <tr key={s.skill}>
                      <td className="skill-name bold">{s.skill}</td>
                      <td className="dim small mono src" title={s.source}>
                        {s.source}
                      </td>
                      <td className="dim small">
                        {Object.keys(s.expose).length > 0 ? (
                          <span className="expose-pills">
                            {Object.keys(s.expose).map((ag) => (
                              <span key={ag} className="agent-tag-badge mini">
                                {ag}
                              </span>
                            ))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            s.checksumMatch === true
                              ? 'latest'
                              : s.checksumMatch === false
                                ? 'outdated'
                                : s.storeMissing
                                  ? 'error'
                                  : 'normal'
                          }`}
                        >
                          {statusOf(s)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {items && (
        <div className="result-box">
          <div className="result-title">
            {dryRunItems ? '预演结果（未做变更）' : '对齐结果'}
          </div>
          <div className="table-responsive">
            <table className="matrix update-table">
              <thead>
                <tr>
                  <th className="skill-col">Skill</th>
                  <th>动作</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.skill}>
                    <td className="skill-name">{i.skill}</td>
                    <td className={i.action === 'error' ? 'warn-text' : ''}>
                      {SYNC_ACTION_LABEL[i.action]}
                      {i.dryRun ? '（将执行）' : ''}
                    </td>
                    <td className="dim small">{i.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
