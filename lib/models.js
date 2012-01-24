var mongoose = require('mongoose')

var Models = {};

Models.User = mongoose.model('user', new mongoose.Schema({
	profile_id: String,
	first_name: String,
	gender: String,
	pic_large: String,
	pic_large_url: String,
	pic_mini: String
}));

Models.Message = mongoose.model('message', new mongoose.Schema({
	body: String,
	sender: String
}));

Models.ChatSessioon = mongoose.model('chat_session', new mongoose.Schema({
	session_begin: Date,
	participants: [Models.User],
	messages: [Models.Message]
}));

module.exports = Models;