import { isPlanGeomValid, isInIsraelBbox } from './mapaGeom';

describe('isInIsraelBbox', () => {
	it('returns true for points inside Israel bbox', () => {
		expect(isInIsraelBbox(35.0, 32.0)).toBe(true);
		expect(isInIsraelBbox(34.0, 29.0)).toBe(true);
		expect(isInIsraelBbox(36.0, 34.0)).toBe(true);
	});

	it('returns false for points outside Israel bbox', () => {
		expect(isInIsraelBbox(10, 10)).toBe(false);
		expect(isInIsraelBbox(200000, 600000)).toBe(false);
		expect(isInIsraelBbox(33.9, 32.0)).toBe(false);
		expect(isInIsraelBbox(36.1, 32.0)).toBe(false);
		expect(isInIsraelBbox(35.0, 28.9)).toBe(false);
		expect(isInIsraelBbox(35.0, 34.1)).toBe(false);
	});
});

describe('isPlanGeomValid', () => {
	describe('invalid inputs', () => {
		const invalidCases = [
			['null', null],
			['undefined', undefined],
			['empty string', ''],
			['empty object', {}],
			['empty coordinates point', { type: 'Point', coordinates: [] }],
			['placeholder point [0,0]', { type: 'Point', coordinates: [0, 0] }],
			['empty coordinates polygon', { type: 'Polygon', coordinates: [] }],
			['point outside Israel', { type: 'Point', coordinates: [10, 10] }],
			['ITM-style far-out point', { type: 'Point', coordinates: [200000, 600000] }],
		];

		invalidCases.forEach(([name, value]) => {
			it(`returns false for ${name}`, () => {
				expect(isPlanGeomValid(value)).toBe(false);
			});
		});
	});

	describe('valid inputs', () => {
		const validPolygon = {
			type: 'Polygon',
			coordinates: [[[35.0, 32.0], [35.1, 32.0], [35.1, 32.1], [35.0, 32.1], [35.0, 32.0]]],
		};
		const validMultiPolygon = {
			type: 'MultiPolygon',
			coordinates: [[[[35.0, 32.0], [35.1, 32.0], [35.1, 32.1], [35.0, 32.1], [35.0, 32.0]]]],
		};
		const validPoint = { type: 'Point', coordinates: [35.2, 32.8] };

		it('returns true for a real Israel Polygon', () => {
			expect(isPlanGeomValid(validPolygon)).toBe(true);
		});

		it('returns true for a real Israel MultiPolygon', () => {
			expect(isPlanGeomValid(validMultiPolygon)).toBe(true);
		});

		it('returns true for a valid Israel Point', () => {
			expect(isPlanGeomValid(validPoint)).toBe(true);
		});
	});
});