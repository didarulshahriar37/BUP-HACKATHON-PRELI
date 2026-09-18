# GridWise — Smart Campus Energy Optimization Engine

> BUP CSE Fest 2026 · Hackathon · Preliminary Round  
> **LLM-Assisted Operator Directive Interpretation & 24-Hour Energy Scheduling**

---

## 1. Overview & Architecture

GridWise is an automated energy scheduling service for smart campus microgrids. It solves 24-hour cost minimization over solar generation, battery energy storage systems (BESS), and grid import tariffs while dynamically interpreting natural-language operational directives from campus operators.

```
┌─────────────────────────────────┐
│ Operator Notes + Energy Context │
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Stage 1: LLM Interpreter        │  --> OpenAI (gpt-4o-mini) extracts structured
│                                 │      directives (windows, solar factors, reserves)
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Stage 2: Deterministic          │  --> Enforces 0..23 ascending hours, factor [0, 1],
│          Guardrail Validator    │      reserve bounds, and safe no_op fallbacks
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Stage 3: Mathematical Optimizer │  --> Continuous Linear Programming (LP) minimizing
│          (Continuous LP)        │      total grid cost subject to physical constraints
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│ Final HTTP JSON Response        │  --> Echoes scenario_id, machine-checkable directives,
│                                 │      24-hour schedule, recalculated totals, and summary
└─────────────────────────────────┘
```

### Core Pipeline Components:
1. **LLM Directive Interpreter (`src/llm/interpreter.js`)**:
   - Uses OpenAI `gpt-4o-mini` with deterministic JSON response schema.
   - Extracts all 6 supported directives: `solar_reduction`, `minimum_battery_reserve`, `no_charge_window`, `no_discharge_window`, `max_grid_window`, and `no_op`.
   - Correctly normalizes start-inclusive, end-exclusive time windows, usable solar fractions (e.g. an 80% reduction means `factor: 0.20`), and relative battery reserve percentages.
2. **Deterministic Guardrail Validator (`src/guardrails/validator.js`)**:
   - Acts as a programmatic safety boundary before mathematical optimization.
   - Normalizes note mapping (`0..N-1`), enforces strictly ascending unique integer hours (`0..23`), clamps numeric bounds, and converts unparseable or hallucinated output into safe `no_op` entries.
3. **Mathematical Energy Optimizer (`src/optimizer/energyOptimizer.js`)**:
   - Continuous Linear Programming solver using `javascript-lp-solver`.
   - Minimizes total grid cost over the 24-hour horizon:
     ```
     total_cost_bdt = SUM(grid_kwh[h] * tariff_bdt_per_kwh[h]) for h = 0..23
     ```
   - Strictly enforces:
     - **Hourly Energy Balance**:
       ```
       grid_kwh[h] + solar_used_kwh[h] + battery_discharge_kwh[h] = demand_kwh[h] + battery_charge_kwh[h]
       ```
     - Solar generation limits and curtailment (`0 <= solar_used_kwh[h] <= effective_solar[h]`)
     - Battery capacity bounds and active directive reserves (`active_reserve[h] <= battery_energy[h] <= capacity_kwh`)
     - Hourly charge/discharge rate limits
     - Forbidden charging/discharging windows and grid import caps
     - End-of-day battery neutrality (`battery_energy_after_kwh[23] == initial_energy_kwh`)

---

## 2. Environment Variables & Configuration

Create a `.env` file in the project root (see `.env.example`):

| Variable Name | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Optional | `3000` | Port for the HTTP server (binds to `0.0.0.0`) |
| `OPENAI_API_KEY` | **Required** | None | OpenAI API key for operator note interpretation |
| `OPENAI_MODEL` | Optional | `gpt-4o-mini` | Model identifier used for natural language extraction |
| `NODE_ENV` | Optional | `development` | Runtime environment mode |

> **Security Notice**: Never commit `.env` or any secret credentials to the repository. The `.gitignore` file is pre-configured to ignore all environment and secret files.

---

## 3. Quickstart: Clean Local Setup

### Prerequisites
- Node.js `v18+` (tested on Node.js `v22.20.0`)
- npm `v9+`

