/*!
 * Bookshelf-PostGIS
 *
 * Copyright 2017 Josh Swan and contributors
 * Released under the MIT license
 * https://github.com/joshswan/bookshelf-postgis/blob/master/LICENSE
 */

module.exports = (bookshelf) => {
	const proto = bookshelf.Model.prototype;

	bookshelf.Model = bookshelf.Model.extend({
		geometry: null,

		format (attributes) {
			// Convert geometry attributes to raw ST_GeomFromGeoJSON and stringify GeoJSON attributes
			if (this.geometry) {
				this.geometry.forEach((attr) => {
					if (attributes[attr]) {
						attributes[attr] = bookshelf.knex.raw('ST_GeomFromGeoJSON(?)', [
							JSON.stringify(attributes[attr])
						]);
					}
				});
			}

			// Call parent format method
			return proto.format.call(this, attributes);
		},

		parse (attributes) {
			// // Parse geometry columns to GeoJSON
			if (this.geometry) {
				this.geometry.forEach((attr) => {
					if (attributes[attr] && Array.isArray(attributes[attr])) {
						const json = [];
						if (attributes[attr][0] && attributes[attr][0][0] && attributes[attr][0][0][0]) {
							attributes[attr].map((att, i) => {
								json[i] = [];
								att.map((el, k) => {
									json[i][k] = [];
									el.length > 0 && el.map((elj, j) => {
										json[i][k][j] = [elj.x, elj.y];
									});
								});
							});

							attributes[attr] = {
								type: 'MultiPolygon',
								coordinates: json
							};
						} else {
							attributes[attr].map((el, i) => {
								json[i] = [];
								el.length > 0 && el.map((elj, j) => {
									json[i][j] = [elj.x, elj.y];
								});
							});
							attributes[attr] = {
								type: 'Polygon',
								coordinates: json
							};
						}
					}
				});
			}

			// Call parent parse method
			return proto.parse.call(this, attributes);
		}
	});
};
