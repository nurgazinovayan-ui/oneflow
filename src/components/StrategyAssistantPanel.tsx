import { useState } from 'react';
import { IconChat, IconSend, IconSparkles, IconChevronRight } from './Icons';
import type { StrategyBrief, StrategyData } from '../strategyTypes';
import { buildStrategyChatSystemContext } from '../strategyPrompts';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface StrategyAssistantPanelProps {
  data: StrategyData;
  brief: StrategyBrief;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

interface QaTurn {
  question: string;
  answer: string;
}

// Persistent side panel (~320px) per spec sections 23/24/44 — a top "insight" card the user can
// Apply/Explain, plus a lightweight stateless Q&A below it (each question goes out with the full
// strategy JSON as context, no multi-turn history to keep the payload small and the answers
// always grounded in the actual current strategy rather than conversation drift).
export default function StrategyAssistantPanel({ data, brief, collapsed, onToggleCollapsed }: StrategyAssistantPanelProps) {
  const t = useT();
  const [insightApplied, setInsightApplied] = useState(false);
  const [insightExplanation, setInsightExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');

  const ask = async (question: string): Promise<string> => {
    const content = `${buildStrategyChatSystemContext(data, brief)}\n\nВопрос: ${question}`;
    return window.api.generateChat([{ role: 'user', content }], undefined, 'text');
  };

  const handleExplainInsight = async () => {
    if (explaining) return;
    setExplaining(true);
    setError('');
    try {
      const reply = await ask(`Подробнее объясни рекомендацию "${data.topInsight.title}" и как её реализовать.`);
      setInsightExplanation(reply);
    } catch (err) {
      setError(formatGenerationError(err));
    } finally {
      setExplaining(false);
    }
  };

  const handleAsk = async () => {
    const question = draft.trim();
    if (!question || asking) return;
    setAsking(true);
    setError('');
    setDraft('');
    try {
      const answer = await ask(question);
      setTurns((prev) => [...prev, { question, answer }]);
    } catch (err) {
      setError(formatGenerationError(err));
    } finally {
      setAsking(false);
    }
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
            disabled={insightApplied}
            onClick={() => setInsightApplied(true)}
          >
            {insightApplied ? t.strategy.assistantApplied : t.strategy.assistantApply}
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
            <div className="strategy-assistant-answer">{turn.answer}</div>
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
