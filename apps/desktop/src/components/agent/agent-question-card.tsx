import { MessageCircleQuestion, ChevronLeft, ChevronRight, Send, SkipForward } from 'lucide-react';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentStore } from '@/stores/agent-store';
import { HarnessBridge } from '@/lib/harness-bridge';
import type { AgentQuestion, AgentQuestionAnswer } from '@hyscode/agent-harness';

export function AgentQuestionCard() {
  const pending = useAgentStore((s) => s.pendingUserQuestion);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [freeformInputs, setFreeformInputs] = useState<Record<string, string>>({});

  const handleSelectOption = useCallback((questionId: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: label }));
  }, []);

  const handleFreeformChange = useCallback((questionId: string, value: string) => {
    setFreeformInputs((prev) => ({ ...prev, [questionId]: value }));
    // If typing free-form, clear selected option
    if (value.trim()) {
      setAnswers((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  }, []);

  const handleSubmit = useCallback(() => {
    if (!pending) return;
    const resolved: AgentQuestionAnswer[] = pending.questions
      .map((q) => ({
        id: q.id,
        answer: answers[q.id] || freeformInputs[q.id]?.trim() || '',
      }))
      .filter((a) => a.answer.length > 0);

    HarnessBridge.get().resolveUserQuestion(pending.id, resolved);
    setCurrentIdx(0);
    setAnswers({});
    setFreeformInputs({});
  }, [pending, answers, freeformInputs]);

  const handleSkip = useCallback(() => {
    if (!pending) return;
    HarnessBridge.get().resolveUserQuestion(pending.id, []);
    setCurrentIdx(0);
    setAnswers({});
    setFreeformInputs({});
  }, [pending]);

  if (!pending || pending.questions.length === 0) return null;

  const questions = pending.questions;
  const total = questions.length;
  const current: AgentQuestion = questions[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === total - 1;

  // Check if current question has an answer
  const currentAnswer = answers[current.id] || freeformInputs[current.id]?.trim() || '';
  const hasAnyAnswer = questions.some((q) => answers[q.id] || freeformInputs[q.id]?.trim());

  return (
    <div className="agent-fade-in my-3 border-l-2 border-violet-500/30 pl-3">
      <div className="py-0.5">
        {/* Header */}
        <div className="mb-3 flex items-center gap-2.5">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-500/10">
            <MessageCircleQuestion className="h-3 w-3 text-violet-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-violet-300/90">
              {pending.title || 'Agent has a question'}
            </span>
            {total > 1 && (
              <span className="text-[10px] text-muted-foreground/50">
                Question {currentIdx + 1} of {total}
              </span>
            )}
          </div>
        </div>

        {/* Question text */}
        <p className="mb-3 text-[12.5px] leading-relaxed text-foreground/85">{current.question}</p>

        {/* Options */}
        {current.options && current.options.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">
            {current.options.map((opt) => {
              const isSelected = answers[current.id] === opt.label;
              return (
                <button
                  key={opt.label}
                  onClick={() => handleSelectOption(current.id, opt.label)}
                  className={`flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-all ${
                    isSelected
                      ? 'border-violet-500/40 bg-violet-500/[0.06] text-foreground'
                      : 'border-foreground/[0.08] bg-transparent text-foreground/75 hover:border-foreground/[0.14] hover:bg-foreground/[0.02]'
                  }`}
                >
                  <span className="text-[11.5px] font-medium">{opt.label}</span>
                  {opt.description && (
                    <span className="text-[10px] text-muted-foreground/60">{opt.description}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Free-form input */}
        {current.allowFreeform !== false && (
          <div className="mb-3">
            <input
              type="text"
              placeholder="Type your answer..."
              value={freeformInputs[current.id] || ''}
              onChange={(e) => handleFreeformChange(current.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (isLast) handleSubmit();
                  else setCurrentIdx((i) => i + 1);
                }
              }}
              className="w-full rounded-md border border-foreground/[0.08] bg-transparent px-3 py-2 text-[12px] text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors focus:border-violet-500/40 focus:bg-foreground/[0.02]"
            />
          </div>
        )}

        {/* Navigation + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {/* Progress dots */}
            {total > 1 && (
              <div className="mr-2 flex items-center gap-1">
                {questions.map((q, i) => {
                  const hasAnswer = !!(answers[q.id] || freeformInputs[q.id]?.trim());
                  return (
                    <button
                      key={q.id}
                      onClick={() => setCurrentIdx(i)}
                      className={`h-1.5 rounded-full transition-all ${
                        i === currentIdx
                          ? 'w-4 bg-violet-400'
                          : hasAnswer
                            ? 'w-1.5 bg-violet-400/50'
                            : 'w-1.5 bg-foreground/15'
                      }`}
                    />
                  );
                })}
              </div>
            )}
            {total > 1 && !isFirst && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCurrentIdx((i) => i - 1)}
                className="h-7 gap-1 rounded-md px-2 text-[10px] text-muted-foreground/60 hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" />
                Back
              </Button>
            )}
            {total > 1 && !isLast && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCurrentIdx((i) => i + 1)}
                className="h-7 gap-1 rounded-md px-2 text-[10px] text-muted-foreground/60 hover:text-foreground"
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleSkip}
              className="h-7 gap-1.5 rounded-md px-3 text-[11px] text-muted-foreground/50 hover:text-foreground"
            >
              <SkipForward className="h-3 w-3" />
              Skip
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!hasAnyAnswer && !currentAnswer}
              className="h-7 gap-1.5 rounded-md bg-violet-600 px-3.5 text-[11px] font-medium hover:bg-violet-500 disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              {isLast || total === 1 ? 'Submit' : 'Submit All'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