### Step 1: Clone the Repository
```bash
git clone https://github.com/didarulshahriar37/BUP-HACKATHON-PRELI.git
cd BUP-HACKATHON-PRELI
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Configure Environment
```bash
cp .env.example .env
# Edit .env and supply your OPENAI_API_KEY
```

### Step 4: Start the Service
```bash
npm start
```
The service will start and bind to `0.0.0.0:3000`.

---

## 4. API Endpoints & `curl` Examples

### 1. Health Readiness Endpoint: `GET /health`
Verifies service readiness:
```bash
curl -X GET http://localhost:3000/health
```
**Expected Response (HTTP 200)**:
```json
{
  "status": "ok"
}
```

---

### 2. Primary Energy Optimization: `POST /optimize-energy`
Accepts a 24-hour scenario with operator notes and returns the validated directives and optimal 24-hour schedule.

```bash
curl -X POST http://localhost:3000/optimize-energy \
  -H "Content-Type: application/json" \
  -d '{
    "scenario_id": "SAMPLE-01",
    "operator_notes": [
      "Facilities will wash the rooftop solar panels from noon until 2 PM. During cleaning, usable solar should be treated as roughly 25% of the forecast.",
      "The sports office moved next month'\''s registration deadline."
    ],
    "hours": [
      {"hour": 0, "demand_kwh": 90, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 1, "demand_kwh": 85, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 2, "demand_kwh": 80, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 3, "demand_kwh": 80, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 4, "demand_kwh": 85, "solar_kwh": 0, "tariff_bdt_per_kwh": 5},
      {"hour": 5, "demand_kwh": 95, "solar_kwh": 0, "tariff_bdt_per_kwh": 6},
      {"hour": 6, "demand_kwh": 110, "solar_kwh": 5, "tariff_bdt_per_kwh": 8},
      {"hour": 7, "demand_kwh": 130, "solar_kwh": 20, "tariff_bdt_per_kwh": 10},
      {"hour": 8, "demand_kwh": 150, "solar_kwh": 50, "tariff_bdt_per_kwh": 12},
      {"hour": 9, "demand_kwh": 165, "solar_kwh": 90, "tariff_bdt_per_kwh": 14},
      {"hour": 10, "demand_kwh": 175, "solar_kwh": 130, "tariff_bdt_per_kwh": 16},
      {"hour": 11, "demand_kwh": 180, "solar_kwh": 160, "tariff_bdt_per_kwh": 16},
      {"hour": 12, "demand_kwh": 185, "solar_kwh": 180, "tariff_bdt_per_kwh": 15},
      {"hour": 13, "demand_kwh": 180, "solar_kwh": 170, "tariff_bdt_per_kwh": 14},
      {"hour": 14, "demand_kwh": 170, "solar_kwh": 140, "tariff_bdt_per_kwh": 13},
      {"hour": 15, "demand_kwh": 165, "solar_kwh": 90, "tariff_bdt_per_kwh": 14},
      {"hour": 16, "demand_kwh": 170, "solar_kwh": 45, "tariff_bdt_per_kwh": 18},
      {"hour": 17, "demand_kwh": 185, "solar_kwh": 10, "tariff_bdt_per_kwh": 22},
      {"hour": 18, "demand_kwh": 205, "solar_kwh": 0, "tariff_bdt_per_kwh": 28},
      {"hour": 19, "demand_kwh": 215, "solar_kwh": 0, "tariff_bdt_per_kwh": 30},
      {"hour": 20, "demand_kwh": 205, "solar_kwh": 0, "tariff_bdt_per_kwh": 26},
      {"hour": 21, "demand_kwh": 175, "solar_kwh": 0, "tariff_bdt_per_kwh": 18},
      {"hour": 22, "demand_kwh": 135, "solar_kwh": 0, "tariff_bdt_per_kwh": 10},
      {"hour": 23, "demand_kwh": 105, "solar_kwh": 0, "tariff_bdt_per_kwh": 7}
    ],
    "battery": {
      "capacity_kwh": 220,
      "initial_energy_kwh": 110,
      "minimum_energy_kwh": 40,
      "max_charge_kwh_per_hour": 50,
      "max_discharge_kwh_per_hour": 50
    }
  }'
