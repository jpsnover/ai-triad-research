"""Debug: inspect raw Gemini response for a single claim."""
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

from google import genai

RESEARCH_DIR = os.path.dirname(os.path.abspath(__file__))

api_key = os.environ.get('GEMINI_API_KEY', os.environ.get('AI_API_KEY', ''))
client = genai.Client(api_key=api_key)

with open(os.path.join(RESEARCH_DIR, '_annotation_template.json'), encoding='utf-8') as f:
    template = json.load(f)

claim = template['claims'][0]
print(f"Claim: {claim['claim_id']}")
print(f"Text: {claim['claim_text'][:100]}...")

prompt = f'''Rewrite this debate claim as a self-contained statement for taxonomy attribution.

CLAIM: "{claim['claim_text']}"
SPEAKER: {claim.get('speaker', '')} ({claim.get('pov', '')})
BDI CATEGORY: {claim.get('bdi_category', 'belief')}

Respond with ONLY a JSON object, no markdown fences:
{{"freeform": "<40-80 word self-contained rewrite>", "genus": "<rewrite as: A [Belief|Desire|Intention] within [POV] discourse that [differentia].>"}}'''

response = client.models.generate_content(
    model='gemini-2.5-flash',
    contents=prompt,
    config=genai.types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=500,
    ),
)

print(f"\n--- response.text type: {type(response.text)} ---")
print(f"--- response.text repr (first 1000): ---")
print(repr(response.text[:1000]))
print(f"\n--- response.text raw: ---")
print(response.text)
print(f"\n--- response parts: ---")
for i, part in enumerate(response.candidates[0].content.parts):
    print(f"  Part {i}: thought={part.thought if hasattr(part, 'thought') else 'N/A'}, text={repr(part.text[:200]) if part.text else 'None'}")
