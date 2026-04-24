'use strict';

/**
 * Notification message templates keyed by ioBroker language code.
 *
 * Supported placeholder tokens: {name}, {lastTs}, {expectedBy}, {value}, {maxVal}, {lastValid}
 */
const messages = {
	en: {
		influxConnectionFailed: 'InfluxDB connection failed – check URL, Token, Org and Bucket',
		influxConnectionRestored: 'InfluxDB connection restored',
		sensorTimeout: 'Sensor "{name}": no update since {lastTs} (update expected by {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" delivers implausible value ({value} > max {maxVal}). No last valid value available, skipping point.',
		maxValueExceeded:
			'Sensor "{name}" delivers implausible value ({value} > max {maxVal}). Using last valid value ({lastValid}) instead.',
	},
	de: {
		influxConnectionFailed: 'InfluxDB-Verbindung fehlgeschlagen – URL, Token, Org und Bucket prüfen',
		influxConnectionRestored: 'InfluxDB-Verbindung wiederhergestellt',
		sensorTimeout: 'Sensor "{name}": keine Aktualisierung seit {lastTs} (Aktualisierung erwartet bis {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" liefert unplausiblen Wert ({value} > max {maxVal}). Kein letzter gültiger Wert verfügbar, Datenpunkt wird übersprungen.',
		maxValueExceeded:
			'Sensor "{name}" liefert unplausiblen Wert ({value} > max {maxVal}). Letzter gültiger Wert ({lastValid}) wird verwendet.',
	},
	fr: {
		influxConnectionFailed: "Connexion InfluxDB échouée – vérifiez l'URL, le Token, l'Org et le Bucket",
		influxConnectionRestored: 'Connexion InfluxDB rétablie',
		sensorTimeout:
			'Capteur "{name}" : aucune mise à jour depuis {lastTs} (mise à jour attendue avant {expectedBy})',
		maxValueExceededNoLastValid:
			'Capteur "{name}" fournit une valeur implausible ({value} > max {maxVal}). Aucune dernière valeur valide disponible, point ignoré.',
		maxValueExceeded:
			'Capteur "{name}" fournit une valeur implausible ({value} > max {maxVal}). Utilisation de la dernière valeur valide ({lastValid}).',
	},
	pl: {
		influxConnectionFailed: 'Połączenie z InfluxDB nieudane – sprawdź URL, Token, Org i Bucket',
		influxConnectionRestored: 'Połączenie z InfluxDB przywrócone',
		sensorTimeout: 'Sensor "{name}": brak aktualizacji od {lastTs} (aktualizacja oczekiwana do {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" dostarcza nieprawdopodobną wartość ({value} > maks {maxVal}). Brak ostatniej prawidłowej wartości, punkt pomijany.',
		maxValueExceeded:
			'Sensor "{name}" dostarcza nieprawdopodobną wartość ({value} > maks {maxVal}). Używana ostatnia prawidłowa wartość ({lastValid}).',
	},
	ru: {
		influxConnectionFailed: 'Ошибка подключения к InfluxDB – проверьте URL, Token, Org и Bucket',
		influxConnectionRestored: 'Подключение к InfluxDB восстановлено',
		sensorTimeout: 'Сенсор "{name}": нет обновлений с {lastTs} (обновление ожидалось до {expectedBy})',
		maxValueExceededNoLastValid:
			'Сенсор "{name}" возвращает недостоверное значение ({value} > макс {maxVal}). Последнее корректное значение отсутствует, точка пропущена.',
		maxValueExceeded:
			'Сенсор "{name}" возвращает недостоверное значение ({value} > макс {maxVal}). Используется последнее корректное значение ({lastValid}).',
	},
	it: {
		influxConnectionFailed: 'Connessione InfluxDB fallita – verificare URL, Token, Org e Bucket',
		influxConnectionRestored: 'Connessione InfluxDB ripristinata',
		sensorTimeout: 'Sensore "{name}": nessun aggiornamento da {lastTs} (aggiornamento atteso entro {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensore "{name}" fornisce un valore implausibile ({value} > max {maxVal}). Nessun ultimo valore valido disponibile, punto saltato.',
		maxValueExceeded:
			'Sensore "{name}" fornisce un valore implausibile ({value} > max {maxVal}). Utilizzo dell\'ultimo valore valido ({lastValid}).',
	},
	pt: {
		influxConnectionFailed: 'Conexão InfluxDB falhou – verifique URL, Token, Org e Bucket',
		influxConnectionRestored: 'Conexão InfluxDB restaurada',
		sensorTimeout: 'Sensor "{name}": sem atualização desde {lastTs} (atualização esperada até {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" fornece valor implausível ({value} > máx {maxVal}). Nenhum último valor válido disponível, ponto ignorado.',
		maxValueExceeded:
			'Sensor "{name}" fornece valor implausível ({value} > máx {maxVal}). Usando último valor válido ({lastValid}).',
	},
	uk: {
		influxConnectionFailed: 'Помилка підключення до InfluxDB – перевірте URL, Token, Org та Bucket',
		influxConnectionRestored: 'Підключення до InfluxDB відновлено',
		sensorTimeout: 'Сенсор "{name}": немає оновлень з {lastTs} (оновлення очікувалось до {expectedBy})',
		maxValueExceededNoLastValid:
			'Сенсор "{name}" повертає недостовірне значення ({value} > макс {maxVal}). Останнє коректне значення відсутнє, точка пропущена.',
		maxValueExceeded:
			'Сенсор "{name}" повертає недостовірне значення ({value} > макс {maxVal}). Використовується останнє коректне значення ({lastValid}).',
	},
	nl: {
		influxConnectionFailed: 'InfluxDB-verbinding mislukt – controleer URL, Token, Org en Bucket',
		influxConnectionRestored: 'InfluxDB-verbinding hersteld',
		sensorTimeout: 'Sensor "{name}": geen update sinds {lastTs} (update verwacht voor {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" levert een onplausibele waarde ({value} > max {maxVal}). Geen laatste geldige waarde beschikbaar, punt overgeslagen.',
		maxValueExceeded:
			'Sensor "{name}" levert een onplausibele waarde ({value} > max {maxVal}). Gebruik van laatste geldige waarde ({lastValid}).',
	},
	es: {
		influxConnectionFailed: 'Fallo de conexión a InfluxDB – compruebe URL, Token, Org y Bucket',
		influxConnectionRestored: 'Conexión a InfluxDB restaurada',
		sensorTimeout:
			'Sensor "{name}": sin actualización desde {lastTs} (actualización esperada antes de {expectedBy})',
		maxValueExceededNoLastValid:
			'Sensor "{name}" entrega un valor implausible ({value} > máx {maxVal}). Sin último valor válido disponible, punto omitido.',
		maxValueExceeded:
			'Sensor "{name}" entrega un valor implausible ({value} > máx {maxVal}). Usando el último valor válido ({lastValid}).',
	},
	'zh-cn': {
		influxConnectionFailed: 'InfluxDB连接失败 – 请检查URL、Token、Org和Bucket',
		influxConnectionRestored: 'InfluxDB连接已恢复',
		sensorTimeout: '传感器"{name}"：自{lastTs}起无更新（预期更新截止{expectedBy}）',
		maxValueExceededNoLastValid:
			'传感器"{name}"返回不可信的值（{value} > 最大值 {maxVal}）。无上一个有效值，跳过此数据点。',
		maxValueExceeded:
			'传感器"{name}"返回不可信的值（{value} > 最大值 {maxVal}）。使用上一个有效值（{lastValid}）。',
	},
};

/**
 * Returns a localized notification message for the given key, substituting any placeholders.
 *
 * Falls back to English when the adapter's configured system language is not supported.
 *
 * @param {object} adapter                          - The ioBroker adapter instance.
 * @param {string} key                              - Message key (e.g. 'influxConnectionFailed').
 * @param {Record<string, string|number>} [params]  - Placeholder values keyed by token name.
 * @returns {string} Localized message with placeholders replaced.
 */
function getNotificationMessage(adapter, key, params) {
	const lang = adapter.systemLanguage || 'en';
	const langMsgs = messages[lang] || messages.en;
	const template = langMsgs[key] || messages.en[key] || key;
	if (!params) {
		return template;
	}
	return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

module.exports = { getNotificationMessage };
