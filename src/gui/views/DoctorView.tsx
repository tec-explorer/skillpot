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

  return (
    <div className="doctor">
      <div className="doctor-head">
        <h2>
          {issues.length === 0
            ? '✓ 未发现问题'
            : `发现 ${issues.length} 个问题（错误 ${issues.filter((i) => i.level === 'error').length} / 警告 ${
                issues.filter((i) => i.level === 'warn').length
              }）`}
        </h2>
        {issues.length > 0 && (
          <button className="btn" onClick={fixAll} disabled={fixing || fixable === 0}>
            {fixing ? '修复中…' : fixable > 0 ? `全部修复（${fixable} 项可自动修复）` : '无可自动修复项'}
          </button>
        )}
      </div>

      {issues.length === 0 ? (
        <p className="dim">
          config、中央仓库与各 Agent 目录三方一致。enable/disable 后记得重启示例会话。
        </p>
      ) : (
        <ul className="issue-list">
          {issues.map((i, idx) => (
            <li key={idx} className={`issue level-${i.level}`}>
              <span className={`badge badge-${i.level}`}>{LEVEL_LABEL[i.level]}</span>
              <span className="issue-msg">{i.message}</span>
              {i.fix && <span className="fix-hint">（{FIX_HINT[i.fix]}）</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
