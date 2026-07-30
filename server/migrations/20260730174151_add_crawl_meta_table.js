exports.up = function(knex) {
	return knex.schema.createTable('crawl_meta', table => {
		table.increments('id').primary();
		table.string('key', 255).notNullable().unique();
		table.text('value');
		table.timestamps(true, true);
	})
	.then(() => {
		return knex('crawl_meta').insert({
			key: 'last_successful_mavat_crawl',
			value: null
		});
	});
};

exports.down = function(knex) {
	return knex.schema.dropTableIfExists('crawl_meta');
};
