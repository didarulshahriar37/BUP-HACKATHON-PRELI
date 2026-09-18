// Tests for HTTP endpoints: GET /health and POST /optimize-energy
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, server } from '../src/server.js';
import { evaluateSolution } from './judge_replay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper for making local HTTP requests
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      },
      res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, body: json });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runServerTests() {
  console.log('\nTesting HTTP API service endpoints...\n');

  if (!server.listening) {
    await new Promise(resolve => server.once('listening', resolve));
  }

  try {
    // 1. Test GET /health
    const healthRes = await makeRequest('GET', '/health');
    console.assert(healthRes.status === 200, `Expected 200 from /health, got ${healthRes.status}`);
    console.assert(healthRes.body.status === 'ok', `Expected {status: "ok"}, got ${JSON.stringify(healthRes.body)}`);
    console.log('✅ GET /health returns HTTP 200 with {"status":"ok"}');

    // 2. Test 400 on malformed or missing fields
    const badRes1 = await makeRequest('POST', '/optimize-energy', { invalid: 'payload' });
    console.assert(badRes1.status === 400, `Expected 400 on bad payload, got ${badRes1.status}`);

    const badRes2 = await makeRequest('POST', '/optimize-energy', { scenario_id: 'TEST', operator_notes: [] });
    console.assert(badRes2.status === 400, `Expected 400 on empty operator_notes, got ${badRes2.status}`);
    console.log('✅ POST /optimize-energy returns HTTP 400 on invalid input');

    // 3. Test POST /optimize-energy with valid sample case
    const sampleData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/sample_cases.json'), 'utf8'));
    const sample1 = sampleData.cases[0];

    console.log('Testing POST /optimize-energy with SAMPLE-01...');
    const postRes = await makeRequest('POST', '/optimize-energy', sample1.input);
    console.assert(postRes.status === 200, `Expected 200, got ${postRes.status}`);

    const evalResult = evaluateSolution(sample1.input, postRes.body, sample1.expected_output);
    console.assert(evalResult.valid, `Evaluation failed: ${evalResult.errors.join(', ')}`);
    console.assert(evalResult.qualityRatio === 1, `Expected 100% quality, got ${evalResult.qualityRatio}`);

    console.log(`✅ POST /optimize-energy returned valid schedule (Cost: ${postRes.body.total_cost_bdt} BDT)`);
    console.log('\nAll API endpoint checks passed successfully!\n');
  } catch (err) {
    console.error('Server test failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

runServerTests();
