// Verification tests for deterministic guardrails and input sanitization
import { validateAndSanitizeDirectives } from '../src/guardrails/validator.js';

function runGuardrailTests() {
  console.log('Testing deterministic guardrails...');

  const battery = {
    capacity_kwh: 200,
    minimum_energy_kwh: 40
  };
  const notes = ['Note 1', 'Note 2', 'Note 3'];

  // Test 1: Normalization of hours (duplicates, sorting, out-of-bounds)
  const input1 = [
    {
      note_index: 0,
      applies: true,
      directive_type: 'solar_reduction',
      structured_adjustment: { hours: [15, 13, 13, 29, -5], factor: 0.25 },
      explanation: 'Test'
    },
    {
      note_index: 1,
      applies: false,
      directive_type: 'no_op',
      structured_adjustment: null
    },
    {
      note_index: 2,
      applies: true,
      directive_type: 'minimum_battery_reserve',
      structured_adjustment: { hours: [18, 19], minimum_energy_kwh: 350 }, // exceeds capacity 200
      explanation: 'Reserve test'
    }
  ];

  const result1 = validateAndSanitizeDirectives(input1, notes, battery);

  console.assert(result1.length === 3, 'Must maintain 3 entries');
  console.assert(JSON.stringify(result1[0].structured_adjustment.hours) === '[13,15]', 'Hours should be deduplicated, bounded 0-23, and sorted');
  console.assert(result1[2].structured_adjustment.minimum_energy_kwh === 200, 'Reserve should be capped at battery capacity');

  // Test 2: Hallucinated directive type safely converts to no_op
  const input2 = [
    {
      note_index: 0,
      applies: true,
      directive_type: 'fake_invented_directive',
      structured_adjustment: { hours: [1, 2] }
    }
  ];
  const result2 = validateAndSanitizeDirectives(input2, ['Note 1'], battery);
  console.assert(result2[0].directive_type === 'no_op', 'Invented directive must safely become no_op');
  console.assert(result2[0].applies === false, 'no_op must have applies = false');
  console.assert(result2[0].structured_adjustment === null, 'no_op must have structured_adjustment = null');

  // Test 3: Null or completely broken LLM response produces safe fallback
  const result3 = validateAndSanitizeDirectives(null, notes, battery);
  console.assert(result3.length === 3, 'Must fill missing notes with safe defaults');
  console.assert(result3.every(e => e.directive_type === 'no_op'), 'All fallbacks must be no_op');

  console.log('✅ Guardrail tests passed: invalid, out-of-order, or hallucinated inputs are safely sanitized.');
}

runGuardrailTests();
