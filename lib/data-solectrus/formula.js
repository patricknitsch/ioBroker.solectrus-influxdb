'use strict';

const jsep = require('jsep');

function parseExpression(expr) {
	return jsep(String(expr));
}

/**
 * Normalizes some common non-JS formula syntax into the JS-like operators that `jsep` understands.
 * - AND/OR/NOT (case-insensitive) -> && / || / !
 * - single '=' (outside strings) -> '=='
 *
 * This is intentionally conservative and only runs outside quoted strings.
 */
function normalizeFormulaExpression(expr) {
	let s = String(expr);
	if (!s) return s;

	let out = '';
	let inSingle = false;
	let inDouble = false;
	let escaped = false;

	const isWordChar = c => /[A-Za-z0-9_]/.test(c);
	const at = i => (i >= 0 && i < s.length ? s[i] : '');
	const matchWordAt = (i, word) => {
		// assumes already outside quotes
		const w = String(word);
		if (s.substr(i, w.length).toUpperCase() !== w.toUpperCase()) return false;
		const prev = at(i - 1);
		const next = at(i + w.length);
		if (prev && isWordChar(prev)) return false;
		if (next && isWordChar(next)) return false;
		return true;
	};

	for (let i = 0; i < s.length; i++) {
		const ch = s[i];

		if (escaped) {
			out += ch;
			escaped = false;
			continue;
		}
		if (ch === '\\') {
			out += ch;
			escaped = true;
			continue;
		}

		if (!inDouble && ch === "'") {
			inSingle = !inSingle;
			out += ch;
			continue;
		}
		if (!inSingle && ch === '"') {
			inDouble = !inDouble;
			out += ch;
			continue;
		}

		if (inSingle || inDouble) {
			out += ch;
			continue;
		}

		// AND/OR/NOT keywords
		if (matchWordAt(i, 'AND')) {
			out += '&&';
			i += 2;
			continue;
		}
		if (matchWordAt(i, 'OR')) {
			out += '||';
			i += 1;
			continue;
		}
		if (matchWordAt(i, 'NOT')) {
			out += '!';
			i += 2;
			continue;
		}

		// single '=' -> '==' (but keep ==, ===, !=, <=, >=)
		if (ch === '=') {
			const prev = at(i - 1);
			const next = at(i + 1);
			const prevIsGuard = prev === '=' || prev === '!' || prev === '<' || prev === '>';
			if (!prevIsGuard && next !== '=') {
				out += '==';
				continue;
			}
		}

		out += ch;
	}

	return out;
}

function analyzeAst(ast, options) {
	const maxNodes = options && Number.isFinite(options.maxNodes) ? options.maxNodes : 2000;
	const maxDepth = options && Number.isFinite(options.maxDepth) ? options.maxDepth : 60;
	let nodes = 0;
	let depthMax = 0;
	/** @type {{node:any, depth:number}[]} */
	const stack = [{ node: ast, depth: 1 }];
	while (stack.length) {
		const entry = stack.pop();
		const node = entry && entry.node;
		const depth = entry && entry.depth ? entry.depth : 1;
		if (!node || typeof node !== 'object') continue;
		nodes++;
		if (depth > depthMax) depthMax = depth;
		if (nodes > maxNodes) {
			throw new Error(`Expression too complex (>${maxNodes} nodes)`);
		}
		if (depthMax > maxDepth) {
			throw new Error(`Expression too deeply nested (>${maxDepth})`);
		}

		switch (node.type) {
			case 'BinaryExpression':
			case 'LogicalExpression':
				stack.push({ node: node.right, depth: depth + 1 });
				stack.push({ node: node.left, depth: depth + 1 });
				break;
			case 'UnaryExpression':
				stack.push({ node: node.argument, depth: depth + 1 });
				break;
			case 'ConditionalExpression':
				stack.push({ node: node.alternate, depth: depth + 1 });
				stack.push({ node: node.consequent, depth: depth + 1 });
				stack.push({ node: node.test, depth: depth + 1 });
				break;
			case 'CallExpression': {
				const args = Array.isArray(node.arguments) ? node.arguments : [];
				for (let i = args.length - 1; i >= 0; i--) {
					stack.push({ node: args[i], depth: depth + 1 });
				}
				// callee is an Identifier in allowed expressions; no need to traverse.
				break;
			}
			default:
				break;
		}
	}
	return { nodes, depth: depthMax };
}

function evalFormulaAst(ast, vars, funcs) {
	const functions = funcs || {};
	const variables = vars || Object.create(null);

	const evalNode = node => {
		if (!node || typeof node !== 'object') {
			throw new Error('Invalid expression');
		}

		switch (node.type) {
			case 'Literal':
				return node.value;
			case 'Identifier':
				return Object.prototype.hasOwnProperty.call(variables, node.name) ? variables[node.name] : 0;
			case 'UnaryExpression': {
				const arg = evalNode(node.argument);
				switch (node.operator) {
					case '+':
						return Number(arg);
					case '-':
						return -Number(arg);
					case '!':
						return !arg;
					default:
						throw new Error(`Operator not allowed: ${node.operator}`);
				}
			}
			case 'BinaryExpression':
			case 'LogicalExpression': {
				const left = evalNode(node.left);
				const right = evalNode(node.right);
				switch (node.operator) {
					case '+':
						return Number(left) + Number(right);
					case '-':
						return Number(left) - Number(right);
					case '*':
						return Number(left) * Number(right);
					case '/':
						return Number(left) / Number(right);
					case '%':
						return Number(left) % Number(right);
					case '&&':
						return left && right;
					case '||':
						return left || right;
					case '==':
						// loose equality intentionally supported for compatibility with other formula engines
						return left == right;
					case '!=':
						return left != right;
					case '===':
						return left === right;
					case '!==':
						return left !== right;
					case '<':
						return Number(left) < Number(right);
					case '<=':
						return Number(left) <= Number(right);
					case '>':
						return Number(left) > Number(right);
					case '>=':
						return Number(left) >= Number(right);
					default:
						throw new Error(`Operator not allowed: ${node.operator}`);
				}
			}
			case 'ConditionalExpression': {
				const test = evalNode(node.test);
				return test ? evalNode(node.consequent) : evalNode(node.alternate);
			}
			case 'CallExpression': {
				if (!node.callee || node.callee.type !== 'Identifier') {
					throw new Error('Only simple function calls are allowed');
				}
				const fnName = node.callee.name;
				const fn = functions[fnName];
				if (typeof fn !== 'function') {
					throw new Error(`Function not allowed: ${fnName}`);
				}
				const args = Array.isArray(node.arguments) ? node.arguments.map(evalNode) : [];
				return fn.apply(null, args);
			}
			default:
				// Blocks MemberExpression, ThisExpression, NewExpression, etc.
				throw new Error(`Expression type not allowed: ${node.type}`);
		}
	};

	return evalNode(ast);
}

module.exports = {
	parseExpression,
	normalizeFormulaExpression,
	analyzeAst,
	evalFormulaAst,
};
