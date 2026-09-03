import { useState } from 'react';
import { IconChat, IconSend, IconSparkles, IconChevronRight, IconCheck } from './Icons';
import type { StrategyAction, StrategyBrief, StrategyData } from '../strategyTypes';
import { buildAssistantActionSystemPrompt, tryParseAssistantAction } from '../strategyPrompts';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface StrategyAssistantPanelProps {
  data: StrategyData;
  brief: StrategyBrief;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onApplyAction: (action: StrategyAction) => void;
}

interface QaTurn {
  question: string;
  answer?: string;
  action?: StrategyAction;
  applied?: boolean;
}

// Persistent side panel (~320px) per spec sections 23/24/44 — a top "insight" card the user can
// Apply/Explain, plus a Q&A below it. Every reply goes through buildAssistantActionSystemPrompt
// (spec §20): a change-intent question comes back as a structured action (validated + applied via
// onApplyAction, never parsed out of free text), anything else comes back as a plain answer.
// Each question still goes out with the full strategy JSON as context (no multi-turn history) so
// answers stay grounded in the actual current strategy rather than conversation drift.
export default function StrategyAssistantPanel({ data, brief, collapsed, onToggleCollapsed, onApplyAction }: StrategyAssistantPanelProps) {
  const t = useT();
  const [insightAction, setInsightAction] = useState<StrategyAction | null>(null);
  const [insightApplied, setInsightApplied] = useState(false);
  const [insightExplanation, setInsightExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [applyingInsight, setApplyingInsight] = useState(false);
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const ask = async (question: string): Promise<string> => {
    const content = `${buildAssistantActionSystemPrompt(data, brief)}\n\nВопрос: ${question}`;
    return window.api.generateChat([{ role: 'user', content }], undefined, 'text');
  };

  const handleExplainInsight = async () => {
    if (explaining) return;
    setExplaining(true);
    setError('');
    try {
      const reply = await ask(`Подробнее объясни рекомендацию "${data.topInsight.title}" и как её реализовать, без JSON, обычным текстом.`);
      setInsightExplanation(reply);
    } catch (err) {
      setError(formatGenerationError(err));
    } finally {
      setExplaining(false);
    }
  };

  const handleApplyInsight = async () => {
    if (applyingInsight || insightApplied) return;
    setApplyingInsight(true);
    setError('');
    try {
      if (insightAction) {
        onApplyAction(insightAction);
        setInsightApplied(true);
        return;
      }
      const reply = await ask(data.topInsight.title);
      const action = tryParseAssistantAction(reply);
      if (action) {
        setInsightAction(action);
        onApplyAction(action);
        setInsightApplied(true);
      } else {
        setInsightExplanation(reply);
      }
    } catch (err) {
      setError(formatGenerationError(err));
    } finally {
      setApplyingInsight(false);
    }
  };

  const handleAsk = async () => {
    const question = draft.trim();
    if (!question || asking) return;
    setAsking(true);
    setError('');
    setDraft('');
    try {
      const reply = await ask(question);
      const action = tryParseAssistantAction(reply);
      if (action) {
        setTurns((prev) => [...prev, { question, action }]);
      } else {
        setTurns((prev) => [...prev, { question, answer: reply }]);
      }
    } catch (err) {
      setError(formatGenerationError(err));
    } finally {
      setAsking(false);
    }
  };

  const handleApplyTurn = (index: number) => {
    const turn = turns[index];
    if (!turn.action || turn.applied) return;
    onApplyAction(turn.action);
    setTurns((prev) => prev.map((t2, i) => (i === index ? { ...t2, applied: true } : t2)));
  };

  if (collapsed) {
    return (
      <button type="button" className="strategy-assistant-collapsed" onClick={onToggleCollapsed} title={t.strategy.assistantTitle}>
        <IconSparkles size={16} />
      </button>
    );
  }

  return (
    <div className="strategy-assistant-panel">
      <div className="strategy-assistant-header">
        <span className="strategy-assistant-title">
          <IconChat size={14} /> {t.strategy.assistantTitle}
        </span>
        <button type="button" className="evaluation-slot-remove" onClick={onToggleCollapsed} title={t.strategy.assistantCollapse}>
          <IconChevronRight size={14} />
        </button>
      </div>
      <div className="strategy-assistant-context">{t.strategy.assistantContext}</div>

      <div className={`strategy-insight-card ${insightApplied ? 'applied' : ''}`}>
        <div className="strategy-insight-title">
          <IconSparkles size={13} /> {t.strategy.assistantInsightLabel}
        </div>
        <div className="strategy-insight-body">
          <strong>{data.topInsight.title}.</strong> {data.topInsight.description}
        </div>
        {insightExplanation && <div className="strategy-insight-explanation">{insightExplanation}</div>}
        <div className="strategy-insight-actions">
          <button
            type="button"
            className="generate-btn strategy-small-btn"
            disabled={insightApplied || applyingInsight}
            onClick={handleApplyInsight}
          >
            {insightApplied ? t.strategy.assistantApplied : applyingInsight ? t.strategy.assistantApplying : t.strategy.assistantApply}
          </button>
          <button type="button" className="secondary-btn strategy-small-btn" disabled={explaining} onClick={handleExplainInsight}>
            {explaining ? t.strategy.assistantExplaining : t.strategy.assistantExplain}
          </button>
        </div>
      </div>

      <div className="strategy-assistant-qa">
        {turns.map((turn, i) => (
          <div key={i} className="strategy-assistant-turn">
            <div className="strategy-assistant-question">{turn.question}</div>
            {turn.action ? (
              <div className="strategy-assistant-action-card">
                <div className="strategy-assistant-action-rationale">{turn.action.rationale}</div>
                <button
                  type="button"
                  className="generate-btn strategy-small-btn"
                  disabled={turn.applied}
                  onClick={() => handleApplyTurn(i)}
                >
                  {turn.applied ? (
                    <>
                      <IconCheck size={12} /> {t.strategy.assistantApplied}
                    </>
                  ) : (
                    t.strategy.assistantApply
                  )}
                </button>
              </div>
            ) : (
              <div className="strategy-assistant-answer">{turn.answer}</div>
            )}
          </div>
        ))}
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="strategy-assistant-input-row">
        <input
          className="node-select"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAsk();
          }}
          placeholder={t.strategy.assistantPlaceholder}
        />
        <button type="button" className="toolbar-icon-btn" onClick={handleAsk} disabled={asking || !draft.trim()}>
          <IconSend size={14} />
        </button>
      </div>
    </div>
  );
}
