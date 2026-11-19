import type {
  PersonaMode,
  SafetyEvaluation,
  SocraticSafetyContract,
} from "@openlearnos/contracts";

const DIRECT_ANSWER_PATTERNS: readonly RegExp[] = [
  /直接.*(告诉我|给|写出).*(答案|结果|解)/i,
  /帮我(把|做|写完).*(作业|试卷|题目)/i,
  /不要解释.*只要答案/i,
  /just\s+give\s+me\s+the\s+(final\s+)?answer/i,
  /do\s+my\s+homework\s+for\s+me/i,
  /no\s+explanation[,\s]+only\s+answer/i,
];

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bAIzaSy[0-9A-Za-z_-]{20,}\b/g,
  /\bsk-[0-9A-Za-z_-]{16,}\b/g,
  /\bghp_[0-9A-Za-z]{20,}\b/g,
  /\bBearer\s+[0-9A-Za-z._-]{20,}\b/gi,
];

/**
 * Pedagogical K-12 Socratic Gate + Zero-Plaintext Secret Redactor.
 */
export class SocraticSafetyGate implements SocraticSafetyContract {
  evaluateInput(
    mode: PersonaMode,
    userPrompt: string,
    guardianRevealUnlocked: boolean
  ): SafetyEvaluation {
    if (mode !== "k12" || guardianRevealUnlocked) {
      return {
        allowed: true,
        action: "pass",
        reason: mode === "k12" ? "guardian_unlocked" : "non_k12_mode",
      };
    }

    const asksDirectAnswer = DIRECT_ANSWER_PATTERNS.some((re) => re.test(userPrompt));
    if (asksDirectAnswer) {
      return {
        allowed: true,
        action: "socratic_redirect",
        reason: "k12_anti_cheat_socratic_gate",
        guidancePrompt:
          "我先不直接给出最终答案，我们一步步来攻克它：请你先写出题目中已知的条件，或者告诉我你第一步卡在哪里？",
      };
    }

    return {
      allowed: true,
      action: "pass",
      reason: "k12_guided_question_ok",
    };
  }

  redactSecrets(rawText: string): string {
    let scrubbed = rawText;
    for (const pattern of SECRET_PATTERNS) {
      scrubbed = scrubbed.replace(pattern, "[REDACTED_SECRET]");
    }
    return scrubbed;
  }
}
