/* eslint-disable jsdoc/require-jsdoc */
'use strict';

function postprocess(item, value) {
	if (value === null || value === undefined) {
		return null;
	}

	let v = value;

	if (typeof v !== 'number' || !Number.isFinite(v)) {
		return null;
	}

	if (item.clampNegative && v < 0) {
		v = 0;
	}

	if (item.min !== null && item.min !== undefined && Number.isFinite(Number(item.min))) {
		v = Math.max(v, Number(item.min));
	}
	if (item.max !== null && item.max !== undefined && Number.isFinite(Number(item.max))) {
		v = Math.min(v, Number(item.max));
	}

	return v;
}

module.exports = { postprocess };
