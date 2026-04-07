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
		safeNum(val, fallback = 0) {
			const n = Number(val);
			return Number.isFinite(n) ? n : fallback;
		},
		applyJsonPath(obj, jsonPath) {
			return applyJsonPathImpl(obj, jsonPath);
		},
		getNumericFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getNumericFromJsonPathImpl(rawValue, jsonPath, {
				safeNum: self.safeNum.bind(self),
				warnOnce: self.warnOnce.bind(self),
				debugOnce: self.debugOnce.bind(self),
				warnKeyPrefix,
			});
		},
		getValueFromJsonPath(rawValue, jsonPath, warnKeyPrefix = '') {
			return getValueFromJsonPathImpl(rawValue, jsonPath, {
				warnOnce: self.warnOnce.bind(self),
				warnKeyPrefix,
			});
		},
		normalizeFormulaExpression(expr) {
			return normalizeFormulaExpressionImpl(expr);
		},
		analyzeAst(ast) {
			return analyzeAstImpl(ast, { maxNodes: self.MAX_AST_NODES, maxDepth: self.MAX_AST_DEPTH });
		},
		evalFormula(expr, vars) {
			const normalized = self.normalizeFormulaExpression(expr);
			if (normalized && normalized.length > self.MAX_FORMULA_LENGTH) {
				throw new Error(`Formula too long (>${self.MAX_FORMULA_LENGTH} chars)`);
			}
			const ast = parseExpression(String(normalized));
			self.analyzeAst(ast);
			return self.evalFormulaAst(ast, vars);
		},
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
