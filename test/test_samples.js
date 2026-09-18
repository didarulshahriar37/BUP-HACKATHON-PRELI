import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateSolution } from './judge_replay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Runs the pipeline against the 10 public benchmark cases
export async function runAllSampleTests(pipelineFn) {
  const dataRaw = fs.readFileSync(path.join(__dirname, '../data/sample_cases.json'), 'utf8');
  const { cases } = JSON.parse(dataRaw);

  console.log(`\n======================================================`);
  console.log(`Evaluating ${cases.length} Public Benchmark Cases`);
  console.log(`======================================================\n`);

  let passed = 0;
  let totalQualityRatio = 0;

  for (const c of cases) {
    process.stdout.write(`Testing [${c.id}] ${c.label}... `);
    const startTime = Date.now();
    try {
      const response = await pipelineFn(c.input);
      const elapsed = Date.now() - startTime;
      const result = evaluateSolution(c.input, response, c.expected_output);

      if (result.valid && result.directiveMatch) {
        passed++;
        totalQualityRatio += result.qualityRatio;
        console.log(`\x1b[32mPASSED\x1b[0m in ${elapsed}ms (Cost: ${result.recomputedTotalCost} BDT, Exp: ${result.expectedCost} BDT, Quality: ${(result.qualityRatio * 100).toFixed(1)}%)`);
      } else {
        console.log(`\x1b[31mFAILED\x1b[0m in ${elapsed}ms`);
        if (result.errors.length > 0) {
          result.errors.forEach(err => console.log(`   ❌ ${err}`));
        }
      }
    } catch (err) {
      console.log(`\x1b[31mERROR\x1b[0m: ${err.message}`);
    }
  }

  const avgQuality = cases.length > 0 ? (totalQualityRatio / cases.length) * 10 : 0;
  console.log(`\n------------------------------------------------------`);
  console.log(`Results: ${passed}/${cases.length} passed`);
  console.log(`Optimization Quality Score: ${avgQuality.toFixed(2)} / 10.00 pts`);
  console.log(`------------------------------------------------------\n`);

  return { passed, total: cases.length, avgQuality };
}

import { runEnergyOptimizationPipeline } from '../src/pipeline.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runAllSampleTests(runEnergyOptimizationPipeline);
}
