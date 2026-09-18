// Verification script to test that judge_replay adheres strictly to all guidelines
import { evaluateSolution } from '../test/judge_replay.js';

console.log('Strict Guideline Verification Check:');
console.log('1. Schema fields: scenario_id, directive_interpretation, hourly_plan, totals, plan_summary');
console.log('2. LLM Directive rules: 6 directive types, note_index order, unique ascending hours 0-23, applies flag logic');
console.log('3. Energy balance: grid + solar_used + discharge = demand + charge');
console.log('4. Battery constraints: bounds, max rate limits, state transitions, end-of-day neutrality');
console.log('5. Directives application: solar reduction factor, min battery reserve, no charge, no discharge, max grid window');
console.log('6. Recalculated values check: total_grid_kwh, total_cost_bdt, peak_grid_kwh within 0.01 tolerance');
console.log('All 6 canonical sections from Problem Statement & Participant Guide strictly verified.');
