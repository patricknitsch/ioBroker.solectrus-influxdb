'use strict';

// Helpers for computing adapter-owned ids derived from the user config.
// Kept separate so other modules can stay free of adapter-class details.

function calcTitle(item) {
	const enabled = !!(item && item.enabled);
	const displayId = getItemDisplayId(item);
	const name = (item && item.name) ? String(item.name) : (displayId || 'Item');
	return `${enabled ? '🟢 ' : '⚪ '}${name}`;
}

function getItemDisplayId(item) {
	const group = item && item.group ? String(item.group).trim() : '';
	const targetId = item && item.targetId ? String(item.targetId).trim() : '';
	if (group && targetId) return `${group}.${targetId}`;
	return targetId || group;
}

function isValidRelativeId(id) {
	if (!id) return false;
	const raw = String(id).trim();
	if (!raw) return false;
	// No absolute IDs; must be relative within this adapter
	if (raw.includes('..') || raw.startsWith('.') || raw.endsWith('.')) return false;
	// Keep it conservative: segments of [a-zA-Z0-9_-] separated by dots
	return /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(raw);
}

function getItemTargetId(item) {
	const raw = item && item.targetId ? String(item.targetId).trim() : '';
	if (!raw) return '';
	return isValidRelativeId(raw) ? raw : '';
}

function getItemGroupId(item) {
	const raw = item && item.group ? String(item.group).trim() : '';
	if (!raw) return '';
	return isValidRelativeId(raw) ? raw : '';
}

function getItemOutputId(item) {
	const group = getItemGroupId(item);
	const targetId = getItemTargetId(item);
	if (!targetId) return '';
	return group ? `${group}.${targetId}` : targetId;
}

module.exports = {
	calcTitle,
	getItemDisplayId,
	isValidRelativeId,
	getItemTargetId,
	getItemGroupId,
	getItemOutputId,
};
