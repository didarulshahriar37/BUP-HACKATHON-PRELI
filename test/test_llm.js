import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { interpretOperatorNotes } from '../src/llm/interpreter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test LLM extraction against all 10 public benchmark cases
async function runLLMTests() {
  const dataRaw = fs.readFileSync(path.join(__dirname, '../data/sample_cases.json'), 'utf8');
  const { cases } = JSON.parse(dataRaw);

  console.log(`\nEvaluating LLM interpretation on ${cases.length} sample cases...`);

  let matchedCases = 0;

  for (const c of cases) {
    process.stdout.write(`Testing [${c.id}]... `);
    const startTime = Date.now();
    try {
      const interpretations = await interpretOperatorNotes(c.input.operator_notes, c.input.battery);
      const elapsed = Date.now() - startTime;

      let caseMatch = true;
      const expected = c.expected_output.directive_interpretation;

      if (interpretations.length !== expected.length) {
        caseMatch = false;
        console.log(`❌ Note count mismatch: got ${interpretations.length}, expected ${expected.length}`);
      } else {
        for (let i = 0; i < expected.length; i++) {
          const actualEntry = interpretations[i];
          const expEntry = expected[i];

          if (actualEntry.applies !== expEntry.applies) {
            caseMatch = false;
            console.log(`❌ Note ${i} applies mismatch: ${actualEntry.applies} vs ${expEntry.applies}`);
          }
          if (actualEntry.directive_type !== expEntry.directive_type) {
            caseMatch = false;
            console.log(`❌ Note ${i} type mismatch: ${actualEntry.directive_type} vs ${expEntry.directive_type}`);
          }
          if (expEntry.structured_adjustment) {
            const expHours = JSON.stringify(expEntry.structured_adjustment.hours);
            const actHours = JSON.stringify(actualEntry.structured_adjustment?.hours);
            if (expHours !== actHours) {
              caseMatch = false;
              console.log(`❌ Note ${i} hours mismatch: ${actHours} vs ${expHours}`);
            }
            if (expEntry.structured_adjustment.factor !== undefined) {
              if (Math.abs(actualEntry.structured_adjustment?.factor - expEntry.structured_adjustment.factor) > 0.01) {
                caseMatch = false;
                console.log(`❌ Note ${i} factor mismatch: ${actualEntry.structured_adjustment?.factor} vs ${expEntry.structured_adjustment.factor}`);
              }
            }
            if (expEntry.structured_adjustment.minimum_energy_kwh !== undefined) {
              if (Math.abs(actualEntry.structured_adjustment?.minimum_energy_kwh - expEntry.structured_adjustment.minimum_energy_kwh) > 0.01) {
                caseMatch = false;
                console.log(`❌ Note ${i} reserve mismatch: ${actualEntry.structured_adjustment?.minimum_energy_kwh} vs ${expEntry.structured_adjustment.minimum_energy_kwh}`);
              }
            }
            if (expEntry.structured_adjustment.max_grid_kwh !== undefined) {
              if (Math.abs(actualEntry.structured_adjustment?.max_grid_kwh - expEntry.structured_adjustment.max_grid_kwh) > 0.01) {
                caseMatch = false;
                console.log(`❌ Note ${i} grid cap mismatch: ${actualEntry.structured_adjustment?.max_grid_kwh} vs ${expEntry.structured_adjustment.max_grid_kwh}`);
              }
            }
          }
        }
      }

      if (caseMatch) {
        matchedCases++;
        console.log(`✅ MATCH (${elapsed}ms)`);
      }
    } catch (err) {
      console.log(`❌ Exception: ${err.message}`);
    }
  }

  console.log(`\nLLM Accuracy: ${matchedCases}/${cases.length} cases perfectly matched ground truth.\n`);
}

runLLMTests();
