import leaps from '../../fixtures/science/time-prototype/leap-seconds.json' with { type: 'json' };

const SECONDS_PER_DAY = 86400;
const MS_PER_DAY = SECONDS_PER_DAY * 1000;
const UNIX_EPOCH_JD = 2440587.5;
const J2000_JD = 2451545;
const TT_MINUS_TAI_SECONDS = 32.184;
const modelEndExclusive = Date.parse('2052-01-01T00:00:00Z');
const midnightMs = date => Date.parse(`${date}T00:00:00Z`);
const tableStart = midnightMs(leaps.validFrom);
const tableEnd = midnightMs(leaps.expiresExclusive);
const transitionMs = leaps.entries.map(entry => midnightMs(entry.effectiveDate));
const transitionOffsets = new Map(leaps.entries.map((entry, index) => [transitionMs[index], entry.taiMinusUtcSeconds]));

// USNO Circular 179, eq. (2.6). The argument is TT centuries from J2000.
// Geocentric approximation, independently compared with ERFA's longer series.
function geocentricTdbMinusTt([day, fraction]) {
  const t = ((day - J2000_JD) + fraction) / 36525;
  return 0.001657 * Math.sin(628.3076 * t + 6.2401)
    + 0.000022 * Math.sin(575.3385 * t + 4.2970)
    + 0.000014 * Math.sin(1256.6152 * t + 6.1969)
    + 0.000005 * Math.sin(606.9777 * t + 4.0212)
    + 0.000005 * Math.sin(52.9691 * t + 0.4444)
    + 0.000002 * Math.sin(21.3299 * t + 5.5431)
    + 0.000010 * t * Math.sin(628.3076 * t + 4.2490);
}

function parseCivilTime(iso) {
  if (typeof iso !== 'string') throw new TypeError('UTC input must be a timestamp string');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!match || match[0] !== iso) throw new RangeError('Expected a timestamp with Z or an explicit numeric offset');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const fractionText = (match[7] ?? '').replace(/0+$/, '').replace(/\.$/, '');
  const zone = match[8];
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59 || zone === '-00:00') {
    throw new RangeError('Invalid clock or UTC offset');
  }
  // Validate the calendar independently of Date's rollover behavior.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) {
    throw new RangeError('Invalid Gregorian date');
  }
  local.setUTCHours(hour, minute, Math.min(second, 59), 0);
  const offsetSign = zone[0] === '-' ? -1 : 1;
  const utcBaseMs = local.getTime() - offsetSign * (offsetHour * 60 + offsetMinute) * 60000;
  return { utcBaseMs, leapSecond: second === 60, fractionText, fraction: Number(fractionText || 0) };
}

function splitUniformJd(midnightJd, seconds) {
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  return [midnightJd + days, (seconds - days * SECONDS_PER_DAY) / SECONDS_PER_DAY];
}

// Split days are subtracted before adding fractions to avoid losing sub-ms precision.
export function differenceSeconds(left, right) {
  return ((left[0] - right[0]) + (left[1] - right[1])) * SECONDS_PER_DAY;
}

export function convertTime(iso, { future = 'reject' } = {}) {
  if (!['reject', 'assume-no-new-leaps'].includes(future)) throw new RangeError('Unknown future UTC policy');
  const { utcBaseMs, leapSecond, fractionText, fraction } = parseCivilTime(iso);
  if (utcBaseMs < tableStart || utcBaseMs >= modelEndExclusive) {
    throw new RangeError('UTC outside this prototype’s 1972–2051 range');
  }
  const futureAssumed = utcBaseMs >= tableEnd;
  if (futureAssumed && future !== 'assume-no-new-leaps') throw new RangeError('UTC is outside the published table validity');

  const utcDay = Math.floor(utcBaseMs / MS_PER_DAY);
  const utcMidnightMs = utcDay * MS_PER_DAY;
  const taiMinusUtcSeconds = leaps.entries[transitionMs.findLastIndex(ms => ms <= utcMidnightMs)].taiMinusUtcSeconds;
  const nextOffset = transitionOffsets.get(utcMidnightMs + MS_PER_DAY) ?? taiMinusUtcSeconds;
  const daySeconds = SECONDS_PER_DAY + nextOffset - taiMinusUtcSeconds;
  const wholeSecond = (utcBaseMs - utcMidnightMs) / 1000;
  if (leapSecond && (wholeSecond !== 86399 || daySeconds !== 86401)) throw new RangeError('No positive leap second at that UTC instant');
  const utcSecond = wholeSecond + Number(leapSecond) + fraction;
  if (utcSecond >= daySeconds) throw new RangeError('Second omitted by UTC day length');

  const midnightJd = UNIX_EPOCH_JD + utcDay;
  const taiSecond = utcSecond + taiMinusUtcSeconds;
  const ttSecond = taiSecond + TT_MINUS_TAI_SECONDS;
  const jdTai = splitUniformJd(midnightJd, taiSecond);
  const jdTt = splitUniformJd(midnightJd, ttSecond);
  const tdbMinusTtSeconds = geocentricTdbMinusTt(jdTt);
  const jdTdb = splitUniformJd(midnightJd, ttSecond + tdbMinusTtSeconds);
  const normalized = new Date(utcBaseMs).toISOString();
  const utcIso = `${leapSecond ? `${normalized.slice(0, 17)}60` : normalized.slice(0, 19)}${fractionText}Z`;

  return {
    utcIso,
    utcUnixMs: leapSecond ? null : utcBaseMs + Number((fractionText.slice(1) + '000').slice(0, 3)),
    jdUtcQuasi: [midnightJd, utcSecond / daySeconds],
    jdTai,
    jdTt,
    jdTdb,
    taiMinusUtcSeconds,
    tdbMinusTtSeconds,
    provenance: {
      leapTable: leaps.version,
      leapTableValidUntilExclusive: `${leaps.expiresExclusive}T00:00:00Z`,
      utcStatus: futureAssumed ? 'assumed-no-new-leaps' : 'published',
      tdbModel: 'USNO Circular 179 eq. (2.6), geocentric',
    },
  };
}
