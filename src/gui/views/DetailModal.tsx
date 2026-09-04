import { useEffect, useState } from 'react';
import { api } from '../api';
import { SkillDetail } from '../types';
import { Toast } from '../App';

interface Props {
  skill: string;
  onClose: () => void;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function DetailModal({ skill, onClose, reload, toast }: Props) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    api<SkillDetail>(`/api/skill/${encodeURIComponent(skill)}`)
      .then(setDetail)
      .catch((e: Error) => {
        toast(e.message, true);
        onClose();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill]);

  const remove = async () => {
    if (removing) return;
    if (!window.confirm(`确认卸载 ${skill}？将撤下所有 Agent 的链接并删除中央仓库内容，不可恢复。`)) {
      return;
    }
    setRemoving(true);
    try {
      await api('/api/remove', { method: 'POST', body: { skill } });
      toast(`已卸载 ${skill}`);
      await reload();
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
      setRemoving(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{skill}</h2>
          <div className="modal-actions">
            <button className="btn danger" onClick={remove} disabled={removing}>
              {removing ? '卸载中…' : '卸载'}
            </button>
            <button className="tab" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        {!detail ? (
          <div className="loading">加载详情…</div>
        ) : (
          <>
            {detail.meta?.description && <p>{detail.meta.description}</p>}
            {detail.lint.length > 0 && (
              <div className="lint-box">
                <div className="dim">lint:{detail.lint.length} 个问题</div>
                {detail.lint.map((li, i) => (
                  <div key={i} className={li.level === 'error' ? 'warn-text' : 'dim'}>
                    {li.level === 'error' ? '✗' : '⚠'} {li.message}
                  </div>
                ))}
              </div>
            )}
            <div className="detail-files">
              <div className="dim">文件({detail.files.length})</div>
              <div className="file-list mono small">
                {detail.files.map((f) => (
                  <div key={f}>{f}</div>
                ))}
              </div>
            </div>
            <pre className="skill-md">{detail.skillMd}</pre>
          </>
        )}
      </div>
    </div>
  );
}
