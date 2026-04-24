'use strict';

/**
 * Returns the ioBroker instance id (e.g. "telegram.0") of the first alive instance of the
 * given adapter, or null when no running instance is found.
 *
 * Checks all `system.adapter.<name>.*.alive` states so the user does not need to specify
 * an instance number – ioBroker can run multiple instances of the same adapter.
 *
 * @param {object} adapter     - The ioBroker adapter instance.
 * @param {string} adapterName - Adapter name without instance number (e.g. 'telegram').
 * @returns {Promise<string|null>} Instance id string or null if none is alive.
 */
async function getAliveInstanceId(adapter, adapterName) {
	try {
		const states = await adapter.getForeignStatesAsync(`system.adapter.${adapterName}.*.alive`);
		const aliveKey = Object.keys(states).find(k => states[k] && states[k].val === true);
		if (!aliveKey) {
			return null;
		}
		// Extract instance id from 'system.adapter.telegram.0.alive' → 'telegram.0'
		return aliveKey.replace(/^system\.adapter\./, '').replace(/\.alive$/, '');
	} catch {
		return null;
	}
}

/**
 * Sends a notification to all enabled notification providers.
 *
 * Each provider is enabled via a checkbox in the adapter configuration. The adapter
 * automatically discovers all running instances of a provider and sends to the first one
 * found. If no running instance is found, a warning is logged and the send is skipped.
 *
 * Supported providers: Telegram, Pushover, WhatsApp (whatsapp-cmb), Email, Signal (signal-cmb),
 * Matrix (matrix-org), Synology Chat (synochat).
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} text    - The notification message to send.
 */
async function sendNotification(adapter, text) {
	if (!adapter.config.notifyEnabled) {
		return;
	}

	// Telegram
	if (adapter.config.notifyUseTelegram) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'telegram');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running Telegram instance found. Message could not be sent.');
			} else {
				const payload = { text };
				if (adapter.config.notifyUserTelegram) {
					payload.user = adapter.config.notifyUserTelegram;
				}
				await adapter.sendToAsync(instanceId, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Telegram] ${e.message}`);
		}
	}

	// Pushover
	if (adapter.config.notifyUsePushover) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'pushover');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running Pushover instance found. Message could not be sent.');
			} else {
				const payload = {
					message: text,
					title: adapter.config.notifyTitlePushover || 'SOLECTRUS',
				};
				if (adapter.config.notifyDevicePushover) {
					payload.device = adapter.config.notifyDevicePushover;
				}
				await adapter.sendToAsync(instanceId, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Pushover] ${e.message}`);
		}
	}

	// WhatsApp (whatsapp-cmb)
	if (adapter.config.notifyUseWhatsapp) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'whatsapp-cmb');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running WhatsApp instance found. Message could not be sent.');
			} else {
				const payload = { text };
				if (adapter.config.notifyPhoneWhatsapp) {
					payload.phone = adapter.config.notifyPhoneWhatsapp;
				}
				await adapter.sendToAsync(instanceId, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification WhatsApp] ${e.message}`);
		}
	}

	// Email
	if (adapter.config.notifyUseEmail) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'email');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running Email instance found. Message could not be sent.');
			} else {
				const emailPayload = {
					text,
					subject: adapter.config.notifySubjectEmail || 'SOLECTRUS ioBroker',
				};
				if (adapter.config.notifyToEmail) {
					emailPayload.sendTo = adapter.config.notifyToEmail;
				}
				await adapter.sendToAsync(instanceId, 'send', emailPayload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Email] ${e.message}`);
		}
	}

	// Signal (signal-cmb)
	if (adapter.config.notifyUseSignal) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'signal-cmb');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running Signal instance found. Message could not be sent.');
			} else {
				const payload = { text };
				if (adapter.config.notifyPhoneSignal) {
					payload.phone = adapter.config.notifyPhoneSignal;
				}
				await adapter.sendToAsync(instanceId, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Signal] ${e.message}`);
		}
	}

	// Matrix (matrix-org)
	if (adapter.config.notifyUseMatrix) {
		try {
			const instanceId = await getAliveInstanceId(adapter, 'matrix-org');
			if (!instanceId) {
				adapter.log.warn('[sendNotification] No running Matrix instance found. Message could not be sent.');
			} else {
				await adapter.sendToAsync(instanceId, 'send', { text });
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Matrix] ${e.message}`);
		}
	}

	// Synochat
	// The synochat adapter exposes per-channel states as: <instance>.<channelName>.message
	// Since we don't know the instance number, we find the first alive instance.
	if (adapter.config.notifyUseSynochat) {
		try {
			if (!adapter.config.notifyChannelSynochat) {
				adapter.log.warn('[sendNotification] Synology Chat channel is not set. Message could not be sent.');
			} else {
				const aliveStates = await adapter.getForeignStatesAsync('system.adapter.synochat.*.alive');
				const aliveKey = Object.keys(aliveStates).find(k => aliveStates[k] && aliveStates[k].val);
				if (!aliveKey) {
					adapter.log.warn(
						'[sendNotification] No running Synology Chat instance found. Message could not be sent.',
					);
				} else {
					// Extract instance id from 'system.adapter.synochat.0.alive' → 'synochat.0'
					const instanceId = aliveKey.replace(/^system\.adapter\./, '').replace(/\.alive$/, '');
					await adapter.setForeignStateAsync(
						`${instanceId}.${adapter.config.notifyChannelSynochat}.message`,
						text,
					);
				}
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Synochat] ${e.message}`);
		}
	}
}

module.exports = { sendNotification };
