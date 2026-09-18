// Verification test for the energy optimizer across all 10 public benchmark cases
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeEnergySchedule } from '../src/optimizer/energyOptimizer.js';
import { evaluateSolution } from './judge_replay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runOptimizerBenchmark() {
  const dataRaw = fs.readFileSync(path.join(__dirname, '../data/sample_cases.json'), 'utf8');
  const { cases } = JSON.parse(dataRaw);

  console.log(`\nBenchmarking Optimizer on all ${cases.length} official scenarios...\n`);

  let passed = 0;
  let totalQualityRatio = 0;

  for (const c of cases) {
    const startTime = Date.now();
    try {
      // Use the organizer's expected ground-truth directives to test pure solver performance
      const response = optimizeEnergySchedule(c.input, c.expected_output.directive_interpretation);
      const elapsed = Date.now() - startTime;

      const evalResult = evaluateSolution(c.input, response, c.expected_output);

      if (evalResult.valid) {
        passed++;
        totalQualityRatio += evalResult.qualityRatio;
        const diff = Math.abs(evalResult.recomputedTotalCost - evalResult.expectedCost);
        console.log(`[${c.id}] ✅ Valid in ${elapsed}ms | Cost: ${evalResult.recomputedTotalCost} BDT (Target: ${evalResult.expectedCost}, Diff: ${diff.toFixed(2)}) | Quality: ${(evalResult.qualityRatio * 100).toFixed(1)}%`);
      } else {
        console.log(`[${c.id}] ❌ Invalid in ${elapsed}ms:`);
        evalResult.errors.forEach(err => console.log(`   - ${err}`));
      }
    } catch (err) {
      console.log(`[${c.id}] ❌ Error: ${err.message}`);
    }
  }

  const avgQuality = (totalQualityRatio / cases.length) * 10;
  console.log(`\n======================================================`);
  console.log(`Optimizer Benchmark: ${passed}/${cases.length} valid cases`);
  console.log(`Optimization Quality Score: ${avgQuality.toFixed(2)} / 10.00 pts`);
  console.log(`======================================================\n`);
}

runOptimizerBenchmark();
