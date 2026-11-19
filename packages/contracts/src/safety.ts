import type { PersonaMode } from "./turn.ts";

export interface ProviderEndpointConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly baseUrl: string;
  /**
   * INVARIANT: Never store or transmit plaintext secrets inside shared specs or logs.
   * Runtime resolves secrets strictly from client-local storage or OS keychain via alias.
   */
  readonly credentialAlias: string;
  readonly isLocalOnly: boolean;
}

export interface SafetyEvaluation {
  readonly allowed: boolean;
  readonly action: "pass" | "socratic_redirect" | "block";
  readonly guidancePrompt?: string;
  readonly reason: string;
}

export interface SocraticSafetyContract {
  evaluateInput(
    mode: PersonaMode,
    userPrompt: string,
    guardianRevealUnlocked: boolean
  ): SafetyEvaluation;
  redactSecrets(rawText: string): string;
}
