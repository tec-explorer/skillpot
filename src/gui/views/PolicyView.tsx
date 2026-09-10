import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import {
  PolicyApplyResultView,
  PolicyCheckResultView,
  PolicyStatusResp,
  PolicyViolationView,
} from '../types';

interface Props {
  rev: number;
  reload: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

export function PolicyView({ rev, reload, toast }: Props) {
  const [data, setData] = useState<PolicyStatusResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [yamlContent, setYamlContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    result: PolicyApplyResultView;
    isDryRun: boolean;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await api<PolicyStatusResp>('/api/policy/status');
      setData(resp);
      setYamlContent(resp.raw || '');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, rev]);

  const handleInit = async () => {
    setLoading(true);
    try {
      const resp = await api<{ ok: boolean; file: string }>('/api/policy/init', {
        method: 'POST',
        body: {},
      });
      toast(`已生成企业策略模板：${resp.file}`);
      await fetchStatus();
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async () => {
    setLoading(true);
    try {
      const resp = await api<{ checkResult: PolicyCheckResultView }>('/api/policy/check', {
        method: 'POST',
        body: {},
      });
      if (data) {
        setData({
          ...data,
          checkResult: resp.checkResult,
        });
      }
      toast('策略合规审查已刷新');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (dryRun = false) => {
    setApplying(true);
    try {
      const resp = await api<{
        applyResult: PolicyApplyResultView;
        checkResult: PolicyCheckResultView;
      }>('/api/policy/apply', {
        method: 'POST',
        body: { dryRun },
      });
      setApplyResult({ result: resp.applyResult, isDryRun: dryRun });
      toast(dryRun ? '策略修复预演完成（未修改磁盘）' : '策略自动修复执行成功');
      await fetchStatus();
      if (!dryRun) {
        await reload();
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setApplying(false);
    }
  };

  const handleSaveYaml = async () => {
    if (!yamlContent.trim()) {
      toast('策略内容不能为空', true);
      return;
    }
    setLoading(true);
    try {
      const resp = await api<{ ok: boolean; file: string }>('/api/policy/save', {
        method: 'POST',
        body: { content: yamlContent },
      });
      toast(`策略配置已保存并校验：${resp.file}`);
      setIsEditing(false);
      await fetchStatus();
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  };

  const violations = data?.checkResult?.violations ?? [];
  const errorViolations = violations.filter((v) => v.severity === 'error');
  const warnViolations = violations.filter((v) => v.severity === 'warn');
  const policy = data?.policy;
  const registry = data?.registryStatus;

  return (
    <div className="policy-view">
      {/* 顶部概览仪表盘 */}
      <div className="policy-header-grid">
        {/* 策略状态卡片 */}
        <div className="policy-card">
          <div className="policy-card-title">企业策略治理</div>
          {data?.hasPolicy ? (
            <div>
              <div className="policy-status-badge">
                <span className="badge-tag ok">已加载</span>
                <span className={`badge-mode ${policy?.mode === 'strict' ? 'strict' : 'audit'}`}>
                  {policy?.mode === 'strict' ? '严格模式 (strict)' : '审计模式 (audit)'}
                </span>
              </div>
              <div className="policy-file-path" title={data.file ?? ''}>
                {data.file}
              </div>
              {policy?.name && <div className="policy-name">策略标识：{policy.name}</div>}
            </div>
          ) : (
            <div>
              <div className="policy-empty-note">未在工作区或配置目录发现策略文件</div>
              <button
                className="btn btn-primary"
                onClick={handleInit}
                disabled={loading}
                style={{ marginTop: 8 }}
              >
                + 一键生成企业策略模板
              </button>
            </div>
          )}
        </div>

        {/* 合规状态卡片 */}
        <div className="policy-card">
          <div className="policy-card-title">合规审查状态</div>
          {data?.hasPolicy ? (
            data.checkResult?.compliant ? (
              <div className="compliance-pass">
                <div className="pass-icon">✔</div>
                <div>
                  <div className="pass-title">完全符合组织基线</div>
                  <div className="pass-desc">
                    强制基线 {data.checkResult.enforcedCount} 项全员达标，无违规暴露与禁用项
                  </div>
                </div>
              </div>
            ) : (
              <div className="compliance-fail">
                <div className="fail-header">
                  <span className="badge-tag bad">存在违规</span>
                  <span className="fail-counts">
                    {errorViolations.length > 0 && (
                      <span className="count-error">{errorViolations.length} 阻断 (error)</span>
                    )}
                    {warnViolations.length > 0 && (
                      <span className="count-warn">{warnViolations.length} 告警 (warn)</span>
                    )}
                  </span>
                </div>
                <div className="fail-tip">
                  发现 {violations.length} 项违规，可使用下方自动修复一键对齐基线。
                </div>
              </div>
            )
          ) : (
            <div className="policy-empty-note">生成策略后可进行自动化合规审查与 CI 门禁</div>
          )}
        </div>

        {/* 私有 Registry 卡片 */}
        <div className="policy-card">
          <div className="policy-card-title">私有技能 Registry</div>
          {registry ? (
            <div className="registry-info">
              <div className="registry-row">
                <span className="reg-label">终端：</span>
                <span className="reg-url" title={registry.url}>
                  {registry.url}
                </span>
                <span className={`reg-badge ${registry.isPrivate ? 'private' : 'public'}`}>
                  {registry.isPrivate ? '企业私有' : '公共源'}
                </span>
              </div>
              <div className="registry-row">
                <span className="reg-label">Token：</span>
                <span className="reg-token">
                  {registry.hasToken ? (
                    <span className="token-ok">已注入 ({registry.tokenSource})</span>
                  ) : (
                    <span className="token-none">未配置（匿名访问）</span>
                  )}
                </span>
              </div>
              <div className="registry-row">
                <span className="reg-label">模式：</span>
                <span className="reg-mode">
                  {registry.forcePrivate ? (
                    <span className="force-private-tag">私有锁定 (禁止公共源)</span>
                  ) : (
                    <span className="normal-tag">标准模式 (兼容公共源)</span>
                  )}
                </span>
              </div>
            </div>
          ) : (
            <div className="policy-empty-note">未配置私有 Registry</div>
          )}
        </div>
      </div>

      {/* 违规审查与自动修复栏 */}
      {data?.hasPolicy && (
        <div className="policy-section">
          <div className="section-toolbar">
            <div className="section-title">
              合规违规审查
              {violations.length > 0 ? (
                <span className="violation-count-badge bad">{violations.length}</span>
              ) : (
                <span className="violation-count-badge ok">0</span>
              )}
            </div>
            <div className="section-actions">
              <button
                className="btn"
                onClick={handleCheck}
                disabled={loading || applying}
                title="重新扫描已安装技能与开放状态"
              >
                重新审查
              </button>
              {violations.length > 0 && (
                <>
                  <button
                    className="btn"
                    onClick={() => handleApply(true)}
                    disabled={loading || applying}
                    title="预演修复动作，不修改配置"
                  >
                    预演修复 (Dry Run)
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => handleApply(false)}
                    disabled={loading || applying}
                    title="自动卸载黑名单、收回禁用渠道并安装强制技能"
                  >
                    {applying ? '修复中…' : '⚡ 一键自动修复'}
                  </button>
                </>
              )}
            </div>
          </div>

          {violations.length > 0 ? (
            <div className="violations-table-wrap">
              <table className="policy-table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>级别</th>
                    <th style={{ width: 140 }}>规则类别</th>
                    <th style={{ width: 150 }}>关联技能 / 渠道</th>
                    <th>违规说明与修复建议</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v: PolicyViolationView, idx: number) => (
                    <tr key={idx} className={`violation-row ${v.severity}`}>
                      <td>
                        <span className={`severity-tag ${v.severity}`}>
                          {v.severity === 'error' ? '阻断' : '告警'}
                        </span>
                      </td>
                      <td>
                        <code className="rule-type-code">{v.rule}</code>
                      </td>
                      <td>
                        <strong className="violation-skill">{v.skill || v.target || '-'}</strong>
                      </td>
                      <td className="violation-message">{v.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-violations-card">
              <div className="empty-icon">🛡️</div>
              <div className="empty-text">当前环境完全合规，未发现任何偏离基线或安全黑名单的行为。</div>
            </div>
          )}
        </div>
      )}

      {/* 自动修复结果弹窗 / 提示卡片 */}
      {applyResult && (
        <div className="policy-apply-modal">
          <div className="apply-modal-header">
            <h3>{applyResult.isDryRun ? '修复预演计划 (Dry Run)' : '自动修复执行报告'}</h3>
            <button className="btn-close" onClick={() => setApplyResult(null)}>
              ✕
            </button>
          </div>
          <div className="apply-modal-body">
            {applyResult.result.actions.length === 0 ? (
              <div className="apply-clean-note">✔ 无需任何变更操作，当前环境已达标</div>
            ) : (
              <ul className="apply-action-list">
                {applyResult.result.actions.map((act, i) => (
                  <li key={i} className={`apply-act-item ${act.action}`}>
                    <span className="act-badge">{act.action}</span>
                    <span className="act-detail">{act.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {applyResult.result.violationsRemaining.length > 0 && (
              <div className="apply-remaining-warn">
                <strong>仍需人工处理的违规项：</strong>
                <ul>
                  {applyResult.result.violationsRemaining.map((vr, j) => (
                    <li key={j}>{vr.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 规则拓扑可视化看板 */}
      {policy && (
        <div className="policy-section">
          <div className="section-title">策略规则可视化</div>
          <div className="policy-rules-grid">
            {/* 来源白名单 */}
            <div className="rule-box">
              <div className="rule-box-header">
                来源白名单 (allowed_sources)
                <span className="rule-count">{policy.allowed_sources?.length ?? 0}</span>
              </div>
              <div className="rule-box-content">
                {policy.allowed_sources && policy.allowed_sources.length > 0 ? (
                  <ul className="rule-list">
                    {policy.allowed_sources.map((s, i) => (
                      <li key={i} className="rule-list-item mono">
                        {s}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rule-empty">未开启来源限制（允许任意来源）</div>
                )}
              </div>
            </div>

            {/* 强制开启技能 */}
            <div className="rule-box">
              <div className="rule-box-header">
                强制基线技能 (enforce)
                <span className="rule-count">{policy.enforce?.length ?? 0}</span>
              </div>
              <div className="rule-box-content">
                {policy.enforce && policy.enforce.length > 0 ? (
                  <ul className="rule-list">
                    {policy.enforce.map((e, i) => (
                      <li key={i} className="rule-list-item">
                        <strong>{e.name}</strong>
                        <div className="rule-sub-info">源: {e.source}</div>
                        {e.targets && (
                          <div className="rule-sub-info">目标: {e.targets.join(', ')}</div>
                        )}
                        {e.checksum && (
                          <div className="rule-sub-info mono">锁: {e.checksum.slice(0, 16)}…</div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rule-empty">未配置强制技能</div>
                )}
              </div>
            </div>

            {/* 高危禁用名单 */}
            <div className="rule-box">
              <div className="rule-box-header">
                组织禁用黑名单 (deny)
                <span className="rule-count">{policy.deny?.length ?? 0}</span>
              </div>
              <div className="rule-box-content">
                {policy.deny && policy.deny.length > 0 ? (
                  <ul className="rule-list">
                    {policy.deny.map((d, i) => (
                      <li key={i} className="rule-list-item">
                        <strong className="text-bad">{d.pattern || d.name || d.source || '-'}</strong>
                        {d.reason && <div className="rule-sub-info">{d.reason}</div>}
                        {d.checksum && (
                          <div className="rule-sub-info mono">哈希: {d.checksum.slice(0, 16)}…</div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="rule-empty">未配置禁用黑名单</div>
                )}
              </div>
            </div>

            {/* 渠道限制 */}
            <div className="rule-box">
              <div className="rule-box-header">目标渠道治理 (targets)</div>
              <div className="rule-box-content">
                <div className="channel-rule-row">
                  <span>通用广播目录 (~/.agents/skills)</span>
                  <span
                    className={`channel-badge ${
                      policy.targets?.broadcast?.allow === false ? 'disallowed' : 'allowed'
                    }`}
                  >
                    {policy.targets?.broadcast?.allow === false ? '已组织禁用' : '允许开放'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 策略文件 YAML 源码编辑器 */}
      {data?.hasPolicy && (
        <div className="policy-section">
          <div className="section-toolbar">
            <div className="section-title">策略文件源码 (skillpot.policy.yaml)</div>
            <div className="section-actions">
              {!isEditing ? (
                <button className="btn" onClick={() => setIsEditing(true)}>
                  ✎ 编辑配置
                </button>
              ) : (
                <>
                  <button
                    className="btn"
                    onClick={() => {
                      setYamlContent(data?.raw || '');
                      setIsEditing(false);
                    }}
                  >
                    取消
                  </button>
                  <button className="btn btn-primary" onClick={handleSaveYaml} disabled={loading}>
                    保存并重新验证
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="policy-editor-wrap">
            <textarea
              className="policy-yaml-textarea"
              value={yamlContent}
              onChange={(e) => setYamlContent(e.target.value)}
              readOnly={!isEditing}
              rows={18}
              spellCheck={false}
              placeholder="version: 1&#10;mode: strict&#10;..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
