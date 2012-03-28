var mongoose = require('mongoose')

var Models = {};

Models.User = mongoose.model('user', new mongoose.Schema({
	profile_id: String,
	first_name: String,
	gender: String,
	pic_large_url: String,
	pic_mini_url: String,
	online_status: { type: Boolean, default: false },
	join_date: { type: Date, default: Date.now } // Timestamp
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
	button_state: Number,
	participants: [{ type: mongoose.Schema.ObjectId, ref: 'user' }], // List of participants
	messages: [Models.Message.schema] // List of messages
}));

module.exports = Models;