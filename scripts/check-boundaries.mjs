#!/usr/bin/env node
/**
 * Gate 1: Box-with-Invariants Architectural Boundary Enforcer.
 * Verifies strict unidirectional dependency & thread-isolation rules across packages/* and apps/web/*.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PACKAGES_DIR = path.join(ROOT, "packages");

const FORBIDDEN_RULES = {
  contracts: [
    /@openlearnos\/(core|ui|harness)/,
    /from\s+["'](react|vue|svelte|openai|@anthropic-ai|@google\/genai|node:fs|node:http)["']/,
    /\b(window|document)\./,
  ],
  core: [
    /@openlearnos\/(ui|harness)/,
    /from\s+["'](react|vue|svelte|openai|@anthropic-ai|@google\/genai)["']/,
    /\b(window|document)\./,
  ],
  ui: [
    /@openlearnos\/(core|harness)/,
    /packages\/core/,
    /process\.env\.[A-Z0-9_]*KEY/,
  ],
};

function walkTsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      results.push(...walkTsFiles(full));
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const violations = [];

for (const [pkg, patterns] of Object.entries(FORBIDDEN_RULES)) {
  const srcDir = path.join(PACKAGES_DIR, pkg, "src");
  for (const file of walkTsFiles(srcDir)) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(ROOT, file);
    for (const re of patterns) {
      if (re.test(content)) {
        violations.push(`${rel} violated boundary rule: ${re}`);
      }
    }
  }
}

// Enforce Worker Physical Isolation inside apps/web:
// ONLY apps/web/src/worker/* may import @openlearnos/core; UI thread files must go through RPC!
const webSrcDir = path.join(ROOT, "apps", "web", "src");
for (const file of walkTsFiles(webSrcDir)) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(`apps${path.sep}web${path.sep}src${path.sep}worker${path.sep}`)) continue;
  const content = fs.readFileSync(file, "utf8");
  if (/from\s+["']@openlearnos\/core/.test(content) || /import\s*\(\s*["']@openlearnos\/core/.test(content) || /from\s+["'][^"']*packages\/core/.test(content)) {
    violations.push(`${rel} bypassed Web Worker RPC boundary by importing @openlearnos/core directly`);
  }
}

if (violations.length > 0) {
  console.error("[FAIL] Architectural Boundary Gate failed:");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}

console.log("[PASS] Gate 1 — Architectural Boundaries & Worker Isolation (Box with Invariants): 0 violations.");
