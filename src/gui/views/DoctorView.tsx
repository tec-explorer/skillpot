import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Issue } from '../types';
import { Toast } from '../App';

interface FixResp {
  fixed: string[];
  remaining: Issue[];
}

const LEVEL_LABEL: Record<Issue['level'], string> = {
  error: '错误',
  warn: '警告',
  info: '提示',
};

const FIX_HINT: Record<NonNullable<Issue['fix']>, string> = {
  resync: '自动修复：重新同步 symlink',
  'drop-ledger': '自动修复：清理失效台账',
  adopt: '需人工确认：运行 skillpot adopt 收编',
};

export function DoctorView({
  rev,
  toast,
}: {
  /** SSE 变更序号：变化时重新体检（保留本地状态，不重挂载） */
  rev: number;
  toast: (text: string, bad?: boolean) => void;
}) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [fixing, setFixing] = useState(false);

  const reload = useCallback(() => {
    api<{ issues: Issue[] }>('/api/doctor')
      .then((r) => setIssues(r.issues))
      .catch((e: Error) => toast(e.message, true));
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload, rev]);

  const fixAll = async () => {
    if (fixing) return;
    setFixing(true);
    try {
      const r = await api<FixResp>('/api/doctor/fix', { method: 'POST' });
      setIssues(r.remaining);
      if (r.fixed.length) {
        toast(`已修复 ${r.fixed.length} 项`);
      } else {
        toast('没有可自动修复的项');
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setFixing(false);
    }
  };

  if (!issues) return <div className="loading">体检中…</div>;

  const fixable = issues.filter((i) => i.fix && i.fix !== 'adopt').length;
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const infos = issues.filter((i) => i.level === 'info').length;

  return (
    <div className="panel doctor">
      <div className="doctor-head">
        <div>
          <h2>系统体检与诊断</h2>
          <div className="dim small">扫描中央仓库、Agent 软链接与配置台账的一致性</div>
        </div>
        <div className="doctor-actions">
          <button className="btn small-btn subtle" onClick={reload} disabled={fixing}>
            重新体检
          </button>
          {issues.length > 0 && fixable > 0 && (
            <button className="btn small-btn primary" onClick={fixAll} disabled={fixing}>
              {fixing ? '修复中…' : `全部修复（${fixable} 项可自动修复）`}
            </button>
          )}
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="health-card healthy">
          <div className="health-icon">🛡️</div>
          <div className="health-info">
            <div className="health-title">系统状态优良，未发现任何异常或漂移</div>
            <div className="health-desc">
              配置文件、中央仓库与各 Agent 目录三方软链接完全一致。切换开关后记得重启对应 Agent 会话生效。
            </div>
          </div>
        </div>
      ) : (
        <div className="doctor-body">
          <div className="doctor-stat-bar">
            <span className="stat-label">体检结果：</span>
            {errors > 0 && <span className="stat-pill error">{errors} 错误</span>}
            {warns > 0 && <span className="stat-pill warn">{warns} 警告</span>}
            {infos > 0 && <span className="stat-pill info">{infos} 提示</span>}
            <span className="stat-fixable">（共 {issues.length} 项，{fixable} 项可全自动修复）</span>
          </div>
          <ul className="issue-list">
            {issues.map((i, idx) => (
              <li key={idx} className={`issue level-${i.level}`}>
                <span className={`badge badge-${i.level}`}>{LEVEL_LABEL[i.level]}</span>
                <span className="issue-msg">{i.message}</span>
                {i.fix && <span className="fix-hint">（{FIX_HINT[i.fix]}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
