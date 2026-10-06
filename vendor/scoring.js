/**
 * Cloud Optimisation Assessment - scoring and recommendation engine.
 *
 * Implements ruleset 1.1 as specified in sections 8 and 9 of
 * cloud-optimisation-assessment-prd.md.
 *
 * Every export is a pure function of (answers, bank). No I/O, no clock, no
 * randomness - replaying stored answers under the same ruleset always
 * reproduces the same result, which is what the result-snapshot requirement
 * in section 11 depends on.
 */

const CONTINUOUS_IMPROVEMENT = 'continuous_improvement';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const roundHalfUp = (n) => Math.floor(n + 0.5);
const roundTo = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

const questionsById = (bank) => {
  const map = new Map();
  for (const q of bank.questions) map.set(q.id, q);
  for (const f of bank.lead_fields) map.set(f.id, f);
  return map;
};

const optionOf = (question, id) =>
  question?.options?.find((opt) => opt.id === id);

/** Options actually selected for a question, as option objects. */
const selectedOptions = (question, answer) =>
  asArray(answer)
    .map((id) => optionOf(question, id))
    .filter(Boolean);

const EMAIL = /^[^\s@]+@[^\s@,]+\.[a-z]{2,}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;

/** C0 controls except tab/LF/CR (which trim() handles), plus DEL. */
const isControl = (ch) => {
  const code = ch.charCodeAt(0);
  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
};
const hasControl = (text) => Array.from(text).some(isControl);

/** Free text is capped even when the bank forgot to say so. */
const DEFAULT_MAX_LENGTH = 200;
/** RFC 5321 caps an address at 254 octets; nothing longer is deliverable. */
const CONTACT_MAX_LENGTH = 254;

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Structural validation of a submission. Returns an array of
 * { field, code, message } - empty means valid.
 *
 * This runs server-side as well as in the form. Client validation is a
 * convenience; it is not a guarantee about what arrives at the endpoint.
 */
