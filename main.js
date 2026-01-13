'use strict';

/*
 * Created with @iobroker/create-adapter v3.1.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

class SolectrusInfluxdb extends utils.Adapter {
	/**
	 * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
	 */
	constructor(options) {
		super({
			...options,
			name: 'solectrus-influxdb',
		});

		this.writeApi = null;
		this.cache = {};
		this.timer = null;
		this.isUnloading = false;

		this.on('ready', this.onReady.bind(this));
		this.on('unload', this.onUnload.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
	}

	// Helper for clean ID's
	getSensorStateId(sensor) {
		return `sensors.${sensor.SensorName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
	}

	async onReady() {
		await this.setObjectNotExistsAsync('info.connection', {
			type: 'state',
			common: {
				name: 'InfluxDB connection',
				type: 'boolean',
				role: 'indicator.connected',
				read: true,
				write: false,
			},
			native: {},
		});
		this.setState('info.connection', false, true);

		if (!this.validateInfluxConfig()) {
			this.log.error('InfluxDB configuration incomplete. Adapter will stop.');
			this.timer = setInterval(() => {}, 60 * 1000);
			return;
		}

		try {
			await this.prepareInflux();
		} catch (error) {
			this.log.error(`Could not initialize InfluxDB client. Adapter stopped with Error: ${error}`);
			return;
		}

		await this.prepareSensors();

		// Write States all seconds (default 5)
		this.timer = setInterval(
			() => {
				(async () => {
					try {
						await this.writeInflux();
					} catch (err) {
						this.log.error(`Error in writeInflux: ${err}`);
					}
				})();
			},
			(this.config.interval || 5) * 1000,
		);

		this.log.info('Adapter started successfully');
	}

	validateInfluxConfig() {
		const cfg = this.config.influx;
		this.log.debug(`Status Polling Time: ${this.config.interval}`);
		this.log.debug(`Current Status of cfg: ${cfg.bucket} | ${cfg.token} | ${cfg.url} | ${cfg.org}`);
		return cfg && cfg.url?.trim() && cfg.token?.trim() && cfg.org?.trim() && cfg.bucket?.trim();
	}

	async prepareInflux() {
		const { url, token, org, bucket } = this.config.influx;

		this.influx = new InfluxDB({ url, token });
		this.writeApi = this.influx.getWriteApi(org, bucket, 'ms');

		// Testwrite for Connection Check
		const testPoint = new Point('connection_test').intField('value', 1);
		this.writeApi.writePoint(testPoint);
		await this.writeApi.flush();

		this.setState('info.connection', true, true);
	}

	async prepareSensors() {
		for (const sensor of this.config.sensors) {
			if (!sensor.enabled) {
				continue;
			}

			const id = this.getSensorStateId(sensor);
			const typeMapping = {
				int: 'number',
				float: 'number',
				bool: 'boolean',
				string: 'string',
			};

			// Verwenden Sie den in der Konfiguration gewählten Typ
			let iobType = typeMapping[sensor.type] || 'mixed';

			await this.setObjectNotExistsAsync(id, {
				type: 'state',
				common: {
					name: sensor.SensorName,
					type: iobType,
					role: 'value',
					read: true,
					write: false,
				},
				native: {
					sourceState: sensor.sourceState,
				},
			});

			if (sensor.sourceState) {
				const obj = await this.getForeignObjectAsync(sensor.sourceState);
				if (!obj) {
					this.log.warn(`Source state not found: ${sensor.sourceState}`);
					continue;
				}

				const state = await this.getForeignStateAsync(sensor.sourceState);
				if (state) {
					this.cache[id] = state.val;
					this.setState(id, state.val, true);
				}

				this.subscribeForeignStates(sensor.sourceState);
			}
		}
	}

	onStateChange(id, state) {
		if (!state || this.isUnloading || state.ack) {
			return;
		}

		if (Object.prototype.hasOwnProperty.call(this.cache, id)) {
			this.cache[id] = state.val;
			this.setState(id, state.val, true);
		}
	}

	async writeInflux() {
		try {
			if (!this.writeApi || this.isUnloading) {
				this.log.warn('Influx writeApi not initialized yet');
				this.setState('info.connection', false, true);
				return;
			}

			for (const sensor of this.config.sensors) {
				if (!sensor.enabled) {
					continue;
				}

				const id = this.getSensorStateId(sensor);
				const value = this.cache[id];
				if (value === undefined || value === null) {
					continue;
				}

				const point = new Point(sensor.measurement);

				switch (sensor.type) {
					case 'int':
						point.intField(sensor.field, parseInt(value, 10));
						break;
					case 'float':
						point.floatField(sensor.field, parseFloat(value));
						break;
					case 'bool':
						point.booleanField(sensor.field, Boolean(value));
						break;
					default:
						point.stringField(sensor.field, String(value));
				}

				this.writeApi.writePoint(point);
			}

			await this.writeApi.flush();
			this.setState('info.connection', true, true);
		} catch (err) {
			this.log.error(`Influx write failed: ${err.message}`);
			this.setState('info.connection', false, true);
		}
	}

	async onUnload(callback) {
		try {
			this.log.info('Adapter onUnload called - starting cleanup');
			this.isUnloading = true;

			if (this.timer) {
				clearInterval(this.timer);
				this.timer = null;
			}

			this.unsubscribeStates('**');

			if (this.writeApi) {
				await this.writeApi.close();
				this.writeApi = null;
			}
			this.setState('info.connection', false, true);
			this.log.info('Adapter stopped cleanly');

			callback();
		} catch (err) {
			this.log.error(`Unload error: ${err.message}`);
			callback();
		}
	}
}

//module.exports = options => new SolectrusInfluxdb(options);
if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = options => new SolectrusInfluxdb(options);
} else {
	// otherwise start the instance directly
	//(() => new SolectrusInfluxdb())();
}
