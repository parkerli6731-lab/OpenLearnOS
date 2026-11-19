#!/usr/bin/env node
/**
 * Gate 2: Zero-Plaintext Secret Scanner & Clean-Room Trademark Hygiene Gate.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SECRET_REGEXES = [
  /\bAIzaSy[0-9A-Za-z_-]{20,}\b/,
  /\bsk-(proj-|live-|ant-)?[0-9A-Za-z_-]{20,}\b/,
  /\bghp_[0-9A-Za-z]{20,}\b/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

// Prohibited third-party brand terms must NEVER leak into runtime code (packages/*/src)
const PROHIBITED_TRADEMARK_REGEXES = [
  /\bdeeptutor\b/i,
  /\bhkuds\b/i,
];

function walkAll(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAll(full));
    else out.push(full);
  }
  return out;
}

const errors = [];

for (const file of walkAll(ROOT)) {
  const rel = path.relative(ROOT, file);
  const content = fs.readFileSync(file, "utf8");

  // 1. Secret check across entire repository (excluding this scanner's own regex definitions)
  if (rel !== "scripts/check-security-and-ip.mjs") {
    for (const re of SECRET_REGEXES) {
      if (re.test(content)) {
        errors.push(`SECRET_LEAK in ${rel}: matched ${re}`);
      }
    }
  }

  // 2. Trademark clean-room hygiene in runtime source packages & apps
  if ((rel.startsWith("packages/") || rel.startsWith("apps/")) && rel.includes("/src/")) {
    for (const re of PROHIBITED_TRADEMARK_REGEXES) {
      if (re.test(content)) {
        errors.push(`TRADEMARK_BLEED in ${rel}: matched ${re}`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("[FAIL] Gate 2 — Security & Clean-Room IP Gate failed:");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("[PASS] Gate 2 — Zero-Leak Secrets & Clean-Room Trademark Gate: 0 violations.");