export function validate(answers, bank) {
  const errors = [];
  const fields = [...bank.questions, ...bank.lead_fields];

  for (const field of fields) {
    const raw = answers[field.id];
    const given = asArray(raw);

    if (field.required && given.length === 0) {
      errors.push({ field: field.id, code: 'required', message: `${field.id} is required.` });
      continue;
    }
    if (given.length === 0) continue;

    // Free text and the contact address must be strings, bounded, and free
    // of control characters. Anything else is stored verbatim as the lead's
    // name or address and printed into two emails - an array stringifies to
    // JSON, an object to "[object Object]", and a 6 MB name is a 6 MB row.
    // The bank's max_length used to be enforced only as an HTML attribute.
    if (field.type === 'text' || field.type === 'contact') {
      if (typeof raw !== 'string') {
        errors.push({ field: field.id, code: 'invalid_type', message: `${field.id} must be text.` });
        continue;
      }
      const declared = field.max_length ?? DEFAULT_MAX_LENGTH;
      const limit = field.type === 'contact' ? Math.min(declared, CONTACT_MAX_LENGTH) : declared;
      if (raw.length > limit) {
        errors.push({ field: field.id, code: 'too_long', message: `${field.id} accepts at most ${limit} characters.` });
        continue;
      }
      if (hasControl(raw)) {
        errors.push({ field: field.id, code: 'invalid_characters', message: `${field.id} contains characters that cannot be used.` });
        continue;
      }
    }

    if (field.type === 'single' && given.length > 1) {
      errors.push({ field: field.id, code: 'single_only', message: `${field.id} accepts one answer.` });
    }

    if (field.max_selections && given.length > field.max_selections) {
      errors.push({
        field: field.id,
        code: 'too_many',
        message: `${field.id} accepts at most ${field.max_selections} selections.`,
      });
    }

    // The bank declares a validate rule per contact channel. An unreachable
    // lead is a lost lead, so shape is checked rather than assumed.
    if (field.type === 'contact') {
      const value = raw.trim();
      const shapes = { email: EMAIL, e164: E164 };
      const accepted = (field.channels ?? []).some((c) => shapes[c.validate]?.test(value));
      if (!accepted) {
        errors.push({
          field: field.id,
          code: 'invalid_contact',
          message: 'Enter a work email address or a phone number including its country code.',
        });
      }
    }

    if (field.options) {
      // More selections than there are options is not a choice anyone made,
      // and a hundred thousand copies of one id is not either. Both are
      // rejected before the per-item loop, which would otherwise produce one
      // error per item and hand a flood back as a 422 body the same size.
      if (given.length > field.options.length) {
        errors.push({ field: field.id, code: 'too_many', message: `${field.id} has more selections than options.` });
        continue;
      }
      if (new Set(given).size !== given.length) {
        errors.push({ field: field.id, code: 'duplicate', message: `${field.id} lists the same option twice.` });
        continue;
      }
      for (const id of given) {
        // The message never echoes the value: it is caller text, and it would
        // otherwise be reflected into logs and the response.
        if (!optionOf(field, id)) {
          errors.push({ field: field.id, code: 'unknown_option', message: `Unknown option for ${field.id}.` });
        }
      }
      // An exclusive option cannot be combined with anything else.
      const exclusive = selectedOptions(field, raw).find((opt) => opt.exclusive);
      if (exclusive && given.length > 1) {
        errors.push({
          field: field.id,
          code: 'exclusive_option',
          message: `${exclusive.id} cannot be combined with other selections.`,
        });
      }
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* score                                                               */
/* ------------------------------------------------------------------ */

/**
 * Section 8. A not-applicable answer earns no points AND removes its points
 * from the denominator, so the score stays comparable between organisations
 * that were never asked to have the practice in the first place.
 */
export function computeScore(answers, bank) {
  const perQuestion = [];
  let rawPoints = 0;
  let applicableMax = 0;

  for (const question of bank.questions) {
    if (!question.scored) continue;

    const option = optionOf(question, asArray(answers[question.id])[0]);
    const questionMax = Math.max(...question.options.map((o) => o.points ?? 0));

    if (!option) {
      // Unanswered scored questions score zero but stay in the denominator.
      // validate() is what rejects the submission; scoring stays total.
      perQuestion.push({ question: question.id, points: 0, max: questionMax, applicable: true, answered: false });
      applicableMax += questionMax;
      continue;
    }

    const applicable = option.not_applicable !== true;
    const points = applicable ? option.points ?? 0 : 0;

    if (applicable) {
      rawPoints += points;
      applicableMax += questionMax;
    }
    perQuestion.push({
      question: question.id,
      option: option.id,
      points,
      max: questionMax,
      applicable,
      answered: true,
    });
  }

  if (applicableMax === 0) {
    return { rawPoints: 0, applicableMax: 0, score: null, band: null, perQuestion };
  }

  const score = roundHalfUp((rawPoints / applicableMax) * 100);
  return { rawPoints, applicableMax, score, band: bandFor(score, bank), perQuestion };
}

export function bandFor(score, bank) {
  if (score === null || score === undefined) return null;
  return bank.scoring.bands.find((b) => score >= b.min && score <= b.max) ?? null;
}

/**
 * A critical gate that limits the BAND without touching the score.
 *
 * Some answers make a high band untrue however well the rest went. An
 * organisation that cannot list its applications is not "migration-ready"
 * because it scored 78 on everything else - the score is honest about the
 * answers given, and the band is honest about what they add up to.
 *
 * The score is deliberately left alone. Lowering it would hide which answers
 * produced it and make two runs incomparable; capping the band states the
 * limit and says why. Returns null when no cap applies, which is the case for
 * every bank that declares none.
 */
export function bandCap(answers, bank, band, score) {
  const rules = bank.scoring.band_caps ?? [];
  const bands = bank.scoring.bands;
  if (!band || rules.length === 0) return null;

  const landed = bands.findIndex((b) => b.label === band.label);
  let winner = null;

  for (const rule of rules) {
    const index = bands.findIndex((b) => b.label === rule.band);
    // A cap at or above where they already landed changes nothing. Applying
    // it anyway would report a "cap" that did not cap.
    if (index === -1 || index >= landed) continue;
    if (!matches(rule.when, answers, score)) continue;
    if (!winner || index < winner.index) winner = { index, rule };
  }

  if (!winner) return null;
  return {
    id: winner.rule.id,
    from: band.label,
    band: bands[winner.index],
    note: winner.rule.note ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* category deficits                                                   */
/* ------------------------------------------------------------------ */

/**
 * Section 9.2 and 9.3. Ranking uses the proportion of available points lost,
 * not the number of tags fired - tag counts would systematically favour
 * whichever categories happen to hold the most questions.
 */
export function computeDeficits(answers, bank, scored) {
  const { deficit_precision: dp } = bank.scoring;
  const byQuestion = new Map(scored.perQuestion.map((r) => [r.question, r]));
  const boosts = signalBoosts(answers, bank);
  const deficits = {};

  for (const category of bank.categories) {
    const rows = category.questions.map((id) => byQuestion.get(id)).filter((r) => r && r.applicable);
    if (rows.length === 0) continue; // every question not applicable - excluded from ranking

    const max = rows.reduce((sum, r) => sum + r.max, 0);
    const earned = rows.reduce((sum, r) => sum + r.points, 0);
    const deficit = roundTo((max - earned) / max, dp);
    const boost = boosts[category.id] ?? 0;

    deficits[category.id] = {
      category: category.id,
      rank: category.rank,
      questionCount: rows.length,
      max,
      earned,
      deficit,
      boost: roundTo(boost, dp),
      // A boost amplifies a deficit; it must never create one. Without the
      // zero guard, someone who scores 100 and ticks "automate deployments"
      // on the wishlist is told their biggest bottleneck is delivery
      // automation - having just answered that it is fully automated. The
      // boost is a tie-breaker between real gaps, not evidence of a gap.
      adjusted: deficit === 0 ? 0 : roundTo(Math.min(1, deficit + boost), dp),
    };
  }

  return deficits;
}

/** Section 9.3. Boosts affect ranking only and never touch the score. */
export function signalBoosts(answers, bank) {
  const totals = {};
  for (const rule of bank.signal_boosts) {
    const given = asArray(answers[rule.question]);
    const hit = rule.option !== undefined ? given.includes(rule.option) : given.includes(rule.includes);
    if (hit) totals[rule.category] = (totals[rule.category] ?? 0) + rule.boost;
  }
  return totals;
}

/* ------------------------------------------------------------------ */
/* ranking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Section 9.4 and 9.5. Returns the primary finding, up to three secondaries,
 * and the categories that were blocked from the primary slot with the reason
 * why - the consultant briefing shows those, so the reasoning is not lost.
 */
export function rankFindings(deficits, bank, score, mandatory = []) {
  const { secondary_threshold, min_evidence_threshold, min_evidence_question_count } = bank.scoring;
  const rows = Object.values(deficits);
  const gated = [];

  // A mandatory finding is the bank stating outright that some answers must be
  // raised however the ranking falls - untested backups, unclassified data, no
  // migration owner. Ranking exists to choose between comparable gaps; these
  // are not being compared, so they clear both gates rather than competing.
  const required = new Set(mandatory.map((rule) => rule.category));

  const eligible = rows.filter((row) => {
    if (required.has(row.category)) return true;
    if (row.questionCount < min_evidence_question_count && row.adjusted < min_evidence_threshold) {
      gated.push({ category: row.category, reason: 'insufficient_evidence' });
      return false;
    }
    const gate = (bank.prerequisite_gates ?? []).find((g) => g.category === row.category);
    if (gate && gateBlocks(gate, deficits, score)) {
      gated.push({ category: row.category, reason: gate.reason });
      return false;
    }
    return true;
  });

  const byStrength = (a, b) => b.adjusted - a.adjusted || a.rank - b.rank;
  const best = [...eligible].sort(byStrength)[0];

  // Section 9.5 step 2: no eligible category, or the best one has nothing to
  // improve, means a near-perfect result rather than an arbitrary finding.
  const primary = !best || best.adjusted === 0 ? CONTINUOUS_IMPROVEMENT : best.category;

  // Step 3 runs regardless of which branch produced the primary. A category
  // blocked from leading must still be reported if it clears the threshold,
  // otherwise a real finding disappears from the result entirely.
  const ranked = rows
    .filter((row) => row.category !== primary && row.adjusted >= secondary_threshold)
    .sort(byStrength)
    .map((row) => row.category);

  // Mandatory categories take the front of the list, in bank order, then the
  // strongest remaining deficits fill what is left of the three. Without the
  // first half, a rule like "no tested backup" would be silently dropped
  // whenever the deficit it describes sat below the secondary threshold -
  // which is exactly the case it exists to catch.
  const forced = [...required].filter((category) => category !== primary);
  const secondary = [...new Set([...forced, ...ranked])].slice(0, 3);

  return { primary, secondary, gated };
}

/** Categories the bank insists on raising, whatever the ranking says. */
export function mandatoryFindings(answers, bank, score) {
  return (bank.mandatory_findings ?? [])
    .filter((rule) => matches(rule.when, answers, score))
    .map((rule) => ({ category: rule.category, reason: rule.reason }));
}

/**
 * Section 9. One direction for the PORTFOLIO - never a treatment per
 * application, which needs discovery this assessment does not perform.
 *
 * `hold` pre-empts everything: where the portfolio is unknown, the honest
 * output is that no direction can be chosen yet. Otherwise the lowest priority
 * among the matching rules wins, and a bank may leave an option with no rule
 * at all - it stays visible as a treatment to consider without ever being
 * recommended on evidence that does not exist.
 */
export function strategyDirection(answers, bank, score) {
  const spec = bank.strategy_directions;
  if (!spec) return null;
  if (spec.hold && matches(spec.hold.when, answers, score)) return spec.hold.id;

  const hit = (spec.options ?? [])
    .filter((option) => option.when && matches(option.when, answers, score))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))[0];

  return hit ? hit.id : spec.default ?? null;
}

function gateBlocks(gate, deficits, score) {
  return (gate.blocked_when_any ?? []).some((condition) => {
    if (condition.score_below !== undefined) return score !== null && score < condition.score_below;
    if (condition.category_deficit_at_least) {
      const { category, value } = condition.category_deficit_at_least;
      return (deficits[category]?.adjusted ?? 0) >= value;
    }
    return false;
  });
}

/* ------------------------------------------------------------------ */
/* overlay, tags, flags                                                */
/* ------------------------------------------------------------------ */

/** Section 9.6. An overlay, never a competitor for the primary slot. */
export function managedOverlay(answers, bank, score) {
  const rule = bank.managed_overlay;
  if (!rule) return false;
  return (rule.any ?? []).some((condition) => matches(condition, answers, score));
}

function matches(condition, answers, score) {
  if (condition.all) return condition.all.every((c) => matches(c, answers, score));
  if (condition.any) return condition.any.some((c) => matches(c, answers, score));
  if (condition.not) return !matches(condition.not, answers, score);
  if (condition.score_below !== undefined) return score !== null && score < condition.score_below;
  if (condition.score_at_least !== undefined) return score !== null && score >= condition.score_at_least;

  const given = asArray(answers[condition.question]);
  if (condition.includes !== undefined) return given.includes(condition.includes);
  if (condition.includes_any) return condition.includes_any.some((v) => given.includes(v));
  if (condition.equals !== undefined) return given.includes(condition.equals);
  if (condition.equals_any) return condition.equals_any.some((v) => given.includes(v));
  return false;
}

/**
 * The "which answers caused this" trail for the consultant briefing.
 * Deliberately not used for ranking - see computeDeficits.
 */
export function evidenceTags(answers, bank) {
  const tags = new Set();
  for (const question of [...bank.questions, ...bank.lead_fields]) {
    for (const option of selectedOptions(question, answers[question.id])) {
      for (const tag of option.tags ?? []) tags.add(tag);
    }
  }
  return [...tags];
}

/**
 * Section 9.9. Internal only - these never reach the result page. They mark
 * answers worth probing in the session, and never change score or findings.
 */
export function confidenceFlags(answers, bank) {
  const unknownCount = bank.questions
    .filter((q) => q.scored)
    .reduce((count, q) => count + (selectedOptions(q, answers[q.id]).some((o) => o.unknown) ? 1 : 0), 0);

  return (bank.confidence_flags ?? [])
    .filter((rule) => {
      if (rule.unknown_answers_at_least !== undefined) return unknownCount >= rule.unknown_answers_at_least;
      return matches(rule, answers, null);
    })
    .map((rule) => rule.id);
}

/* ------------------------------------------------------------------ */
/* public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Full evaluation. `meta` carries the values the engine must not invent -
 * session id and timestamp are supplied by the caller so this stays pure.
 */
export function evaluate(answers, bank, meta = {}) {
  const scored = computeScore(answers, bank);
  const deficits = computeDeficits(answers, bank, scored);
  const mandatory = mandatoryFindings(answers, bank, scored.score);
  const { primary, secondary, gated } = rankFindings(deficits, bank, scored.score, mandatory);

  // Both of these are opt-in per bank. A bank that declares neither carries
  // neither key, rather than two nulls that read as missing data.
  const cap = bandCap(answers, bank, scored.band, scored.score);
  const band = cap ? cap.band : scored.band;
  const direction = strategyDirection(answers, bank, scored.score);

  return {
    session_id: meta.session_id ?? null,
    // Which assessment produced this. The ruleset version identifies the bank,
    // but the row still has to say which product it belongs to - without it
    // every result files itself under the default service and the funnel
    // reports one assessment doing twice the volume.
    service: meta.service ?? null,
    ruleset_version: bank.ruleset_version,
    completed_at: meta.completed_at ?? null,
    raw_points: scored.rawPoints,
    applicable_max_points: scored.applicableMax,
    score: scored.score,
    score_band: band?.label ?? null,
    score_interpretation: band?.interpretation ?? null,
    ...(cap ? { band_cap: { id: cap.id, from: cap.from, to: cap.band.label, note: cap.note } } : {}),
    primary_finding: primary,
    secondary_findings: secondary,
    ...(mandatory.length ? { mandatory_findings: mandatory } : {}),
    ...(direction ? { migration_direction: direction } : {}),
    managed_optimisation: managedOverlay(answers, bank, scored.score),
    category_deficits: Object.fromEntries(
      Object.values(deficits).map((row) => [row.category, row.adjusted]),
    ),
    gated_findings: gated,
    evidence_tags: evidenceTags(answers, bank),
    // A capped band is worth probing in the session for exactly the reason it
    // capped, so it travels with the other flags rather than needing a column.
    confidence_flags: [...confidenceFlags(answers, bank), ...(cap ? [cap.id] : [])],
    cta: 'book_strategy_session',
  };
}

export { CONTINUOUS_IMPROVEMENT };

/* ------------------------------------------------------------------ */
/* CRM and booking handoff                                             */
/* ------------------------------------------------------------------ */

/**
 * The combined payload from section 11 of the PRD: the assessment result
 * plus the lead context the booking page and CRM need.
 *
 * Kept separate from evaluate() because the two have different lifetimes.
 * The result is an immutable snapshot tied to a ruleset version; the lead
 * is mutable contact data subject to correction, export and deletion.
 */
export function buildPayload(answers, bank, meta = {}) {
  const result = evaluate(answers, bank, meta);
  const pick = (id) => asArray(answers[id])[0] ?? null;
  const labelOf = (fieldId, optionId) => {
    const field = questionsById(bank).get(fieldId);
    return optionOf(field, optionId)?.label ?? null;
  };

  // Which question carries which piece of lead context is a property of the
  // bank, not of the engine. The cloud bank puts providers on Q02; the DevOps
  // bank puts team size there. Reading the mapping from the bank is what lets
  // one engine serve both - and every one added after them.
  const map = bank.payload_map;
  const out = { ...result };

  for (const [name, rule] of Object.entries(map.fields ?? {})) {
    const id = rule.field;
    if (rule.mode === 'raw') out[name] = answers[id] ?? null;
    else if (rule.mode === 'value') out[name] = pick(id);
    else if (rule.mode === 'labels') out[name] = asArray(answers[id]).map((o) => labelOf(id, o));
    else out[name] = labelOf(id, pick(id));
  }

  // Spend banding is specific to the cloud-cost assessment. A bank that does
  // not declare it simply does not carry those keys, rather than carrying
  // three nulls that look like missing data.
  if (map.spend) {
    const tierId = pick(map.spend.question);
    const currency = meta.spend_currency
      ?? (pick(map.spend.country_field) === map.spend.local_country ? map.spend.local_currency : map.spend.default_currency);
    const tier = (bank.spend_tiers ?? []).find((t) => t.id === tierId);
    out.spend_tier = tierId;
    out.spend_currency = currency;
    out.spend_band_label = tier ? tier[currency] ?? null : null;
  }

  // Segmentation that only this assessment has, gathered into one object so
  // the lead table does not grow a column per product. The bank names the keys;
  // store.js writes whatever it finds here into coa_lead.context. Never
  // identifying data - coa_purge_lead() does not reach into it.
  if (map.context) {
    out.lead_context = Object.fromEntries(map.context.map((key) => [key, out[key] ?? null]));
  }

  out.contact_channel = meta.contact_channel ?? null;
  out.booking_url = meta.booking_url ?? null;
  out.consent = {
    marketing: answers[map.consent_field] === true,
    recorded_at: meta.completed_at ?? null,
    wording_version:
      bank.lead_fields.find((f) => f.id === map.consent_field)?.wording_version ?? null,
    privacy_notice_version: meta.privacy_notice_version ?? null,
  };

  return out;
}
