const CrawlMetaStruct = function(table) {
	table.increments('id').primary();
	table.string('key', 255).notNullable().unique();
	table.text('value');
	table.timestamps(true, true);
	return table;
};

module.exports = CrawlMetaStruct;
