"""CL session startup scan.

Runs the 5 mandatory checks from AGENTS.md:
1. Calibration scan — 7-day rolling delta on owned metrics
2. Diff scan — changes to owned files since last session
3. Open ticket scan — (handled by Orca MCP, not this script)
4. Validation sign-off — check for unsigned validation-report.json
5. Audit budget — (manual, when 1-4 produce no urgent work)

Usage: python research/comp-linguist/scripts/session-startup.py
"""
import json, os, sys, math
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

REPO_ROOT = Path('C:/Users/jsnov/repos/ai-triad-research')
DATA_ROOT = Path('C:/Users/jsnov/repos/ai-triad-data')

CAL_LOG_PATHS = [
    REPO_ROOT / 'calibration' / 'calibration-log.json',
    DATA_ROOT / 'calibration' / 'calibration-log.json',
]

OWNED_METRICS = {
    'crux_addressed_ratio': {'label': 'crux_addressed_rate', 'higher_is_better': True},
    'repetition_rate': {'label': 'repetition_rate', 'higher_is_better': False},
    'claims_forgotten_rate': {'label': 'claims_forgotten', 'higher_is_better': False},
    'situation_crux_alignment': {'label': 'situation_crux_alignment', 'higher_is_better': True},
}

CONVERGENCE_FIELDS = [
    'argumentative_saturation_signals_at_transition',
    'argumentative_saturation_weights',
]

REGRESSION_THRESHOLD = 0.05

OWNED_FILES = [
    'scripts/AITriad/Prompts/',
    'lib/debate/prompts.ts',
    'lib/debate/calibrationLogger.ts',
    'lib/debate/phaseTransitions.ts',
    'lib/debate/debateRunner.ts',
    'lib/debate/argumentNetwork.ts',
    'lib/debate/taxonomyContext.ts',
    'lib/debate/taxonomyRelevance.ts',
    'lib/debate/topicCritique.ts',
    'lib/debate/synthesisPhases.ts',
    'lib/debate/neutralEvaluator.ts',
    'lib/debate/beliefConfidence.ts',
    'lib/debate/desirePriority.ts',
    'lib/debate/intentionOperationality.ts',
    'lib/debate/pragmaticSignals.ts',
    'lib/debate/claimOutcomes.ts',
    'lib/debate/convergenceSignals.ts',
    'lib/debate/situationScoring.ts',
    'lib/debate/schemeStagnation.ts',
    'lib/debate/confidenceDedup.ts',
    'lib/debate/cruxResolution.ts',
    'lib/debate/exclusionGuard.ts',
    'lib/debate/doctrinalAnchoring.ts',
    'lib/debate/operationalityEvolution.ts',
    'lib/debate/lookaheadGate.ts',
    'lib/debate/revoiceGate.ts',
    'lib/debate/tieredCompression.ts',
    'lib/debate/repairHintScoring.ts',
    'lib/debate/situationRefs.ts',
    'lib/debate/vocabularyContext.ts',
    'lib/debate/counterfactualCrux.ts',
    'lib/debate/cruxTaxonomyFeedback.ts',
    'taxonomy-editor/src/renderer/prompts/chat.ts',
    'taxonomy-editor/src/renderer/prompts/analysis.ts',
    'taxonomy-editor/src/renderer/prompts/research.ts',
    'taxonomy-editor/src/renderer/prompts/vernacular.ts',
    'taxonomy-editor/src/renderer/data/promptCatalog.ts',
    'scripts/AITriad/Private/Get-EmbeddingClusters.ps1',
    'scripts/AITriad/Private/Get-Prompt.ps1',
    'validation-report.json',
]


def load_calibration_log():
    for path in CAL_LOG_PATHS:
        if path.exists():
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return data, str(path)
            if isinstance(data, dict) and 'entries' in data:
                return data['entries'], str(path)
    return [], None


def parse_ts(ts_str):
    ts_str = ts_str.replace('Z', '+00:00')
    return datetime.fromisoformat(ts_str)


