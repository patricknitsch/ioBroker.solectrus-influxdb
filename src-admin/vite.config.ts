import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import { federation } from '@module-federation/vite';
import { moduleFederationShared } from '@iobroker/gui-components/modulefederation.admin.config';
import { readFileSync } from 'node:fs';

const config = {
    plugins: [
        federation({
            manifest: true,
            // No consumers import our types; skip .d.ts generation to avoid TYPE-001 build noise.
            dts: false,
            // Must be unique and match the first segment of `name` in `admin/jsonConfig.json`.
            name: 'SolectrusAdmin',
            filename: 'customComponents.js',
            exposes: {
                './Components': './src/Components.tsx',
                './ComponentsDS': './src/ComponentsDS.tsx',
                './ComponentsBackup': './src/ComponentsBackup.tsx',
            },
            remotes: {},
            shared: moduleFederationShared(JSON.parse(readFileSync('./package.json').toString())),
        }),
        react(),
        commonjs(),
    ],
    resolve: {
        tsconfigPaths: true,
    },
    server: {
        port: 3000,
    },
    base: './',
    build: {
        target: 'chrome89',
        outDir: './build',
    },
};

export default config;
