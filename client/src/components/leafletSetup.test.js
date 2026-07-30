jest.mock('leaflet', () => {
	const mergeOptions = jest.fn();
	const prototype = { _getIconUrl: jest.fn() };
	return {
		__esModule: true,
		default: {
			Icon: { Default: { prototype, mergeOptions } },
		},
	};
});

import './leafletSetup';

describe('leafletSetup', () => {
	it('deletes _getIconUrl so Leaflet stops sniffing CSS', () => {
		const leaflet = require('leaflet').default;
		expect(leaflet.Icon.Default.prototype._getIconUrl).toBeUndefined();
	});
	it('merges icon/shadow URLs from webpack-imported assets', () => {
		const leaflet = require('leaflet').default;
		const mergeOptions = leaflet.Icon.Default.mergeOptions;
		expect(mergeOptions).toHaveBeenCalledTimes(1);
		const opts = mergeOptions.mock.calls[0][0];
		expect(opts).toHaveProperty('iconUrl');
		expect(opts).toHaveProperty('iconRetinaUrl');
		expect(opts).toHaveProperty('shadowUrl');
		expect(typeof opts.iconUrl).toBe('string');
		expect(opts.iconUrl.length).toBeGreaterThan(0);
	});
});