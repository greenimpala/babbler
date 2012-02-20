var sensitive = {};

sensitive.db = {
	url      : "mongodb://P60533gr5375fB13vl4c68n4256p:pn6DnlxC8Vu8lSRv15B5XHJMPqYL@ds031117.mongolab.com:31117/babbler",
	host     : "ds031117.mongolab.com",
	port     : 31117,
	user     : "P60533gr5375fB13vl4c68n4256p",
	pass     : "pn6DnlxC8Vu8lSRv15B5XHJMPqYL",
	database : "babbler"
};

sensitive.fb = {
	appId     : "273284762734006",
	appSecret : "ec8bef0dbaadc65c9bc97550e9278b87"
};

sensitive.s3 = {
	key     : "AKIAIITI5IKH6VDBYMLA",
	secret  : "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",
	bucket  : "babbler-chat"	
};

sensitive.session = {
	secret : "90f9c5d8xJe"
}

module.exports = sensitive;