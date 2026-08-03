import React from 'react';

// Standalone dev-preview shell only; the real host is ioBroker.admin loading
// the federation build via jsonConfig "custom" components (see vite.config.ts).
export default function App(): React.JSX.Element {
    return <div style={{ padding: 16 }}>SOLECTRUS admin UI dev preview - open a component directly to test it.</div>;
}
