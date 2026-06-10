export type TurnStatus = "pending" | "running" | "done" | "failed";
export type SubQuestionStatus = "pending" | "running" | "done";

export interface Citation {
  title: string;
  url: string;
}

export interface Answer {
  text: string;
  citations: Citation[];
}

export interface SubQuestion {
  q: string;
  status: SubQuestionStatus;
}

export interface Turn {
  turnId: string;
  message: string;
  status: TurnStatus;
  subQuestions: SubQuestion[];
  answer?: Answer;
  createdAt: number;
}

/** Read-only snapshot returned by the Session's getProgress handler. */
export interface Progress {
  sessionId: string;
  status: TurnStatus | "idle";
  currentTurnId: string | null;
  message: string | null;
  subQuestions: SubQuestion[];
}
