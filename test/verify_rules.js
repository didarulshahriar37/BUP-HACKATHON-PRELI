// Quick sanity check script to verify test framework imports
import { evaluateSolution } from './judge_replay.js';

console.log('Rule evaluation checks configured:');
console.log('- Request/response schema and types');
console.log('- Directive mapping, hours normalization (0-23 sorted), applies flags');
console.log('- Hourly energy conservation and solar limits');
console.log('- Battery bounds, limits, and end-of-day neutrality');
console.log('- Recalculated cost comparisons');
console.log('Ready.');
