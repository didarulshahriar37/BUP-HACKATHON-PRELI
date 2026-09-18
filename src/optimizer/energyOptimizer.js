// Mathematical optimization engine for 24-hour campus energy dispatch using linear programming
import solver from 'javascript-lp-solver';

/**
 * Optimizes 24-hour campus electricity cost while strictly obeying:
 * - Energy conservation balance: grid + solar_used + discharge = demand + charge
 * - Effective solar availability after reductions
 * - Battery charge/discharge rate limits and state bounds
 * - End-of-day battery neutrality
 * - Active operator directives (windows, caps, reserves)
 */
export function optimizeEnergySchedule(scenario, directives = []) {
  const { scenario_id, hours, battery } = scenario;

  // Track operational constraints across the 24 hours
  const effectiveSolar = hours.map(h => h.solar_kwh);
  const minReserve = hours.map(() => battery.minimum_energy_kwh);
  const noChargeHours = new Set();
  const noDischargeHours = new Set();
  const maxGridCaps = {};

  // Apply parsed operator directives
  directives.forEach(dir => {
    if (!dir.applies || !dir.structured_adjustment) return;
    const hList = dir.structured_adjustment.hours || [];
    if (dir.directive_type === 'solar_reduction') {
      const factor = dir.structured_adjustment.factor;
      hList.forEach(h => {
        effectiveSolar[h] = hours[h].solar_kwh * factor;
      });
    } else if (dir.directive_type === 'minimum_battery_reserve') {
      const reserve = dir.structured_adjustment.minimum_energy_kwh;
      hList.forEach(h => {
        minReserve[h] = Math.max(minReserve[h], reserve);
      });
    } else if (dir.directive_type === 'no_charge_window') {
      hList.forEach(h => noChargeHours.add(h));
    } else if (dir.directive_type === 'no_discharge_window') {
      hList.forEach(h => noDischargeHours.add(h));
    } else if (dir.directive_type === 'max_grid_window') {
      const cap = dir.structured_adjustment.max_grid_kwh;
      hList.forEach(h => {
        maxGridCaps[h] = cap;
      });
    }
  });

  // Construct the linear program
  const model = {
    optimize: "cost",
    opType: "min",
    constraints: {},
    variables: {}
  };

  // End-of-day battery neutrality constraint
  model.constraints['eod_neutrality'] = { equal: battery.initial_energy_kwh };

  for (let h = 0; h < 24; h++) {
    const demand = hours[h].demand_kwh;
    const tariff = hours[h].tariff_bdt_per_kwh;
    const solarMax = effectiveSolar[h];
    const chargeMax = noChargeHours.has(h) ? 0 : battery.max_charge_kwh_per_hour;
    const dischargeMax = noDischargeHours.has(h) ? 0 : battery.max_discharge_kwh_per_hour;
    const gridMax = maxGridCaps[h] !== undefined ? maxGridCaps[h] : 100000;
    const reserveMin = minReserve[h];
    const capacityMax = battery.capacity_kwh;

    // Hourly energy balance: Grid + Solar + Discharge - Charge = Demand
    model.constraints[`bal_${h}`] = { equal: demand };

    // Hourly physical limits
    model.constraints[`solar_lim_${h}`] = { max: solarMax };
    model.constraints[`charge_lim_${h}`] = { max: chargeMax };
    model.constraints[`discharge_lim_${h}`] = { max: dischargeMax };
    model.constraints[`grid_lim_${h}`] = { max: gridMax };
    model.constraints[`batt_level_${h}`] = { min: reserveMin, max: capacityMax };

    // Battery state transition: E_h - E_{h-1} - C_h + D_h = 0
    if (h === 0) {
      model.constraints[`trans_0`] = { equal: battery.initial_energy_kwh };
    } else {
      model.constraints[`trans_${h}`] = { equal: 0 };
    }

    // Decision variables
    model.variables[`G_${h}`] = {
      cost: tariff,
      [`bal_${h}`]: 1,
      [`grid_lim_${h}`]: 1
    };

    model.variables[`S_${h}`] = {
      cost: 0,
      [`bal_${h}`]: 1,
      [`solar_lim_${h}`]: 1
    };

    model.variables[`C_${h}`] = {
      cost: 0.000001, // negligible cost to avoid simultaneous charge & discharge
      [`bal_${h}`]: -1,
      [`charge_lim_${h}`]: 1,
      [`trans_${h}`]: -1
    };

    model.variables[`D_${h}`] = {
      cost: 0.000001,
      [`bal_${h}`]: 1,
      [`discharge_lim_${h}`]: 1,
      [`trans_${h}`]: 1
    };

    model.variables[`E_${h}`] = {
      cost: 0,
      [`batt_level_${h}`]: 1,
      [`trans_${h}`]: 1
    };

    if (h < 23) {
      model.variables[`E_${h}`][`trans_${h+1}`] = -1;
    } else {
      model.variables[`E_${h}`]['eod_neutrality'] = 1;
    }
  }

  // Solve the LP model
  const solution = solver.Solve(model);

  if (!solution.feasible) {
    throw new Error(`Infeasible energy scenario encountered for ${scenario_id}`);
  }

  // Build the hour-by-hour operational schedule
  const hourly_plan = [];
  let total_grid_kwh = 0;
  let total_cost_bdt = 0;
  let peak_grid_kwh = 0;

  for (let h = 0; h < 24; h++) {
    const rawG = solution[`G_${h}`] || 0;
    const rawS = solution[`S_${h}`] || 0;
    const rawC = solution[`C_${h}`] || 0;
    const rawD = solution[`D_${h}`] || 0;
    const rawE = solution[`E_${h}`] || battery.initial_energy_kwh;

    // Resolve battery action and clean rounding
    const netBattery = rawC - rawD;
    let battery_action = 'idle';
    let battery_kwh = 0;

    if (netBattery > 0.0001) {
      battery_action = 'charge';
      battery_kwh = Math.round(netBattery * 1000) / 1000;
    } else if (netBattery < -0.0001) {
      battery_action = 'discharge';
      battery_kwh = Math.round(-netBattery * 1000) / 1000;
    }

    const grid_kwh = Math.round(rawG * 1000) / 1000;
    const solar_used_kwh = Math.round(rawS * 1000) / 1000;
    const battery_energy_after_kwh = Math.round(rawE * 1000) / 1000;

    hourly_plan.push({
      hour: h,
      grid_kwh,
      solar_used_kwh,
      battery_action,
      battery_kwh,
      battery_energy_after_kwh
    });

    total_grid_kwh += grid_kwh;
    total_cost_bdt += grid_kwh * hours[h].tariff_bdt_per_kwh;
    if (grid_kwh > peak_grid_kwh) {
      peak_grid_kwh = grid_kwh;
    }
  }

  total_grid_kwh = Math.round(total_grid_kwh * 100) / 100;
  total_cost_bdt = Math.round(total_cost_bdt * 100) / 100;
  peak_grid_kwh = Math.round(peak_grid_kwh * 100) / 100;

  // Generate a clear summary of operational strategy
  const activeTypes = directives
    .filter(d => d.applies && d.directive_type !== 'no_op')
    .map(d => d.directive_type.replace(/_/g, ' '));
  
  let summary = activeTypes.length > 0
    ? `Schedule optimized incorporating operator directives (${activeTypes.join(', ')}). `
    : `Baseline cost minimization schedule. `;
  summary += `Shifts grid purchases to lower tariff windows while maintaining battery neutrality and grid constraints.`;

  return {
    scenario_id,
    directive_interpretation: directives,
    hourly_plan,
    total_grid_kwh,
    total_cost_bdt,
    peak_grid_kwh,
    plan_summary: summary
  };
}
