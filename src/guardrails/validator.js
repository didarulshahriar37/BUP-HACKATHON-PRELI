// Deterministic guardrails to validate and sanitize LLM output before it hits the optimizer

const VALID_DIRECTIVES = new Set([
  'solar_reduction',
  'minimum_battery_reserve',
  'no_charge_window',
  'no_discharge_window',
  'max_grid_window',
  'no_op'
]);

// Normalizes and sorts an array of hours to unique integers between 0 and 23
function sanitizeHours(rawHours) {
  if (!Array.isArray(rawHours)) return [];
  const set = new Set();
  for (const h of rawHours) {
    const num = Number(h);
    if (Number.isInteger(num) && num >= 0 && num <= 23) {
      set.add(num);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

// Fallback entry for notes that fail validation or are distractors
function makeNoOp(idx, explanation = 'Safe fallback: treated as no-op.') {
  return {
    note_index: idx,
    applies: false,
    directive_type: 'no_op',
    structured_adjustment: null,
    explanation
  };
}

/**
 * Validates untrusted LLM interpretations against the strict GridWise specification.
 * Guarantees that bad model output will never crash the system or inject invalid constraints.
 */
export function validateAndSanitizeDirectives(rawInterpretations, operatorNotes, battery) {
  const noteCount = Array.isArray(operatorNotes) ? operatorNotes.length : 0;
  const sanitized = [];

  // Build a map of raw outputs by note_index
  const entryMap = new Map();
  if (Array.isArray(rawInterpretations)) {
    rawInterpretations.forEach(item => {
      if (item && typeof item.note_index === 'number') {
        entryMap.set(item.note_index, item);
      }
    });
  }

  for (let i = 0; i < noteCount; i++) {
    const raw = entryMap.get(i) || (Array.isArray(rawInterpretations) ? rawInterpretations[i] : null);

    if (!raw || typeof raw !== 'object') {
      sanitized.push(makeNoOp(i, 'Missing or unparseable note interpretation.'));
      continue;
    }

    let { directive_type, applies, structured_adjustment, explanation } = raw;
    explanation = typeof explanation === 'string' && explanation.trim().length > 0 
      ? explanation.trim() 
      : 'Operator directive processed.';

    // Reject unrecognized directive types
    if (!VALID_DIRECTIVES.has(directive_type)) {
      sanitized.push(makeNoOp(i, `Unsupported directive type "${directive_type}", defaulting to no_op.`));
      continue;
    }

    // no_op must strictly use applies = false and structured_adjustment = null
    if (directive_type === 'no_op') {
      sanitized.push({
        note_index: i,
        applies: false,
        directive_type: 'no_op',
        structured_adjustment: null,
        explanation
      });
      continue;
    }

    // Non-no_op directives require structured adjustments
    if (!structured_adjustment || typeof structured_adjustment !== 'object') {
      sanitized.push(makeNoOp(i, `Directive "${directive_type}" missing adjustment details.`));
      continue;
    }

    const cleanHours = sanitizeHours(structured_adjustment.hours);
    if (cleanHours.length === 0) {
      sanitized.push(makeNoOp(i, `Directive "${directive_type}" specified no valid hours.`));
      continue;
    }

    // Directive-specific validation
    if (directive_type === 'solar_reduction') {
      let factor = Number(structured_adjustment.factor);
      if (isNaN(factor) || factor < 0 || factor > 1) {
        sanitized.push(makeNoOp(i, 'Invalid solar factor, must be in [0, 1].'));
        continue;
      }
      // Round to 4 decimal places for clean floating point representation
      factor = Math.round(factor * 10000) / 10000;
      sanitized.push({
        note_index: i,
        applies: true,
        directive_type: 'solar_reduction',
        structured_adjustment: {
          hours: cleanHours,
          factor
        },
        explanation
      });
    } else if (directive_type === 'minimum_battery_reserve') {
      let minEnergy = Number(structured_adjustment.minimum_energy_kwh);
      const capacity = battery?.capacity_kwh || 1000;
      if (isNaN(minEnergy) || minEnergy < 0) {
        sanitized.push(makeNoOp(i, 'Invalid minimum battery reserve value.'));
        continue;
      }
      minEnergy = Math.min(minEnergy, capacity);
      sanitized.push({
        note_index: i,
        applies: true,
        directive_type: 'minimum_battery_reserve',
        structured_adjustment: {
          hours: cleanHours,
          minimum_energy_kwh: Math.round(minEnergy * 100) / 100
        },
        explanation
      });
    } else if (directive_type === 'no_charge_window') {
      sanitized.push({
        note_index: i,
        applies: true,
        directive_type: 'no_charge_window',
        structured_adjustment: {
          hours: cleanHours
        },
        explanation
      });
    } else if (directive_type === 'no_discharge_window') {
      sanitized.push({
        note_index: i,
        applies: true,
        directive_type: 'no_discharge_window',
        structured_adjustment: {
          hours: cleanHours
        },
        explanation
      });
    } else if (directive_type === 'max_grid_window') {
      let maxGrid = Number(structured_adjustment.max_grid_kwh);
      if (isNaN(maxGrid) || maxGrid < 0) {
        sanitized.push(makeNoOp(i, 'Invalid max_grid_kwh limit.'));
        continue;
      }
      sanitized.push({
        note_index: i,
        applies: true,
        directive_type: 'max_grid_window',
        structured_adjustment: {
          hours: cleanHours,
          max_grid_kwh: Math.round(maxGrid * 100) / 100
        },
        explanation
      });
    }
  }

  return sanitized;
}
