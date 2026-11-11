"""Generate independent UTC/TAI/TT/TDB cases using pinned PyERFA, offline.

Usage: python generate-time-reference.py <pinned-win-amd64-wheel> [--verify]
Requires Python 3.12 and NumPy. Extracts the verified wheel into a temporary
directory for this process and leaves the Python installation untouched.
"""

import argparse
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import warnings
import zipfile


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'fixtures/science/time-prototype'
WHEEL_NAME = 'pyerfa-2.0.1.5-cp39-abi3-win_amd64.whl'
WHEEL_SHA256 = '66292d437dcf75925b694977aa06eb697126e7b86553e620371ed3e48b5e0ad0'
WHEEL_URL = ('https://files.pythonhosted.org/packages/b4/11/'
             '97233cf23ad5411ac6f13b1d6ee3888f90ace4f974d9bf9db887aa428912/' + WHEEL_NAME)


def j2000_tdb_as_utc(erfa):
    epoch = (2451545.0, 0.0)
    delta = erfa.dtdb(*epoch, 0.0, 0.0, 0.0, 0.0)
    tt = erfa.tdbtt(*epoch, delta)
    utc = erfa.taiutc(*erfa.tttai(*tt))
    year, month, day, hmsf = erfa.d2dtf('UTC', 9, *utc)
    hour, minute, second, frac = hmsf.item()
    return f'{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{frac:09}Z'


def generate(erfa):
    table = json.loads((FIXTURES / 'leap-seconds.json').read_text(encoding='utf-8'))
    cases = {
        'utc-start': '1972-01-01T00:00:00Z',
        'j2000-utc-noon': '2000-01-01T12:00:00Z',
        'j2000-tt': '2000-01-01T11:58:55.816Z',
        'j2000-tdb': j2000_tdb_as_utc(erfa),
        'project-utc-epoch': '2026-11-01T16:00:00Z',
        'table-last-instant': '2027-06-27T23:59:59.999999999Z',
        'table-expiry': '2027-06-28T00:00:00Z',
        'preview-last-instant': '2051-12-31T23:59:59.999999999Z',
    }
    for year in range(1972, 2052):
        for month in (1, 4, 7, 10):
            cases[f'season-{year}-{month:02}'] = f'{year}-{month:02}-15T12:34:56.123456789Z'

    # Table entries only choose test dates. All conversions use ERFA's built-in
    # leap table and routines. Forecast samples assume no later leap seconds.
    for entry in table['entries'][1:]:
        after = date.fromisoformat(entry['effectiveDate'])
        before = after - timedelta(days=1)
        cases[f'leap-{after}-before'] = f'{before}T23:59:59.500Z'
        cases[f'leap-{after}-inside'] = f'{before}T23:59:60.500Z'
        cases[f'leap-{after}-after'] = f'{after}T00:00:00.500Z'

    rows = []
    with warnings.catch_warnings():
        # Only suppress ERFA's known validity warning for forecast UTC. Invalid
        # calendars and times, including leap seconds on wrong days, still fail.
        warnings.simplefilter('error', erfa.ErfaWarning)
        warnings.filterwarnings('ignore', message=r'.*dubious year.*', category=erfa.ErfaWarning)
        for name, utc_iso in cases.items():
            y, mo, d = map(int, utc_iso[:10].split('-'))
            hh, mm = map(int, utc_iso[11:16].split(':'))
            ss = float(utc_iso[17:-1])
            utc = erfa.dtf2d('UTC', y, mo, d, hh, mm, ss)
            tai = erfa.utctai(*utc)
            tt = erfa.taitt(*tai)
            # Re-evaluate dtdb at TDB. Zero u/v removes observer-location terms.
            tdb = tt
            for _ in range(2):
                delta = erfa.dtdb(*tdb, 0.0, 0.0, 0.0, 0.0)
                tdb = erfa.tttdb(*tt, delta)
            rows.append([name, utc_iso, float(erfa.dat(y, mo, d, 0.0)),
                         list(utc), list(tai), list(tt), list(tdb), float(delta)])

    return {
        'schema': 'SOL-time-reference-v1',
        'source': {
            'pyerfa': erfa.__version__,
            'erfa': erfa.version.erfa_version,
            'sofa': erfa.version.sofa_version,
            'wheel': WHEEL_URL,
            'wheelSha256': WHEEL_SHA256,
            'routines': ['dtf2d', 'dat', 'utctai', 'taitt', 'dtdb', 'tttdb'],
            'futureAssumption': 'ERFA bundled table, no additional leap seconds beyond IERS C72 validity',
        },
        'columns': ['name', 'utcIso', 'taiMinusUtcSeconds', 'jdUtcQuasi', 'jdTai', 'jdTt', 'jdTdb', 'tdbMinusTtSeconds'],
        'cases': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('wheel', type=Path)
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    if hashlib.sha256(args.wheel.read_bytes()).hexdigest() != WHEEL_SHA256:
        raise ValueError('PyERFA wheel SHA-256 differs from pinned artifact')

    with tempfile.TemporaryDirectory(prefix='sol-time-erfa-') as isolated:
        with zipfile.ZipFile(args.wheel) as wheel:
            wheel.extractall(isolated)
        # The child process releases Windows extension DLLs before cleanup.
        worker = """
import json, runpy, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import erfa
if erfa.__version__ != '2.0.1.5' or not Path(erfa.__file__).is_relative_to(sys.argv[1]):
    raise ValueError('Unexpected reference library')
print(json.dumps(runpy.run_path(sys.argv[2])['generate'](erfa), allow_nan=False))
"""
        fixture = json.loads(subprocess.check_output(
            [sys.executable, '-I', '-c', worker, isolated, str(Path(__file__).resolve())],
            encoding='utf-8', timeout=30,
        ))

    output = FIXTURES / 'erfa-reference.json'
    rows = fixture['cases']
    if args.verify:
        if json.loads(output.read_text(encoding='utf-8')) != fixture:
            raise ValueError('Reference does not reproduce')
    else:
        with output.open('x', encoding='utf-8', newline='\n') as out:
            header = {key: value for key, value in fixture.items() if key != 'cases'}
            out.write(json.dumps(header, indent=2)[:-2] + ',\n  "cases": [\n')
            out.write(',\n'.join('    ' + json.dumps(row, separators=(',', ':')) for row in rows))
            out.write('\n  ]\n}\n')
    print(f"ERFA {fixture['source']['erfa']} / SOFA {fixture['source']['sofa']}: {len(rows)} reference cases")


if __name__ == '__main__':
    main()
