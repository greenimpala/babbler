var mongoose = require('mongoose')

var Models = {};

Models.Settings = mongoose.model('settings', new mongoose.Schema({
	chat_sounds: { type: Boolean, default: true }
}));

Models.User = mongoose.model('user', new mongoose.Schema({
	profile_id: String,
	first_name: String,
	gender: String,
	pic_large: String,
	pic_large_url: String,
	pic_mini: String
}));

Models.Message = mongoose.model('message', new mongoose.Schema({
	session: String, // Socket.IO room id
	is_random: { type: Boolean, default: false }, // True for random, false for private
	body: String, // The message text
	sender: String, // As a user id
	datetime: { type: Date, default: Date.now } // Timestamp
}));

Models.ChatSession = mongoose.model('chat_session', new mongoose.Schema({
	_id: String, // Session id
	is_random: { type: Boolean, default: false }, // True for random, false for private
	session_begin: { type: Date, default: Date.now }, // Timestamp
	participants: [Models.User.schema], // List of participants (two partners	)
	messages: [Models.Message.schema] // List of messages
}));

module.exports = Models;