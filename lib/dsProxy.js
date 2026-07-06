'use strict';

const {
	parseExpression,
	normalizeFormulaExpression: normalizeFormulaExpressionImpl,
	analyzeAst: analyzeAstImpl,
	evalFormulaAst: evalFormulaAstImpl,
} = require('./data-solectrus/formula');
const {
	applyJsonPath: applyJsonPathImpl,
	getNumericFromJsonPath: getNumericFromJsonPathImpl,
	getValueFromJsonPath: getValueFromJsonPathImpl,
} = require('./data-solectrus/jsonpath');
const dsEvaluator = require('./data-solectrus/services/evaluator');

/**
 * Creates a Data-SOLECTRUS proxy object that wraps the adapter and provides DS-specific state,
 * config mapping, scoped object/state helpers, and formula evaluation functions.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @returns {object} A proxy object combining DS-specific members with the adapter's own API.
 */
function createDsProxy(adapter) {
	const self = {
		/* ---------- DS-specific state ---------- */
		cache: new Map(),
		cacheTs: new Map(),
		compiledItems: new Map(),
		subscribedIds: new Set(),
		currentSnapshot: null,
		lastGoodValue: new Map(),
		lastGoodTs: new Map(),
		consecutiveErrorCounts: new Map(),
		tickTimer: null,
		itemsConfigSignature: '',
		warnedOnce: new Set(),
		debuggedOnce: new Set(),
		isUnloading: false,

		/* ---------- Constants ---------- */
		MAX_FORMULA_LENGTH: 8000,
		MAX_AST_NODES: 2000,
		MAX_AST_DEPTH: 60,
		MAX_DISCOVERED_STATE_IDS_PER_ITEM: 250,
		MAX_TOTAL_SOURCE_IDS: 5000,
		TICK_TIME_BUDGET_RATIO: 0.8,

		/* ---------- Config proxy ---------- */
		config: new Proxy(
			{},
			{
				get(_, prop) {
					switch (prop) {
						case 'items': {
							const its = adapter.config['dsItems'];
							const itsEd = adapter.config['dsItemsEditor'];
							const a =
								Array.isArray(its) && its.length
									? its
									: Array.isArray(itsEd) && itsEd.length
										? itsEd
										: [];
							return a;
						}
						case 'pollIntervalSeconds':
							return adapter.config.dsPollIntervalSeconds || 5;
						case 'snapshotInputs':
							return adapter.config.dsSnapshotInputs || false;
						case 'snapshotDelayMs':
							return adapter.config.dsSnapshotDelayMs || 0;
						case 'errorRetriesBeforeZero':
							return 3;
						default:
							return adapter.config[prop];
					}
				},
			},
		),

		/* ---------- Own-state methods (prefix with ds.) ---------- */
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(`ds.${id}`, obj),
		setObjectAsync: (id, obj) => adapter.setObjectAsync(`ds.${id}`, obj),
		extendObjectAsync: (id, obj) => adapter.extendObjectAsync(`ds.${id}`, obj),
		getObjectAsync: id => adapter.getObjectAsync(`ds.${id}`),
		setStateAsync: (id, val, ack) => adapter.setStateAsync(`ds.${id}`, val, ack),
		setState: (id, val, ack) => adapter.setState(`ds.${id}`, val, ack),

		/* ---------- DS-specific methods ---------- */
		/**
		 * Logs a warning at most once per `key`, resetting the dedup set once it grows too large.
		 *
		 * @param {string} key - Dedup key; repeated calls with the same key are suppressed.
		 * @param {string} msg - Message to log (without the `[DS]` prefix).
		 */
		warnOnce(key, msg) {
			if (self.warnedOnce.size > 500) {
				self.warnedOnce.clear();
			}
			if (self.warnedOnce.has(key)) {
				return;
			}
			self.warnedOnce.add(key);
			adapter.log.warn(`[DS] ${msg}`);
		},
		/**
		 * Logs a debug message at most once per `key`, resetting the dedup set once it grows too large.
		 *
		 * @param {string} key - Dedup key; repeated calls with the same key are suppressed.
		 * @param {string} msg - Message to log (without the `[DS]` prefix).
		 */
		debugOnce(key, msg) {
			if (self.debuggedOnce.size > 500) {
				self.debuggedOnce.clear();
			}
			if (self.debuggedOnce.has(key)) {
				return;
			}
			self.debuggedOnce.add(key);
			adapter.log.debug(`[DS] ${msg}`);
		},
		/**
		 * Coerces `val` to a finite number, falling back to `fallback` otherwise.
		 *
		 * @param {unknown} val - Value to coerce.
		 * @param {number} [fallback] - Value to return when `val` isn't a finite number.
		 * @returns {number} The coerced number, or `fallback`.
		 */
		safeNum(val, fallback = 0) {
			const n = Number(val);
			return Number.isFinite(n) ? n : fallback;
		},
		/**
		 * @param {unknown} obj - Object to query.
		 * @param {string} jsonPath - JSONPath expression, see {@link applyJsonPathImpl}.
		 * @returns {unknown} The resolved value, or `undefined` if it doesn't resolve.
		 */
		applyJsonPath(obj, jsonPath) {
			return applyJsonPathImpl(obj, jsonPath);
		},
		/**
		 * @param {unknown} rawValue - Raw source value (JSON string, object, or primitive).
		 * @param {string} [jsonPath] - JSONPath expression.
		 * @param {string} [warnKeyPrefix] - Prefix used to namespace throttled warn/debug log keys.
		 * @returns {number} The extracted numeric value, or `0` on failure.
		 */
		getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getNumericFromJsonPathImpl(rawValue, jsonPath, {
				safeNum: self.safeNum.bind(self),
				warnOnce: self.warnOnce.bind(self),
				debugOnce: self.debugOnce.bind(self),
				warnKeyPrefix,
			});
		},
		/**
		 * @param {unknown} rawValue - Raw source value (JSON string, object, or primitive).
		 * @param {string} [jsonPath] - JSONPath expression.
		 * @param {string} [warnKeyPrefix] - Prefix used to namespace throttled warn log keys.
		 * @returns {unknown} See {@link getValueFromJsonPathImpl}.
		 */
		getValueFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getValueFromJsonPathImpl(rawValue, jsonPath, {
				warnOnce: self.warnOnce.bind(self),
				warnKeyPrefix,
			});
		},
		/**
		 * @param {unknown} expr - Formula expression to normalize.
		 * @returns {string} The normalized expression, see {@link normalizeFormulaExpressionImpl}.
		 */
		normalizeFormulaExpression(expr) {
			return normalizeFormulaExpressionImpl(expr);
		},
		/**
		 * @param {unknown} ast - Parsed jsep AST to validate against the configured complexity limits.
		 * @returns {{ nodes: number, depth: number }} Node count and max depth of `ast`.
		 */
		analyzeAst(ast) {
			return analyzeAstImpl(ast, { maxNodes: self.MAX_AST_NODES, maxDepth: self.MAX_AST_DEPTH });
		},
		/**
		 * Parses, validates, and evaluates a formula expression in one step.
		 *
		 * @param {unknown} expr - Formula expression (SOLECTRUS syntax, normalized before parsing).
		 * @param {Record<string, unknown>} [vars] - Variables available to the expression.
		 * @returns {unknown} The evaluation result.
		 */
		evalFormula(expr, vars) {
			const normalized = self.normalizeFormulaExpression(expr);
			if (normalized && normalized.length > self.MAX_FORMULA_LENGTH) {
				throw new Error(`Formula too long (>${self.MAX_FORMULA_LENGTH} chars)`);
			}
			const ast = parseExpression(String(normalized));
			self.analyzeAst(ast);
			return self.evalFormulaAst(ast, vars);
		},
		/**
		 * @param {unknown} ast - Parsed jsep AST, see {@link evalFormula}.
		 * @param {Record<string, unknown>} [vars] - Variables available to the expression.
		 * @returns {unknown} The evaluation result.
		 */
		evalFormulaAst(ast, vars) {
			return evalFormulaAstImpl(ast, vars, self.formulaFunctions);
		},
	};

	// Formula functions need the proxy (for v/s/jp), so create after self exists.
	self.formulaFunctions = dsEvaluator.createFormulaFunctions(self);

	// Return a Proxy that delegates anything not on `self` to the real adapter.
	return new Proxy(self, {
		get(target, prop) {
			if (prop in target) {
				return target[prop];
			}
			const val = adapter[prop];
			if (typeof val === 'function') {
				return val.bind(adapter);
			}
			return val;
		},
		set(target, prop, value) {
			target[prop] = value;
			return true;
		},
	});
}

module.exports = { createDsProxy };
