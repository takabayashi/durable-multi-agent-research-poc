export type TurnStatus = "pending" | "running" | "done" | "failed";
export type SubQuestionStatus = "pending" | "running" | "done";

/**
 * A source discovered while investigating a sub-question. The `id` (e.g. "S1")
 * is stable within a turn so the synthesizer can cite it inline as [S1] and we
 * can resolve those citations back to real sources.
 */
export interface Source {
  id: string;
  title: string;
  url: string;
}

export interface Answer {
  text: string;
  citations: Source[];
}

export interface SubQuestion {
  q: string;
  status: SubQuestionStatus;
  findings?: string;
  sources?: Source[];
}

/** A sub-question's investigated result, fed to the synthesizer. */
export interface SubResult {
  q: string;
  findings: string;
  sources: Source[];
}

/** Token usage for a single durable LLM step (one `ctx.run`). */
export interface TokenUsage {
  step: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** Per-turn snapshot of the conversation context fed to the planner/synthesizer. */
export interface TurnContext {
  /** Prior turns represented in the journal (verbatim + folded into the summary). */
  priorTurnsUsed: number;
  /** Heuristic token estimate of the journal used this turn. */
  estimatedTokens: number;
  /** The compaction budget (CONTEXT_MAX_TOKENS) at the time, for display. */
  budgetTokens: number;
  /** Whether older turns were compacted into the rolling summary this turn. */
  compacted: boolean;
}

export interface Turn {
  turnId: string;
  message: string;
  status: TurnStatus;
  subQuestions: SubQuestion[];
  answer?: Answer;
  usage?: TokenUsage[];
  /** Per-turn tool-call counts by tool name, e.g. { web_search: 2, fetch_page: 3 }. */
  toolCalls?: Record<string, number>;
  /** Conversation-context snapshot for this turn (journal size, reuse, compaction). */
  context?: TurnContext;
  createdAt: number;
}

/** Lean per-sub-question view exposed in progress (no findings/sources leak). */
export interface SubQuestionProgress {
  q: string;
  status: SubQuestionStatus;
}

/** Read-only snapshot returned by the Session's getProgress handler. */
export interface Progress {
  sessionId: string;
  status: TurnStatus | "idle";
  currentTurnId: string | null;
  message: string | null;
  subQuestions: SubQuestionProgress[];
  /** True while the session is compacting older turns into the rolling summary. */
  compacting: boolean;
}