def calibration_scan(entries):
    print('=' * 60)
    print('1. CALIBRATION SCAN')
    print('=' * 60)

    if not entries:
        print('  No calibration log entries found.')
        return

    now = datetime.now(timezone.utc)
    recent = [e for e in entries if (now - parse_ts(e['timestamp'])).days <= 14]
    if not recent:
        latest_ts = max(parse_ts(e['timestamp']) for e in entries)
        days_ago = (now - latest_ts).days
        print(f'  WARNING: No entries in last 14 days. Latest entry: {days_ago} days ago.')
        return

    dates = sorted(set(parse_ts(e['timestamp']).strftime('%Y-%m-%d') for e in recent))
    print(f'  Entries in last 14 days: {len(recent)} across {len(dates)} days')
    print(f'  Date range: {dates[0]} to {dates[-1]}')
    print()

    for field, meta in OWNED_METRICS.items():
        label = meta['label']
        higher_better = meta['higher_is_better']

        daily = {}
        for e in recent:
            val = e.get(field)
            if val is None or not isinstance(val, (int, float)):
                continue
            day = parse_ts(e['timestamp']).strftime('%Y-%m-%d')
            daily.setdefault(day, []).append(val)

        if not daily:
            print(f'  {label}: no data (all null)')
            continue

        daily_avg = {d: sum(v) / len(v) for d, v in daily.items()}
        sorted_days = sorted(daily_avg.keys())

        latest_val = daily_avg[sorted_days[-1]]
        deltas = []
        for d in sorted_days:
            past = (datetime.strptime(d, '%Y-%m-%d') - timedelta(days=7)).strftime('%Y-%m-%d')
            if past in daily_avg:
                delta = daily_avg[d] - daily_avg[past]
                pct = (delta / daily_avg[past] * 100) if daily_avg[past] != 0 else 0
                deltas.append((d, delta, pct))

        if deltas:
            latest_delta = deltas[-1]
            direction = '+' if latest_delta[1] >= 0 else ''
            regressed = (latest_delta[1] < 0 and higher_better) or (latest_delta[1] > 0 and not higher_better)
            severity = 'REGRESSION' if regressed and abs(latest_delta[2]) > REGRESSION_THRESHOLD * 100 else 'ok'
            flag = ' *** REGRESSION >5% ***' if severity == 'REGRESSION' else ''
            print(f'  {label}: {latest_val:.4f} ({direction}{latest_delta[2]:.1f}% 7d){flag}')
        else:
            print(f'  {label}: {latest_val:.4f} (no 7d comparison available)')

    print()


def diff_scan():
    print('=' * 60)
    print('2. DIFF SCAN (owned files)')
    print('=' * 60)

    import subprocess
    try:
        result = subprocess.run(
            ['git', 'log', '--since=7 days ago', '--name-only', '--pretty=format:'],
            capture_output=True, text=True, cwd=str(REPO_ROOT), encoding='utf-8'
        )
        changed_files = set(line.strip() for line in result.stdout.splitlines() if line.strip())
    except Exception as e:
        print(f'  ERROR: git log failed: {e}')
        return

    owned_changes = []
    for f in changed_files:
        for owned in OWNED_FILES:
            if owned.endswith('/'):
                if f.startswith(owned):
                    owned_changes.append(f)
                    break
            elif f == owned:
                owned_changes.append(f)
                break

    if owned_changes:
        print(f'  {len(owned_changes)} owned file(s) changed in last 7 days:')
        for f in sorted(owned_changes):
            print(f'    - {f}')
    else:
        print('  No owned files changed in last 7 days.')
    print()


def validation_signoff():
    print('=' * 60)
    print('4. VALIDATION SIGN-OFF')
    print('=' * 60)

    vr_path = REPO_ROOT / 'validation-report.json'
    if not vr_path.exists():
        print('  No validation-report.json found.')
    else:
        stat = vr_path.stat()
        age_days = (datetime.now() - datetime.fromtimestamp(stat.st_mtime)).days
        size_kb = stat.st_size / 1024
        print(f'  validation-report.json: {size_kb:.0f} KB, last modified {age_days} days ago')
        if age_days <= 7:
            print('  ACTION: Review needed — report generated within last 7 days.')
        else:
            print('  No recent report to sign off.')
    print()


def main():
    print()
    print('CL SESSION STARTUP SCAN')
    print(f'Date: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}')
    print()

    entries, log_path = load_calibration_log()
    if log_path:
        print(f'Calibration log: {log_path} ({len(entries)} entries)')
    else:
        print('Calibration log: NOT FOUND')
    print()

    calibration_scan(entries)
    diff_scan()

    print('=' * 60)
    print('3. OPEN TICKET SCAN')
    print('=' * 60)
    print('  → Use Orca MCP: list_tickets(status_category="open")')
    print()

    validation_signoff()

    print('=' * 60)
    print('5. AUDIT BUDGET')
    print('=' * 60)
    print('  If steps 1-4 produced no urgent work, pick one:')
    print('    a) Situation injection effectiveness audit')
    print('    b) Prompt drift check on a random role')
    print('    c) DOLCE compliance on newest 10 situations')
    print()


if __name__ == '__main__':
    main()
