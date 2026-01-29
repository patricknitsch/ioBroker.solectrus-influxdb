/* eslint-disable jsdoc/require-jsdoc */
'use strict';

function validateCalcConfig(cfg) {
	const errors = [];

	if (!cfg || typeof cfg !== 'object') {
		return { ok: false, errors: ['Missing calc config object'] };
	}

	if (!Number.isFinite(cfg.intervalSec) || cfg.intervalSec < 1) {
		errors.push('calc.interval must be >= 1');
	}

	const seen = new Set();
	for (const it of cfg.items || []) {
		if (!it.targetId) {
			errors.push('Item targetId missing');
		}

		if (seen.has(it.targetId)) {
			errors.push(`Duplicate targetId: ${it.targetId}`);
		}
		seen.add(it.targetId);

		if (!it.measurement) {
			errors.push(`Item '${it.targetId}': measurement missing`);
		}
		if (!it.field) {
			errors.push(`Item '${it.targetId}': field missing`);
		}

		const hasFormula = !!(it.formula && it.formula.trim());
		const hasSourceMap = it.sourceStates && Object.keys(it.sourceStates).length > 0;
		const hasDirectSource = !!(it.source && it.source.trim());

		if (!hasFormula && !hasDirectSource && !hasSourceMap) {
			errors.push(`Item '${it.targetId}': either formula+sourceStates or source must be set`);
		}

		if (hasFormula && !hasSourceMap) {
			errors.push(`Item '${it.targetId}': formula requires sourceStates`);
		}

		if (it.min !== null && it.max !== null && Number(it.min) > Number(it.max)) {
			errors.push(`Item '${it.targetId}': min > max`);
		}
	}

	return { ok: errors.length === 0, errors };
}

module.exports = { validateCalcConfig };
