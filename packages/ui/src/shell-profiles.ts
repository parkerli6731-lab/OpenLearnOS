import type { PersonaMode } from "@openlearnos/contracts";

export interface ShellProfile {
  readonly mode: PersonaMode;
  readonly displayName: string;
  readonly defaultSocraticLock: boolean;
  readonly showGuardianReport: boolean;
  readonly enableDualPanePdf: boolean;
  readonly enableFsrsDailyDeck: boolean;
  readonly enableCliMcpBridge: boolean;
  readonly virtualizedMessageList: true;
  readonly lazyKatexRendering: true;
}

/**
 * One Core Engine, Three Zero-Friction Adaptive Shells.
 * Strictly depends only on @openlearnos/contracts (zero core internal coupling).
 */
export const SHELL_PROFILES: Readonly<Record<PersonaMode, ShellProfile>> = Object.freeze({
  k12: Object.freeze({
    mode: "k12",
    displayName: "Spark (K-12 启蒙与伴学)",
    defaultSocraticLock: true,
    showGuardianReport: true,
    enableDualPanePdf: true,
    enableFsrsDailyDeck: true,
    enableCliMcpBridge: false,
    virtualizedMessageList: true,
    lazyKatexRendering: true,
  }),
  scholar: Object.freeze({
    mode: "scholar",
    displayName: "Scholar (科研与研究生)",
    defaultSocraticLock: false,
    showGuardianReport: false,
    enableDualPanePdf: true,
    enableFsrsDailyDeck: true,
    enableCliMcpBridge: true,
    virtualizedMessageList: true,
    lazyKatexRendering: true,
  }),
  lifelong: Object.freeze({
    mode: "lifelong",
    displayName: "Lifelong (成年人终身学习)",
    defaultSocraticLock: false,
    showGuardianReport: false,
    enableDualPanePdf: true,
    enableFsrsDailyDeck: true,
    enableCliMcpBridge: false,
    virtualizedMessageList: true,
    lazyKatexRendering: true,
  }),
});
