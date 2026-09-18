// Complete end-to-end energy optimization pipeline
import { interpretOperatorNotes } from './llm/interpreter.js';
import { validateAndSanitizeDirectives } from './guardrails/validator.js';
import { optimizeEnergySchedule } from './optimizer/energyOptimizer.js';

/**
 * Executes the complete 3-stage GridWise workflow:
 * 1. Understands operator notes using the LLM.
 * 2. Validates and sanitizes extracted directives through deterministic guardrails.
 * 3. Solves the 24-hour cost minimization problem and returns the full response contract.
 */
export async function runEnergyOptimizationPipeline(scenario) {
  const { scenario_id, operator_notes, hours, battery } = scenario;

  // Step 1: LLM natural language parsing
  const rawInterpretations = await interpretOperatorNotes(operator_notes, battery);

  // Step 2: Deterministic guardrail validation
  const sanitizedDirectives = validateAndSanitizeDirectives(
    rawInterpretations,
    operator_notes,
    battery
  );

  // Step 3: Mathematical optimization via linear programming
  const result = optimizeEnergySchedule(
    { scenario_id, hours, battery },
    sanitizedDirectives
  );

  return result;
}
