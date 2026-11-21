import type { CitationRef, PersonaMode } from "./turn.ts";

export type AgentToolName =
  | "socratic_guard"
  | "check_memory"
  | "search_corpus"
  | "run_rag_eval"
  | "synthesize_visual_svg"
  | "generate_mastery_quiz"
  | "commit_living_note";

export type AgentPhase = "plan" | "act" | "observe" | "verify" | "replan";

export interface AgentStepTrace {
  readonly stepIndex: number;
  readonly phase: AgentPhase;
  readonly tool?: AgentToolName;
  readonly thought: string;
  readonly observation: string;
  readonly durationMs: number;
}

export interface MasteryQuizItem {
  readonly quizId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly correctIndex: number;
  readonly explanation: string;
  readonly conceptTopic: string;
}

export interface LivingNoteExport {
  readonly title: string;
  readonly markdown: string;
  readonly ankiCsvRow: string;
  readonly citations: readonly CitationRef[];
}

export type ExportFormat = "pdf" | "docx" | "xlsx" | "markdown" | "anki_csv";

export interface DocumentExportData {
  readonly title: string;
  readonly markdown: string;
  readonly citations?: readonly CitationRef[] | undefined;
  readonly quiz?: MasteryQuizItem | undefined;
  readonly mode?: PersonaMode | undefined;
  readonly createdAtMs?: number | undefined;
}

export interface AgentRunResult {
  readonly runId: string;
  readonly goal: string;
  readonly mode: PersonaMode;
  readonly status: "awaiting_mastery_check" | "socratic_paused" | "completed";
  readonly plan: readonly string[];
  readonly steps: readonly AgentStepTrace[];
  readonly synthesisMarkdown: string;
  readonly visualSvg?: string;
  readonly citations: readonly CitationRef[];
  readonly quiz?: MasteryQuizItem;
  readonly livingNote?: LivingNoteExport;
}

export interface QuizEvaluationResult {
  readonly quizId: string;
  readonly passed: boolean;
  readonly selectedIndex: number;
  readonly correctIndex: number;
  readonly feedback: string;
  readonly replanSteps: readonly AgentStepTrace[];
  readonly livingNote: LivingNoteExport;
  readonly nextReviewDays: number;
}
