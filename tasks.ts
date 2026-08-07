import { deleteFoldersRecursive, npmInstall, buildReact, copyFiles } from '@iobroker/build-tools';

// Builds src-admin (Vite + Module Federation, targeting @iobroker/gui-components / Admin 8 "GUI API
// generation 2") and copies the output into admin/custom, which is what jsonConfig.json's "custom"
// entries load. Only admin/custom is touched - the rest of admin/ (tab.html, i18n/, jsonConfig.json,
// the adapter icon) is unrelated to this build and must survive a clean.
const src = `${__dirname}/src-admin/`;

function clean(): void {
	deleteFoldersRecursive(`${__dirname}/admin/custom`);
	deleteFoldersRecursive(`${src}build`);
}

function copyAllFiles(): void {
	// Vite (not CRA/webpack) emits chunks under build/assets/, matching the layout ioBroker.admin's
	// own AdminComponentEasyAccessSet example ships under admin/custom/assets/.
	copyFiles(['src-admin/build/assets/*'], 'admin/custom/assets');
	copyFiles(['src-admin/build/customComponents.js'], 'admin/custom');
	copyFiles(['src-admin/build/customComponents.ssr.js'], 'admin/custom');
	// Admin reads this manifest to learn which component library/generation the build targets,
	// and refuses to start the component if it was built for an older GUI API generation.
	copyFiles(['src-admin/build/mf-manifest.json'], 'admin/custom');
}

if (process.argv.includes('--0-clean')) {
	clean();
} else if (process.argv.includes('--1-npm')) {
	npmInstall(src).catch((e: unknown) => console.error(`Cannot install npm: ${e as Error}`));
} else if (process.argv.includes('--2-build')) {
	buildReact(src, { vite: true }).catch((e: unknown) => console.error(`Cannot build: ${e as Error}`));
} else if (process.argv.includes('--3-copy')) {
	copyAllFiles();
} else {
	clean();
	npmInstall(src)
		.then(() => buildReact(src, { vite: true }))
		.then(() => copyAllFiles())
		.catch((e: unknown) => {
			console.error(e);
			process.exit(2);
		});
}
