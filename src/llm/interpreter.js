import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

// Lazy-init OpenAI client so we don't throw on startup if env isn't loaded yet
let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || ''
    });
  }
  return openaiClient;
}

const SYSTEM_PROMPT = `You are an expert energy operations parser for the BUP Smart Campus GridWise system.
Your job is to read natural language operator notes and convert each note into a machine-checkable directive interpretation.

STRICT ARRAY LENGTH & INDEX RULE:
- For N operator notes provided in the input, you MUST return an array of EXACTLY N interpretation entries.
- The entries MUST correspond 1:1 with the notes in the exact order: note_index: 0, 1, ... N-1.
- Never drop, merge, or skip any note. Every single note requires its own entry.

TIME INTERVAL CONVERSION RULES:
- The campus schedule runs in 24 hourly intervals, numbered 0 to 23.
- Time intervals are whole-hour intervals, START-INCLUSIVE and END-EXCLUSIVE.
- The number of hours in the array MUST EQUAL (EndHour - StartHour).
- Conversion table:
  12 AM = 0, 1 AM = 1, 2 AM = 2, 3 AM = 3, 4 AM = 4, 5 AM = 5, 6 AM = 6,
  7 AM = 7, 8 AM = 8, 9 AM = 9, 10 AM = 10, 11 AM = 11,
  12 PM (noon) = 12,
  1 PM = 13, 2 PM = 14, 3 PM = 15, 4 PM = 16, 5 PM = 17, 6 PM = 18,
  7 PM = 19, 8 PM = 20, 9 PM = 21, 10 PM = 22, 11 PM = 23.

LOOKUP CHEAT SHEET FOR COMMON WINDOWS:
- "from 6 PM until 8 PM": start=18, end=20 (20 - 18 = 2 hours) -> [18, 19]
- "from 6 PM until 9 PM": start=18, end=21 (21 - 18 = 3 hours) -> [18, 19, 20]
- "from 6 PM until 10 PM": start=18, end=22 (22 - 18 = 4 hours) -> [18, 19, 20, 21]
- "from 7 PM until 9 PM": start=19, end=21 (21 - 19 = 2 hours) -> [19, 20]
- "from 7 PM until 10 PM": start=19, end=22 (22 - 19 = 3 hours) -> [19, 20, 21]
- "from 5 PM until 7 PM": start=17, end=19 (19 - 17 = 2 hours) -> [17, 18]
- "from 2 AM until 5 AM": start=2, end=5 (5 - 2 = 3 hours) -> [2, 3, 4]
- "from 2 PM until 4 PM": start=14, end=16 (16 - 14 = 2 hours) -> [14, 15]
- "from 11 AM until 1 PM": start=11, end=13 (13 - 11 = 2 hours) -> [11, 12]
- "between 11 AM and 2 PM": start=11, end=14 (14 - 11 = 3 hours) -> [11, 12, 13]
- "from noon until 2 PM": start=12, end=14 (14 - 12 = 2 hours) -> [12, 13]
- "from 1 PM to 3 PM": start=13, end=15 (15 - 13 = 2 hours) -> [13, 14]
- "between 13:00 and 15:00": start=13, end=15 -> [13, 14]
- "from 10 AM until noon": start=10, end=12 -> [10, 11]

SUPPORTED DIRECTIVE TYPES:
1. "solar_reduction":
   - Use when solar output is reduced or capped during specific hours.
   - "factor" MUST BE the USABLE FRACTION REMAINING (between 0.0 and 1.0).
     * "drop to 25%" or "leaves 25%" -> factor: 0.25
     * "80% reduction" -> factor: 0.20 (100% - 80% = 20% remaining)
     * "leaves half" or "leave about half" -> factor: 0.50
     * "roughly one-fifth" -> factor: 0.20
   - structured_adjustment: { "hours": [...], "factor": number }

2. "minimum_battery_reserve":
   - Use when a minimum energy reserve is required in the battery during specific hours.
   - If stated as a percentage (e.g. "50% of the battery capacity"), multiply by battery_context.capacity_kwh (e.g. 50% of 200 kWh = 100).
   - structured_adjustment: { "hours": [...], "minimum_energy_kwh": number }

3. "no_charge_window":
   - Use when battery charging is unavailable, prohibited, isolated, or charger is under maintenance.
   - structured_adjustment: { "hours": [...] }

4. "no_discharge_window":
   - Use when battery discharging is unavailable, prohibited, or disabled for testing/maintenance.
   - structured_adjustment: { "hours": [...] }

5. "max_grid_window":
   - Use when grid import or intake is capped at or must not exceed a stated kWh amount during specific hours.
   - structured_adjustment: { "hours": [...], "max_grid_kwh": number }

6. "no_op":
   - Use when the note is an unrelated distractor, general campus notice, cafeteria update, schedule change for next week/month, sports deadline, library notice, room booking, etc., having NO EFFECT on today's 24-hour campus energy schedule.
   - For "no_op": applies MUST BE false, and structured_adjustment MUST BE null.

OUTPUT JSON FORMAT:
{
  "directive_interpretation": [
    {
      "note_index": 0,
      "applies": true,
      "directive_type": "solar_reduction",
      "structured_adjustment": {
        "hours": [12, 13],
        "factor": 0.25
      },
      "explanation": "Solar output reduced to 25% during cleaning window."
    }
  ]
}`;

// Send operator notes to OpenAI with strict JSON output formatting
export async function interpretOperatorNotes(operatorNotes, battery = null) {
  if (!Array.isArray(operatorNotes) || operatorNotes.length === 0) {
    return [];
  }

  const client = getClient();
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const userPayload = {
    operator_notes: operatorNotes,
    notes_count: operatorNotes.length,
    battery_context: battery ? {
      capacity_kwh: battery.capacity_kwh,
      minimum_energy_kwh: battery.minimum_energy_kwh
    } : null
  };

  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Parse these operator notes for today's scenario. Remember to return exactly ${operatorNotes.length} entries in directive_interpretation:\n${JSON.stringify(userPayload, null, 2)}`
      }
    ]
  });

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  return parsed.directive_interpretation || [];
}
