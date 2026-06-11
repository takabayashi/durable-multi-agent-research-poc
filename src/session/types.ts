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

/**
 * One Tier-2 trace event: a single durable LLM or tool step in a turn's
 * transcript. The `step` is the same stable name used in the journal + logs
 * (e.g. "planner", "investigate:0:llm:1", "investigate:0:tool:1:0",
 * "synthesizer", "compact"), so the three surfaces correlate. Stored truncated
 * and secret-free on the Turn and exposed via getTrace.
 */
export interface TraceEvent {
  step: string;
  kind: "plan" | "investigate" | "llm" | "tool" | "synthesize" | "compact";
  /** Truncated, secret-free, human-readable detail. */
  detail: string;
  model?: string;
  tokens?: { in: number; cached: number; out: number };
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
  /** Tier-2 ordered transcript of this turn's LLM/tool steps (truncated, secret-free). */
  trace?: TraceEvent[];
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
