/* eslint-disable jsdoc/require-jsdoc */
'use strict';

function clamp(x, lo, hi) {
	if (x === null || x === undefined) {
		return x;
	}
	return Math.min(Math.max(x, lo), hi);
}

module.exports = {
	min: Math.min,
	max: Math.max,
	abs: Math.abs,
	round: Math.round,
	floor: Math.floor,
	ceil: Math.ceil,
	pow: Math.pow,
	sqrt: Math.sqrt,
	clamp,
};
