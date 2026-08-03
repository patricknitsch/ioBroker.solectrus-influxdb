// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
	...config,
	{
		// specify files to exclude from linting here
		ignores: [
			'.dev-server/',
			'.vscode/',
			'*.test.js',
			'test/**/*.js',
			'*.config.mjs',
			'build',
			'dist',
			'admin/words.js',
			'admin/admin.d.ts',
			'admin/blockly.js',
			'admin/custom/customComponents.js',
			'admin/custom/**',
			// Separate Vite/React project with its own toolchain and eslint config; not part of
			// the main JSDoc-typed adapter backend linted here.
			'src-admin/',
			'**/adapter-config.d.ts',
			'widgets/**/*.js',
		],
	},
	{
		// you may disable some 'jsdoc' warnings - but using jsdoc is highly recommended
		// as this improves maintainability. jsdoc warnings will not block build process.
		rules: {
			// Allow CRLF on Windows to avoid massive prettier noise.
			'prettier/prettier': ['error', { endOfLine: 'auto' }],
			// 'jsdoc/require-jsdoc': 'off',
			// 'jsdoc/require-param': 'off',
			// 'jsdoc/require-param-description': 'off',
			// 'jsdoc/require-returns-description': 'off',
			// 'jsdoc/require-returns-check': 'off',
		},
	},
	{
		// This adapter is plain JS type-checked via JSDoc + tsc (allowJs/checkJs), not real
		// TypeScript, so @type/@typedef ARE how types get declared here - unlike in a real
		// .ts file, they're not redundant.
		files: ['**/*.js'],
		rules: {
			'jsdoc/check-tag-names': ['warn', { typed: false }],
		},
	},
];
