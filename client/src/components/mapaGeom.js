export const isInIsraelBbox = (lng, lat) => {
	return lng >= 34 && lng <= 36 && lat >= 29 && lat <= 34;
};

export const extractCoords = (geom, acc = []) => {
	if (Array.isArray(geom)) {
		const a = geom[0];
		const b = geom[1];
		if (typeof a === 'number' && typeof b === 'number' && geom[2] === undefined) {
			acc.push([a, b]);

			return acc;
		}
		for (const item of geom) {
			extractCoords(item, acc);
		}

		return acc;
	}
	if (geom && typeof geom === 'object') {
		if (geom.type === 'Feature' && geom.geometry) {
			return extractCoords(geom.geometry, acc);
		}
		if (geom.type === 'FeatureCollection' && Array.isArray(geom.features)) {
			for (const feature of geom.features) {
				extractCoords(feature, acc);
			}

			return acc;
		}
		if (geom.coordinates !== undefined) {
			return extractCoords(geom.coordinates, acc);
		}
	}

	return acc;
};

export const isPlanGeomValid = (geom) => {
	if (geom === null || geom === undefined || geom === '') {
		return false;
	}
	if (typeof geom === 'string') {
		return false;
	}
	if (typeof geom !== 'object' || Array.isArray(geom)) {
		return false;
	}
	if (Object.keys(geom).length === 0) {
		return false;
	}
	if (!geom.coordinates && !geom.geometry && !geom.features) {
		return false;
	}
	const coords = extractCoords(geom);
	if (coords.length === 0) {
		return false;
	}
	for (const [lng, lat] of coords) {
		if (typeof lng !== 'number' || typeof lat !== 'number' || Number.isNaN(lng) || Number.isNaN(lat)) {
			return false;
		}
		if (!isInIsraelBbox(lng, lat)) {
			return false;
		}
	}
	if (geom.type === 'Point' && coords.length === 1) {
		const [lng, lat] = coords[0];
		if (lng === 0 && lat === 0) {
			return false;
		}
	}

	return true;
};