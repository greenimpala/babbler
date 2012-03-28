// Module dependencies
var guidGenerator = require('../lib/guid-generator')
  , models 		  = require('../lib/models');

var PairingService = {}
  , POLL_WAIT_TIME = 2500;

PairingService.poll = function (sockets) {
	var self = this;

	setInterval(function () {

		if (sockets.length < 2) { return; }
		
		var _unpaired = [],
			length    = sockets.length % 2 === 0 ? sockets.length : sockets.length - 1, // Drop 1 if odd
			i         = 0;
		
		// Move an even number of sockets into an internal array
		for (i = 0; i < length; i += 1) {
			_unpaired.push(sockets.shift()); 
		}

		// Sort the sockets so males are at the end and females at the beginning
		_unpaired.sort(function (a, b) {
			var gen_1 = a.handshake.fb_user.gender,
				gen_2 = b.handshake.fb_user.gender;

			if (gen_1 === "male" && gen_2 === "female") { return 1; }
			if (gen_1 === "female" && gen_2 === "male") { return -1; }
			return 0;
		});

		length = _unpaired.length / 2;

		// Create chat sessions for all sockets
		for (i = 0; i < length; i += 1) {
			var socket_one = _unpaired.pop(),
				socket_two = _unpaired.shift();

			// Pair asynchronously 
			self.pair(socket_one, socket_two, sockets);
		}

	}, POLL_WAIT_TIME);
};

PairingService.pair = function (socket_one, socket_two, sockets) {

	// If the users are the same don't pair them
	if (socket_one.handshake.fb_user._id.toString() === 
			socket_two.handshake.fb_user._id.toString()) {
		
		// Add them back to the socket pool
		sockets.push(socket_one);
		sockets.push(socket_two);
		return; // Break here
	}

	// Create session hash
	var session = {
		_id: guidGenerator.create(),
		participants: [
			socket_one.handshake.fb_user, 
			socket_two.handshake.fb_user
		],
		is_random: true,
		button_state: 0
	};

	// Set data in both sockets
	socket_one.set('RandomSession', { 
		_id : session._id, partner : socket_two.handshake.fb_user._id,
		participants: [
			socket_one.handshake.fb_user, 
			socket_two.handshake.fb_user
		]
	});

	socket_two.set('RandomSession', { 
		_id : session._id, partner : socket_one.handshake.fb_user._id,
		participants: [
			socket_one.handshake.fb_user,
			socket_two.handshake.fb_user
		]
	});

	// Notify sockets
	socket_one.emit('new:RandomPartner', session);
	socket_two.emit('new:RandomPartner', session);
}

module.exports = PairingService;