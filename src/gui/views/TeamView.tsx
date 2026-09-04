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
    <div className="panel">
      <div className="doctor-head">
        <h2>团队对齐</h2>
        <div className="modal-actions">
          <button className="btn small-btn" onClick={() => runSync(true)} disabled={!report || syncing}>
            {syncing ? '执行中…' : '预演（不落地）'}
          </button>
          <button className="btn" onClick={() => runSync(false)} disabled={!report || syncing}>
            {syncing ? '对齐中…' : '对齐'}
          </button>
          <button className="btn small-btn" onClick={exportManifest} disabled={syncing}>
            导出清单
          </button>
        </div>
      </div>
      <p className="dim">
        在项目仓库根放置 <code>.skillpot.yaml</code>（用「导出清单」从当前中央仓库生成），
        提交进项目后，团队成员填入路径点「对齐」即可一键安装缺失、对齐版本锁并应用开放矩阵。
      </p>
      <div className="form-row">
        <input
          className="input grow mono"
          placeholder="/path/to/your-project/.skillpot.yaml"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && applyPath()}
        />
        <button className="btn small-btn" onClick={applyPath} disabled={!file.trim()}>
          预览清单
        </button>
      </div>

      {!report ? null : (
        <>
          {report.warnings.length > 0 && (
            <div className="lint-box">
              {report.warnings.map((w, i) => (
                <div key={i} className="warn-text">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}
          {report.skills.length === 0 ? (
            <p className="dim">清单里没有声明任何 skill。</p>
          ) : (
            <table className="matrix update-table">
              <thead>
                <tr>
                  <th className="skill-col">Skill</th>
                  <th>来源</th>
                  <th>开放</th>
                  <th>本机状态</th>
                </tr>
              </thead>
              <tbody>
                {report.skills.map((s) => (
                  <tr key={s.skill}>
                    <td className="skill-name">{s.skill}</td>
                    <td className="dim small mono src" title={s.source}>
                      {s.source}
                    </td>
                    <td className="dim small">
                      {Object.keys(s.expose).join('、') || '—'}
                    </td>
                    <td className={s.checksumMatch === false ? 'warn-text' : ''}>
                      {statusOf(s)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {items && (
        <div className="result-box">
          <div className="result-title">
            {dryRunItems ? '预演结果（未做变更）' : '对齐结果'}
          </div>
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
      )}
    </div>
  );
}
