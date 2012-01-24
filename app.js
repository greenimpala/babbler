// Module dependencies.
var express         = require('express'),
	routes         	= require('./routes'),
	mongoose    	= require('mongoose'),
	everyauth      	= require('everyauth'),
	util        	= require('util'),
	parseCookie    	= require('connect').utils.parseCookie,
	MongoStore     	= require('connect-mongo');
	
// Services
var authService      		= require('./lib/auth-service'),
	profilePicService    	= require('./lib/profile-pic-service'),
	partnerPairingService   = require('./lib/partner-pairing-service'),
	models               	= require('./lib/models'),
	guidGenerator        	= require('./lib/guid-generator'),
	sensitive               = require('./lib/sensitive'),
	messageParser           = require('./lib/message-parser');

// Configuration
var app = module.exports = express.createServer(),
	io  = require('socket.io').listen(app);
	
process.on('uncaughtException', function (err) {
	console.log("ERROR: An uncaught exception was thrown... Printing details...");
	console.error(err);
});

// Database
sessionStore = new MongoStore({ 
	host           : sensitive.db.host, 
	port           : sensitive.db.port, 
	username       : sensitive.db.user, 
	password       : sensitive.db.pass, 
	db             : sensitive.db.database,
	clear_interval : (60 * 60) * 4 // Clear old sessions every four hours
});
mongoose.connect(sensitive.db.url);

// Authorization
everyauth.facebook
	.scope('user_photos')
	.appId(sensitive.fb.appId)
	.appSecret(sensitive.fb.appSecret)
	.findOrCreateUser(function (session, accessToken, accessTokExtra, fbData) {
		return authService.authoriseAndGetPromise(fbData, this.Promise());
	})
	.redirectPath('/chat');
everyauth.helpExpress(app);

app.configure(function () {
	app.set('views', __dirname + '/views');
	app.set('view engine', 'jade');
	app.set('view options', { pretty: 'true' });
	app.use(express.bodyParser());
	app.use(express.cookieParser());
	app.use(express.session({ 
		store: sessionStore,
		secret: sensitive.session.secret,
		key: 'express.sid'
	}));
	app.use(everyauth.middleware());
	app.use(express.methodOverride());
	app.use(app.router);
	app.use(express.static(__dirname + '/public'));
	app.use(express.errorHandler());
});

app.configure('development', function () {
	app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function () {
	app.use(express.errorHandler()); 
});

// Routes
app.get('/', function(req, res) {
	res.render('index', {title: 'Welcome to Babbler!'});
});

app.get('/chat', function(req, res) {
	if (req.loggedIn) {
		var userId = req.session.auth.facebook.user.id;
		
		return models.User.findOne({ profile_id: userId }, function (err, user) {
			if (err) { return res.end('Db error, contact administrator.'); }

			return res.render('chat', {
				title: 'Welcome to Babbler!',
				layout: '_chat',
				currentUser: user,
				online: io.sockets.clients().length + 1 // +1 to account for this user
			});
		});
	}
	return res.redirect("/");
});

app.get('/admin', function(req, res) {
	req.end();
});

// Socket.io
var socketPool = []; // Sockets requesting partners

partnerPairingService.poll(socketPool); // Service runs continuously, pairing available sockets.

// Initial authorization for a connecting socket
io.set('authorization', function (handshakeData, callback) {
	if (handshakeData.headers.cookie) {
		handshakeData.cookie = parseCookie(handshakeData.headers.cookie);
		handshakeData.sessionID = handshakeData.cookie['express.sid'];

		return sessionStore.get(handshakeData.sessionID, function (err, session) {
			if (err || !session) { return callback('Invalid session', false); }
			
			try {
				// Catch nescessary as session may exist 
				// but facebook auth data may not exist
				var userId      = session.auth.facebook.user.id,
					accessToken = session.auth.facebook.accessToken;
				
				return models.User.findOne({ profile_id: userId }, function (err, user) {
					if (err) { throw new Error('Db error'); }
					
					handshakeData.fb_user     = user; // Set fb user data in the users socket.handshake
					handshakeData.accessToken = accessToken; // Set access token, socket may need to make API calls
					
					return callback(null, true);
				});
			} catch (e) {
				return callback('Invalid session', false);
			}
		});
	}
	return callback('No cookie transmitted.', false);
});

io.configure(function () {
	io.set("transports", ['websocket', 'xhr-polling', 'jsonp-polling', 'htmlfile']); 
	io.set("polling duration", 20); 
	io.set("browser client minification", true);
	io.set("close timeout", 8);
	io.set('log level', 1);
});

// Emit to all sockets the number of connected sockets
var usersOnline = setInterval(function () {
	io.sockets.emit('usersOnline', io.sockets.clients().length);
}, 1000 * 60); // Every minute

io.sockets.on('connection', function (socket) {

	// Checks if user has an associated profile picture
	// and downloads one if nescessary.
	socket.on('init', function (data) {
		var userId = socket.handshake.fb_user.profile_id;
		var accessToken = socket.handshake.accessToken;
		
		models.User.findOne({ profile_id: userId }, function (err, user) {
			if (err) { return socket.emit('initFailed'); }
			
			// Check if user is new / has no profile picture
			if (!user.pic_large) {
				return profilePicService.updateProfilePictures(accessToken, userId, function (err, pictureURL) {
					if (err) { return socket.emit('initFailed'); }

					socket.handshake.fb_user.pic_large_url = pictureURL; // Fix socket: oiginally had no picture.
					return socket.emit('initSuccess', pictureURL);
				});
			}
			socket.emit('initSuccess', user.pic_large_url);
		});
	});
	
	socket.on('requestPartner', function (data) {
		return socketPool.push(socket);
	});
	
	socket.on('endChat', function () {
		socket.get('currentRoom', function (err, roomName) {
			if (err || !roomName) { return; }
			
			socket.broadcast.to(roomName).emit('partnerDisconnect');
			socket.leave(roomName);
			socket.set('currentRoom', null);
			
			console.log("User '" + socket.handshake.fb_user.first_name + "' left a room.");
		});
	});
	
	socket.on('sendMessage', function (data) {
		socket.get('currentRoom', function (err, roomName) {
			if (err || !roomName) { return; }
			
			var message = messageParser.parse(data.body);
			socket.broadcast.to(roomName).emit('newMessage', { body: message });
		});
	});
	
	socket.on('sendTypingUpdate', function (isTyping) {
		socket.get('currentRoom', function (err, roomName) {
			if (err || !roomName) { return; }
			
			socket.broadcast.to(roomName).emit('partnerTyping', isTyping);
		});
	});
	
	socket.on('disconnect', function () {
		socket.get('currentRoom', function (err, roomName) {
			if (err || !roomName) { return; }
			
			socket.broadcast.to(roomName).emit('partnerDisconnect');
		});
		var i;
		// Remove the disconected socket from the socketPool
		for (i = 0; i < socketPool.length; i += 1) {
			if (socketPool[i] === socket) {
				socketPool.splice(i, 1);
				return;
			}
		}
	});
});

var port = process.env.PORT || 3000;
app.listen(port);
console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);