```

**Expected Response Shape (HTTP 200)**:
```json
{
  "scenario_id": "SAMPLE-01",
  "directive_interpretation": [
    {
      "note_index": 0,
      "applies": true,
      "directive_type": "solar_reduction",
      "structured_adjustment": {
        "hours": [12, 13],
        "factor": 0.25
      },
      "explanation": "Solar output reduced to 25% during panel cleaning window."
    },
    {
      "note_index": 1,
      "applies": false,
      "directive_type": "no_op",
      "structured_adjustment": null,
      "explanation": "This note does not affect today's energy schedule."
    }
  ],
  "hourly_plan": [
    {
      "hour": 0,
      "grid_kwh": 90,
      "solar_used_kwh": 0,
      "battery_action": "idle",
      "battery_kwh": 0,
      "battery_energy_after_kwh": 110
    }
    // ... 23 more hourly entries ...
  ],
  "total_grid_kwh": 2692.5,
  "total_cost_bdt": 38365,
  "peak_grid_kwh": 175,
  "plan_summary": "Schedule optimized incorporating operator directives (solar reduction). Shifts grid purchases to lower tariff windows while maintaining battery neutrality and grid constraints."
}
```

---

## 5. Verification & Test Suite

Run the full automated test harness evaluating all 10 official benchmark cases:

```bash
npm test
```

### Verification Checks Performed:
- **Directive Accuracy**: Compares extracted directive types, unique sorted hours, and numeric values against ground truth.
- **Physical GridWise Balance Replay**: Hour-by-hour independent simulation verifying:
  ```
  grid_kwh[h] + solar_used_kwh[h] + battery_discharge_kwh[h] = demand_kwh[h] + battery_charge_kwh[h]
  ```
- **Battery Energy Neutrality**: Ensures `battery_energy_after_kwh[23] == initial_energy_kwh`.
- **Operational Window Adherence**: Verifies zero charge during `no_charge_window`, zero discharge during `no_discharge_window`, and grid limits during `max_grid_window`.
- **Cost Minimization**: Verifies `quality_ratio = min(1, organizer_optimal_cost / recalculated_team_cost) = 1.00` (10.00 / 10.00 points).

### Unit & Subsystem Tests:
```bash
# Test deterministic guardrail sanitization
node test/test_guardrails.js

# Test mathematical linear optimizer
node test/test_optimizer.js

# Test LLM natural language extraction
node test/test_llm.js

# Test HTTP web service endpoints
node test/test_server.js
```

---

## 6. Docker Containerization & Orchestration

The service can be run in any containerized environment binding to port `3000` and `0.0.0.0`.

### Option A: Using Docker Compose (Recommended)
```bash
# Build and start container with env injection
docker compose up -d --build

# View container logs
docker compose logs -f

# Stop container
docker compose down
```

### Option B: Using Docker CLI Direct
```bash
# Build Container Image
docker build -t gridwise-optimizer:latest .

# Run Container with env file
docker run -d \
  --name gridwise-service \
  -p 3000:3000 \
  --env-file env \
  gridwise-optimizer:latest
```

### Option C: Using npm Scripts
```bash
npm run docker:build
npm run docker:run
npm run docker:compose
```

### Verify Container Health
```bash
curl -X GET http://localhost:8000/health
```

---

## 7. Third-Party Libraries & Acknowledgments

- **Express (`^4.21.2`)**: Fast, lightweight HTTP server framework.
- **OpenAI Node SDK (`^4.86.1`)**: Official SDK for LLM-assisted natural language directive interpretation.
- **javascript-lp-solver (`^0.4.24`)**: High-performance pure-JavaScript continuous linear programming solver.
- **dotenv (`^16.4.7`)**: Zero-dependency environment variable management.

---

## 8. Known Operational Boundaries

- **Horizon**: Operates on a fixed 24-hour horizon ($0 \dots 23$).
- **Exporting**: Per problem specification, rooftop solar export to the main grid is not supported (unused solar is curtailed).
- **Time Representation**: All time intervals in human notes are parsed and mapped to whole-hour start-inclusive, end-exclusive representations (e.g. 1 PM to 3 PM corresponds to indices `[13, 14]`).
- **Reliability & Latency**: Uses OpenAI `gpt-4o-mini` with `temperature: 0` to maintain response times $< 5\text{s}$ (well within the 30-second judge limit) and zero-cost LP optimization ($< 25\text{ms}$).
