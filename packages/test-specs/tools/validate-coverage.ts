#!/usr/bin/env bun
/**
 * CI Validation Script for BDD Test Coverage
 *
 * Parses all .feature files in packages/test-specs/features/,
 * extracts scenario titles, and verifies that each scenario has
 * a corresponding @Test method in the Android (and eventually iOS) test files.
 *
 * Usage: bun run test-specs:validate
 *
 * Exit codes:
 *   0 — all scenarios have matching tests
 *   1 — missing test implementations found
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";

const ROOT = join(import.meta.dir, "../../..");
const FEATURES_DIR = join(import.meta.dir, "../features");
const ANDROID_TEST_DIR = join(
  ROOT,
  "apps/android/app/src/androidTest/java/org/llamenos/hotline"
);

interface Scenario {
  title: string;
  featureFile: string;
  featureName: string;
  tags: string[];
  isOutline: boolean;
}

interface TestMethod {
  name: string;
  file: string;
  className: string;
}

// ---- Feature file parsing ----

function findFeatureFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...findFeatureFiles(fullPath));
    } else if (entry.endsWith(".feature")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseFeatureFile(path: string): Scenario[] {
  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  const scenarios: Scenario[] = [];
  let featureName = "";
  let currentTags: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Collect feature name
    if (line.startsWith("Feature:")) {
      featureName = line.replace("Feature:", "").trim();
      continue;
    }

    // Collect tags
    if (line.startsWith("@")) {
      currentTags = line
        .split(/\s+/)
        .filter((t) => t.startsWith("@"))
        .map((t) => t.slice(1));
      continue;
    }

    // Match Scenario or Scenario Outline
    const scenarioMatch = line.match(
      /^Scenario(?:\s+Outline)?:\s*(.+)$/
    );
    if (scenarioMatch) {
      scenarios.push({
        title: scenarioMatch[1].trim(),
        featureFile: relative(FEATURES_DIR, path),
        featureName,
        tags: [...currentTags],
        isOutline: line.startsWith("Scenario Outline"),
      });
      currentTags = [];
    }

    // Reset tags if line is not a tag or scenario
    if (!line.startsWith("@") && !line.startsWith("Scenario")) {
      currentTags = [];
    }
  }

  return scenarios;
}

// ---- Android test file parsing ----

function findKotlinTestFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      if (statSync(fullPath).isDirectory()) {
        files.push(...findKotlinTestFiles(fullPath));
      } else if (entry.endsWith("Test.kt")) {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist
  }
  return files;
}

function parseKotlinTestFile(path: string): TestMethod[] {
  const content = readFileSync(path, "utf-8");
  const methods: TestMethod[] = [];
  const classMatch = content.match(/class\s+(\w+)/);
  const className = classMatch?.[1] ?? basename(path, ".kt");

  const methodRegex = /@Test\s*\n\s*fun\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(content)) !== null) {
    methods.push({
      name: match[1],
      file: relative(ANDROID_TEST_DIR, path),
      className,
    });
  }

  return methods;
}

// ---- Scenario title to method name conversion ----

function scenarioToMethodName(title: string): string {
  // Convert "Login screen displays all required elements" → "loginScreenDisplaysAllRequiredElements"
  return title
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((word, i) =>
      i === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join("");
}

// ---- Main ----

function main() {
  console.log("BDD Test Coverage Validation\n");

  // Parse features
  const featureFiles = findFeatureFiles(FEATURES_DIR);
  const allScenarios: Scenario[] = [];
  for (const file of featureFiles) {
    allScenarios.push(...parseFeatureFile(file));
  }

  console.log(
    `Found ${allScenarios.length} scenarios across ${featureFiles.length} feature files\n`
  );

  // Parse Android tests
  const androidTestFiles = findKotlinTestFiles(join(ANDROID_TEST_DIR, "e2e"));
  const allAndroidMethods: TestMethod[] = [];
  for (const file of androidTestFiles) {
    allAndroidMethods.push(...parseKotlinTestFile(file));
  }

  const androidMethodNames = new Set(allAndroidMethods.map((m) => m.name));

  console.log(
    `Found ${allAndroidMethods.length} Android @Test methods across ${androidTestFiles.length} test files\n`
  );

  // Check coverage
  let missingCount = 0;
  let coveredCount = 0;
  let currentFeature = "";

  for (const scenario of allScenarios) {
    if (scenario.featureFile !== currentFeature) {
      currentFeature = scenario.featureFile;
      console.log(`Feature: ${scenario.featureName} (${scenario.featureFile})`);
    }

    const expectedMethod = scenarioToMethodName(scenario.title);
    const androidFound = androidMethodNames.has(expectedMethod);

    if (androidFound) {
      const method = allAndroidMethods.find((m) => m.name === expectedMethod)!;
      console.log(
        `  \u2713 ${scenario.title}\n    Android: ${method.className}.${method.name}`
      );
      coveredCount++;
    } else {
      // Try fuzzy match — check if any method contains the key words
      const fuzzyMatch = allAndroidMethods.find((m) =>
        m.name.toLowerCase().includes(expectedMethod.slice(0, 20).toLowerCase())
      );
      if (fuzzyMatch) {
        console.log(
          `  ~ ${scenario.title}\n    Android: ${fuzzyMatch.className}.${fuzzyMatch.name} (fuzzy match)`
        );
        coveredCount++;
      } else {
        console.log(
          `  \u2717 ${scenario.title}\n    Android: MISSING (expected: ${expectedMethod})`
        );
        missingCount++;
      }
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total scenarios: ${allScenarios.length}`);
  console.log(`Covered: ${coveredCount}`);
  console.log(`Missing: ${missingCount}`);
  console.log(
    `Coverage: ${((coveredCount / allScenarios.length) * 100).toFixed(1)}%`
  );

  if (missingCount > 0) {
    console.log("\nFAILED: Missing test implementations detected.");
    process.exit(1);
  } else {
    console.log("\nPASSED: All scenarios have matching test implementations.");
    process.exit(0);
  }
}

main();
