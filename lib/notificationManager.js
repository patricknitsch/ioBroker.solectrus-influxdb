'use strict';

/**
 * Sends a notification to all configured notification providers.
 *
 * Notification providers are enabled by setting the corresponding instance field in the
 * adapter configuration. If a provider instance is not configured or its adapter instance
 * is not running, the notification is skipped with a warning log entry.
 *
 * Supported providers: Telegram, Pushover, WhatsApp (whatsapp-cmb), Email, Signal (signal-cmb),
 * Matrix, Synochat.
 *
 * @param {object} adapter - The ioBroker adapter instance.
 * @param {string} text    - The notification message to send.
 */
async function sendNotification(adapter, text) {
	if (!adapter.config.notifyEnabled) {
		return;
	}

	// Telegram
	if (adapter.config.notifyInstanceTelegram) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceTelegram}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Telegram instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				const payload = { text };
				if (adapter.config.notifyUserTelegram) {
					payload.user = adapter.config.notifyUserTelegram;
				}
				await adapter.sendToAsync(adapter.config.notifyInstanceTelegram, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Telegram] ${e.message}`);
		}
	}

	// Pushover
	if (adapter.config.notifyInstancePushover) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstancePushover}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Pushover instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				const payload = {
					message: text,
					title: adapter.config.notifyTitlePushover || 'SOLECTRUS',
				};
				if (adapter.config.notifyDevicePushover) {
					payload.device = adapter.config.notifyDevicePushover;
				}
				await adapter.sendToAsync(adapter.config.notifyInstancePushover, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Pushover] ${e.message}`);
		}
	}

	// WhatsApp (whatsapp-cmb)
	if (adapter.config.notifyInstanceWhatsapp) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceWhatsapp}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] WhatsApp instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				const payload = { text };
				if (adapter.config.notifyPhoneWhatsapp) {
					payload.phone = adapter.config.notifyPhoneWhatsapp;
				}
				await adapter.sendToAsync(adapter.config.notifyInstanceWhatsapp, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification WhatsApp] ${e.message}`);
		}
	}

	// Email
	if (adapter.config.notifyInstanceEmail) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceEmail}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Email instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				const emailPayload = {
					text,
					subject: adapter.config.notifySubjectEmail || 'SOLECTRUS ioBroker',
				};
				if (adapter.config.notifyToEmail) {
					emailPayload.sendTo = adapter.config.notifyToEmail;
				}
				await adapter.sendToAsync(adapter.config.notifyInstanceEmail, 'send', emailPayload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Email] ${e.message}`);
		}
	}

	// Signal (signal-cmb)
	if (adapter.config.notifyInstanceSignal) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceSignal}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Signal instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				const payload = { text };
				if (adapter.config.notifyPhoneSignal) {
					payload.phone = adapter.config.notifyPhoneSignal;
				}
				await adapter.sendToAsync(adapter.config.notifyInstanceSignal, 'send', payload);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Signal] ${e.message}`);
		}
	}

	// Matrix
	if (adapter.config.notifyInstanceMatrix) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceMatrix}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Matrix instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else {
				await adapter.sendToAsync(adapter.config.notifyInstanceMatrix, 'send', { text });
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Matrix] ${e.message}`);
		}
	}

	// Synochat
	// The synochat adapter exposes per-channel states as: <instance>.<channelName>.message
	if (adapter.config.notifyInstanceSynochat) {
		try {
			const alive = await adapter.getForeignStateAsync(
				`system.adapter.${adapter.config.notifyInstanceSynochat}.alive`,
			);
			if (!alive || !alive.val) {
				adapter.log.warn(
					'[sendNotification] Synochat instance is not running. Message could not be sent. Please check your instance configuration.',
				);
			} else if (adapter.config.notifyChannelSynochat) {
				await adapter.setForeignStateAsync(
					`${adapter.config.notifyInstanceSynochat}.${adapter.config.notifyChannelSynochat}.message`,
					text,
				);
			} else {
				adapter.log.warn(
					'[sendNotification] Synochat channel is not set. Message could not be sent. Please check your instance configuration.',
				);
			}
		} catch (e) {
			adapter.log.error(`[sendNotification Synochat] ${e.message}`);
		}
	}
}

module.exports = { sendNotification };
