// This file extends the AdapterConfig type from "@iobroker/types"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

import { native } from '../io-package.json';

type _AdapterConfig = typeof native;

/** A single sensor mapping entry (sensors tab). */
interface SensorEntry {
	enabled: boolean;
	SensorName: string;
	sourceState: string;
	measurement: string;
	field: string;
	type: string;
	jsonPreset?: string;
	jsonTsField?: string;
	jsonValField?: string;
	jsonInfluxType?: string;
	_title?: string;
}

/** A single forecast source entry (forecast tab). */
interface ForecastEntry {
	enabled: boolean;
	name: string;
	sourceState: string;
	tsField: string;
	valField: string;
	measurement: string;
	field: string;
	type: string;
}

/** A single Data-SOLECTRUS item entry. */
interface DsItemEntry {
	enabled: boolean;
	name: string;
	formula: string;
	sourceType: string;
	sourceId: string;
	jsonPath: string;
	measurement: string;
	field: string;
	type: string;
	_title?: string;
}

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
	namespace ioBroker {
		interface AdapterConfig extends Omit<_AdapterConfig, 'sensors' | 'forecasts' | 'dsItems'> {
			sensors: SensorEntry[];
			forecasts: ForecastEntry[];
			dsItems: DsItemEntry[];
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
