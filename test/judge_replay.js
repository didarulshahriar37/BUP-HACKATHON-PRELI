import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Independent Judge Replay and Verification Engine
 * Implements all checks specified in:
 * - Section 08 & 09 of Participant Guide & Evaluation Rubric
 * - Section 09 & 11 of Preliminary Problem Statement
 */

const TOLERANCE = 0.01;

export function evaluateSolution(input, response, expectedOutput = null) {
  const errors = [];
  const warnings = [];

  // 1. Schema & Top-Level Validation
  if (!response) {
    return { valid: false, errors: ['Null or undefined response received'], score: 0 };
  }

  if (response.scenario_id !== input.scenario_id) {
    errors.push(`scenario_id mismatch: expected "${input.scenario_id}", got "${response.scenario_id}"`);
  }

  if (!Array.isArray(response.directive_interpretation)) {
    errors.push('directive_interpretation must be an array');
  } else if (response.directive_interpretation.length !== input.operator_notes.length) {
    errors.push(`directive_interpretation length (${response.directive_interpretation.length}) does not match operator_notes length (${input.operator_notes.length})`);
  }

  if (!Array.isArray(response.hourly_plan) || response.hourly_plan.length !== 24) {
    errors.push(`hourly_plan must contain exactly 24 entries, got ${response.hourly_plan?.length}`);
  }

  if (typeof response.total_grid_kwh !== 'number' || response.total_grid_kwh < 0) {
    errors.push('total_grid_kwh must be a non-negative number');
  }
  if (typeof response.total_cost_bdt !== 'number' || response.total_cost_bdt < 0) {
    errors.push('total_cost_bdt must be a non-negative number');
  }
  if (typeof response.peak_grid_kwh !== 'number' || response.peak_grid_kwh < 0) {
    errors.push('peak_grid_kwh must be a non-negative number');
  }
  if (typeof response.plan_summary !== 'string' || response.plan_summary.trim().length === 0) {
    errors.push('plan_summary must be a non-empty string');
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, score: 0 };
  }

  // 2. Directive Interpretation Verification
  const allowedDirectives = [
    'solar_reduction',
    'minimum_battery_reserve',
    'no_charge_window',
    'no_discharge_window',
    'max_grid_window',
    'no_op'
  ];

  response.directive_interpretation.forEach((entry, idx) => {
    if (entry.note_index !== idx) {
      errors.push(`directive_interpretation[${idx}].note_index is ${entry.note_index}, expected ${idx}`);
    }
    if (!allowedDirectives.includes(entry.directive_type)) {
      errors.push(`Invalid directive_type "${entry.directive_type}" at index ${idx}`);
    }
    if (entry.directive_type === 'no_op') {
      if (entry.applies !== false) {
        errors.push(`no_op directive at index ${idx} must have applies = false`);
      }
      if (entry.structured_adjustment !== null) {
        errors.push(`no_op directive at index ${idx} must have structured_adjustment = null`);
      }
    } else {
      if (entry.applies !== true) {
        errors.push(`Directive "${entry.directive_type}" at index ${idx} must have applies = true`);
      }
      if (!entry.structured_adjustment || typeof entry.structured_adjustment !== 'object') {
        errors.push(`Directive "${entry.directive_type}" at index ${idx} requires structured_adjustment object`);
      } else {
        const adj = entry.structured_adjustment;
        if (!Array.isArray(adj.hours)) {
          errors.push(`structured_adjustment.hours must be an array at index ${idx}`);
        } else {
          // Check hours are unique, sorted, 0..23
          for (let i = 0; i < adj.hours.length; i++) {
            const h = adj.hours[i];
            if (!Number.isInteger(h) || h < 0 || h > 23) {
              errors.push(`Invalid hour ${h} in directive at index ${idx}`);
            }
            if (i > 0 && h <= adj.hours[i - 1]) {
              errors.push(`Hours in directive at index ${idx} must be strictly ascending unique integers`);
            }
          }
        }
        if (entry.directive_type === 'solar_reduction') {
          if (typeof adj.factor !== 'number' || adj.factor < 0 || adj.factor > 1) {
            errors.push(`solar_reduction requires factor in range [0, 1] at index ${idx}, got ${adj.factor}`);
          }
        }
        if (entry.directive_type === 'minimum_battery_reserve') {
          if (typeof adj.minimum_energy_kwh !== 'number' || adj.minimum_energy_kwh < 0 || adj.minimum_energy_kwh > input.battery.capacity_kwh) {
            errors.push(`minimum_battery_reserve requires minimum_energy_kwh in [0, capacity] at index ${idx}`);
          }
        }
        if (entry.directive_type === 'max_grid_window') {
          if (typeof adj.max_grid_kwh !== 'number' || adj.max_grid_kwh < 0) {
            errors.push(`max_grid_window requires non-negative max_grid_kwh at index ${idx}`);
          }
        }
      }
    }
  });

  // Compare with expected directives if available
  let directiveMatch = true;
  if (expectedOutput && expectedOutput.directive_interpretation) {
    expectedOutput.directive_interpretation.forEach((exp, idx) => {
      const actual = response.directive_interpretation[idx];
      if (!actual) {
        directiveMatch = false;
        errors.push(`Missing directive interpretation for note ${idx}`);
        return;
      }
      if (actual.applies !== exp.applies) {
        directiveMatch = false;
        errors.push(`Note ${idx}: applies expected ${exp.applies}, got ${actual.applies}`);
      }
      if (actual.directive_type !== exp.directive_type) {
        directiveMatch = false;
        errors.push(`Note ${idx}: directive_type expected "${exp.directive_type}", got "${actual.directive_type}"`);
      }
      if (exp.structured_adjustment) {
        if (!actual.structured_adjustment) {
          directiveMatch = false;
          errors.push(`Note ${idx}: expected structured_adjustment, got null`);
        } else {
          // Compare hours
          const expHours = JSON.stringify(exp.structured_adjustment.hours || []);
          const actHours = JSON.stringify(actual.structured_adjustment.hours || []);
          if (expHours !== actHours) {
            directiveMatch = false;
            errors.push(`Note ${idx}: hours expected ${expHours}, got ${actHours}`);
          }
          if (exp.structured_adjustment.factor !== undefined) {
            if (Math.abs(actual.structured_adjustment.factor - exp.structured_adjustment.factor) > TOLERANCE) {
              directiveMatch = false;
              errors.push(`Note ${idx}: factor expected ${exp.structured_adjustment.factor}, got ${actual.structured_adjustment.factor}`);
            }
          }
          if (exp.structured_adjustment.minimum_energy_kwh !== undefined) {
            if (Math.abs(actual.structured_adjustment.minimum_energy_kwh - exp.structured_adjustment.minimum_energy_kwh) > TOLERANCE) {
              directiveMatch = false;
              errors.push(`Note ${idx}: minimum_energy_kwh expected ${exp.structured_adjustment.minimum_energy_kwh}, got ${actual.structured_adjustment.minimum_energy_kwh}`);
            }
          }
          if (exp.structured_adjustment.max_grid_kwh !== undefined) {
            if (Math.abs(actual.structured_adjustment.max_grid_kwh - exp.structured_adjustment.max_grid_kwh) > TOLERANCE) {
              directiveMatch = false;
              errors.push(`Note ${idx}: max_grid_kwh expected ${exp.structured_adjustment.max_grid_kwh}, got ${actual.structured_adjustment.max_grid_kwh}`);
            }
          }
        }
      }
    });
  }

  // 3. Downstream Directives Application & GridWise Physical Consistency Replay
  // Compute ground-truth active directives from expectedOutput (or from response if no expectedOutput)
  const sourceDirectives = (expectedOutput?.directive_interpretation) || response.directive_interpretation;
  
  // Calculate effective solar per hour
  const effectiveSolar = input.hours.map(h => h.solar_kwh);
  const minBatteryReserve = input.hours.map(() => input.battery.minimum_energy_kwh);
  const noChargeHours = new Set();
  const noDischargeHours = new Set();
  const maxGridLimits = {};

  sourceDirectives.forEach(dir => {
    if (!dir.applies || !dir.structured_adjustment) return;
    const { hours } = dir.structured_adjustment;
    if (dir.directive_type === 'solar_reduction') {
      const factor = dir.structured_adjustment.factor;
      hours.forEach(h => {
        effectiveSolar[h] = input.hours[h].solar_kwh * factor;
      });
    } else if (dir.directive_type === 'minimum_battery_reserve') {
      const reqMin = dir.structured_adjustment.minimum_energy_kwh;
      hours.forEach(h => {
        minBatteryReserve[h] = Math.max(minBatteryReserve[h], reqMin);
      });
    } else if (dir.directive_type === 'no_charge_window') {
      hours.forEach(h => noChargeHours.add(h));
    } else if (dir.directive_type === 'no_discharge_window') {
      hours.forEach(h => noDischargeHours.add(h));
    } else if (dir.directive_type === 'max_grid_window') {
      const cap = dir.structured_adjustment.max_grid_kwh;
      hours.forEach(h => {
        maxGridLimits[h] = cap;
      });
    }
  });

  // Replay hourly_plan hour-by-hour
  let currentBatteryEnergy = input.battery.initial_energy_kwh;
  let recomputedTotalGrid = 0;
  let recomputedTotalCost = 0;
  let recomputedPeakGrid = 0;

  response.hourly_plan.forEach((step, h) => {
    if (step.hour !== h) {
      errors.push(`Hour out of order: expected ${h}, got ${step.hour}`);
    }

    const { grid_kwh, solar_used_kwh, battery_action, battery_kwh, battery_energy_after_kwh } = step;

    // Non-negative checks
    if (grid_kwh < -TOLERANCE || solar_used_kwh < -TOLERANCE || battery_kwh < -TOLERANCE) {
      errors.push(`Hour ${h}: negative energy values detected`);
    }

    // Solar usage <= effective solar
    if (solar_used_kwh > effectiveSolar[h] + TOLERANCE) {
      errors.push(`Hour ${h}: solar_used_kwh (${solar_used_kwh}) exceeds effective solar (${effectiveSolar[h]})`);
    }

    // Battery action check
    if (!['charge', 'discharge', 'idle'].includes(battery_action)) {
      errors.push(`Hour ${h}: invalid battery_action "${battery_action}"`);
    }
    if (battery_action === 'idle' && battery_kwh > TOLERANCE) {
      errors.push(`Hour ${h}: battery_action is idle but battery_kwh is ${battery_kwh}`);
    }

    // Rate limits
    if (battery_action === 'charge' && battery_kwh > input.battery.max_charge_kwh_per_hour + TOLERANCE) {
      errors.push(`Hour ${h}: charge amount ${battery_kwh} exceeds max_charge ${input.battery.max_charge_kwh_per_hour}`);
    }
    if (battery_action === 'discharge' && battery_kwh > input.battery.max_discharge_kwh_per_hour + TOLERANCE) {
      errors.push(`Hour ${h}: discharge amount ${battery_kwh} exceeds max_discharge ${input.battery.max_discharge_kwh_per_hour}`);
    }

    // Directive-specific limits
    if (noChargeHours.has(h) && battery_action === 'charge' && battery_kwh > TOLERANCE) {
      errors.push(`Hour ${h}: charging occurred during active no_charge_window`);
    }
    if (noDischargeHours.has(h) && battery_action === 'discharge' && battery_kwh > TOLERANCE) {
      errors.push(`Hour ${h}: discharging occurred during active no_discharge_window`);
    }
    if (maxGridLimits[h] !== undefined && grid_kwh > maxGridLimits[h] + TOLERANCE) {
      errors.push(`Hour ${h}: grid_kwh (${grid_kwh}) exceeds max_grid_window limit (${maxGridLimits[h]})`);
    }

    // Battery state transition
    let expectedAfter = currentBatteryEnergy;
    if (battery_action === 'charge') {
      expectedAfter += battery_kwh;
    } else if (battery_action === 'discharge') {
      expectedAfter -= battery_kwh;
    }
    if (Math.abs(battery_energy_after_kwh - expectedAfter) > TOLERANCE) {
      errors.push(`Hour ${h}: battery_energy_after_kwh (${battery_energy_after_kwh}) does not match transition (${expectedAfter})`);
    }

    // Battery bounds
    if (battery_energy_after_kwh < minBatteryReserve[h] - TOLERANCE) {
      errors.push(`Hour ${h}: battery energy (${battery_energy_after_kwh}) below reserve (${minBatteryReserve[h]})`);
    }
    if (battery_energy_after_kwh > input.battery.capacity_kwh + TOLERANCE) {
      errors.push(`Hour ${h}: battery energy (${battery_energy_after_kwh}) exceeds capacity (${input.battery.capacity_kwh})`);
    }

    // Energy balance: grid + solar_used + discharge = demand + charge
    const chargeKwh = battery_action === 'charge' ? battery_kwh : 0;
    const dischargeKwh = battery_action === 'discharge' ? battery_kwh : 0;
    const supply = grid_kwh + solar_used_kwh + dischargeKwh;
    const demand = input.hours[h].demand_kwh + chargeKwh;
    if (Math.abs(supply - demand) > TOLERANCE) {
      errors.push(`Hour ${h}: energy balance violated. Supply=${supply}, Demand=${demand}, diff=${Math.abs(supply - demand)}`);
    }

    // Accumulate totals
    currentBatteryEnergy = battery_energy_after_kwh;
    recomputedTotalGrid += grid_kwh;
    recomputedTotalCost += grid_kwh * input.hours[h].tariff_bdt_per_kwh;
    if (grid_kwh > recomputedPeakGrid) {
      recomputedPeakGrid = grid_kwh;
    }
  });

  // End-of-day battery neutrality
  if (Math.abs(currentBatteryEnergy - input.battery.initial_energy_kwh) > TOLERANCE) {
    errors.push(`End-of-day battery energy (${currentBatteryEnergy}) does not return to initial (${input.battery.initial_energy_kwh})`);
  }

  // Check reported totals vs recomputed totals
  if (Math.abs(response.total_grid_kwh - recomputedTotalGrid) > TOLERANCE) {
    errors.push(`Reported total_grid_kwh (${response.total_grid_kwh}) does not match recomputed (${recomputedTotalGrid})`);
  }
  if (Math.abs(response.total_cost_bdt - recomputedTotalCost) > TOLERANCE) {
    errors.push(`Reported total_cost_bdt (${response.total_cost_bdt}) does not match recomputed (${recomputedTotalCost})`);
  }
  if (Math.abs(response.peak_grid_kwh - recomputedPeakGrid) > TOLERANCE) {
    errors.push(`Reported peak_grid_kwh (${response.peak_grid_kwh}) does not match recomputed (${recomputedPeakGrid})`);
  }

  // Cost ratio vs expected
  let qualityRatio = 1.0;
  if (expectedOutput) {
    const expCost = expectedOutput.total_cost_bdt;
    if (recomputedTotalCost > 0) {
      qualityRatio = Math.min(1.0, expCost / recomputedTotalCost);
    }
  }

  const valid = errors.length === 0;
  return {
    valid,
    directiveMatch,
    errors,
    warnings,
    recomputedTotalCost,
    expectedCost: expectedOutput?.total_cost_bdt,
    qualityRatio: valid ? qualityRatio : 0
  };
}
