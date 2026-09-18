// Express HTTP server exposing GET /health and POST /optimize-energy
import express from 'express';
import dotenv from 'dotenv';
import { runEnergyOptimizationPipeline } from './pipeline.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Parse incoming JSON requests with reasonable limit
app.use(express.json({ limit: '2mb' }));

// Health check endpoint for readiness checks
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Primary energy optimization endpoint
app.post('/optimize-energy', async (req, res) => {
  try {
    const body = req.body;

    // Validate request body structure
    if (!body || typeof body !== 'object') {
      return res.status(400).json({
        error: 'Invalid request body: expected a JSON object'
      });
    }

    const { scenario_id, operator_notes, hours, battery } = body;

    if (typeof scenario_id !== 'string' || scenario_id.trim().length === 0) {
      return res.status(400).json({
        error: 'Invalid or missing field: scenario_id must be a non-empty string'
      });
    }

    if (!Array.isArray(operator_notes) || operator_notes.length === 0 || operator_notes.length > 3) {
      return res.status(400).json({
        error: 'Invalid operator_notes: must be an array of 1 to 3 strings'
      });
    }

    for (let i = 0; i < operator_notes.length; i++) {
      if (typeof operator_notes[i] !== 'string' || operator_notes[i].trim().length === 0) {
        return res.status(400).json({
          error: `operator_notes[${i}] must be a non-empty string`
        });
      }
    }

    if (!Array.isArray(hours) || hours.length !== 24) {
      return res.status(400).json({
        error: 'Invalid hours array: must contain exactly 24 hourly entries (0-23)'
      });
    }

    for (let h = 0; h < 24; h++) {
      const entry = hours[h];
      if (
        !entry ||
        entry.hour !== h ||
        typeof entry.demand_kwh !== 'number' || entry.demand_kwh < 0 ||
        typeof entry.solar_kwh !== 'number' || entry.solar_kwh < 0 ||
        typeof entry.tariff_bdt_per_kwh !== 'number' || entry.tariff_bdt_per_kwh < 0
      ) {
        return res.status(400).json({
          error: `Invalid hour entry at index ${h}`
        });
      }
    }

    if (!battery || typeof battery !== 'object') {
      return res.status(400).json({
        error: 'Missing battery configuration object'
      });
    }

    const {
      capacity_kwh,
      initial_energy_kwh,
      minimum_energy_kwh,
      max_charge_kwh_per_hour,
      max_discharge_kwh_per_hour
    } = battery;

    if (
      typeof capacity_kwh !== 'number' || capacity_kwh <= 0 ||
      typeof initial_energy_kwh !== 'number' || initial_energy_kwh < 0 ||
      typeof minimum_energy_kwh !== 'number' || minimum_energy_kwh < 0 ||
      typeof max_charge_kwh_per_hour !== 'number' || max_charge_kwh_per_hour < 0 ||
      typeof max_discharge_kwh_per_hour !== 'number' || max_discharge_kwh_per_hour < 0
    ) {
      return res.status(400).json({
        error: 'Invalid battery parameters: all values must be non-negative numbers'
      });
    }

    // Run the complete pipeline (LLM -> Guardrails -> Optimizer)
    const responsePayload = await runEnergyOptimizationPipeline({
      scenario_id,
      operator_notes,
      hours,
      battery
    });

    return res.status(200).json(responsePayload);
  } catch (err) {
    // Return controlled error without leaking keys or stack traces
    console.error('Processing error:', err.message);
    return res.status(500).json({
      error: 'An internal error occurred while processing the energy schedule'
    });
  }
});

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler to prevent crashing or leaking stack traces
app.use((err, req, res, next) => {
  console.error('Unhandled request error:', err.message);
  res.status(400).json({ error: 'Malformed request payload' });
});

// Bind to 0.0.0.0 as required for containerized environments
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`GridWise energy optimizer service listening on port ${PORT}`);
});

export { app, server };
