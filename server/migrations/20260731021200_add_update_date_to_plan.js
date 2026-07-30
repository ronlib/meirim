exports.up = function(knex) {
	return knex.schema.table('plan', table => {
		table.text('UPDATE_DATE');
	});
};

exports.down = function(knex) {
	return knex.schema.table('plan', table => {
		table.dropColumn('UPDATE_DATE');
	});
};
