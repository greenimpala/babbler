// Module dependencies
var express         = require('express'),
    routes          = require('./routes'),
    mongoose        = require('mongoose'),
    everyauth       = require('everyauth'),
    util            = require('util'),
    parseCookie     = require('connect').utils.parseCookie,
    MongoStore      = require('connect-mongo');
    
// Services
var authService             = require('./lib/auth-service'),
    profilePicService       = require('./lib/profile-pic-service'),
    partnerPairingService   = require('./lib/partner-pairing-service'),
    models                  = require('./lib/models'),
    guidGenerator           = require('./lib/guid-generator'),
    sensitive               = require('./lib/sensitive');

// Configuration
var app = module.exports = express.createServer(),
    io  = require('socket.io').listen(app);
    
process.on('uncaughtException', function (err) {
    console.log("Uncaught exception");
    console.error(err);
    console.log(err.stack);
});

/** 
 * Database
 **/
sessionStore = new MongoStore({ 
    host           : sensitive.db.host, 
    port           : sensitive.db.port, 
    username       : sensitive.db.user, 
    password       : sensitive.db.pass, 
    db             : sensitive.db.database,
    clear_interval : (60 * 60) * 5 // Clear old sessions every five hours
});
mongoose.connect(sensitive.db.url);

/** 
 * Authorisation
 **/
everyauth.facebook
    .scope('user_photos, publish_actions')
    .myHostname('http://www.babblerchat.com')
    .appId(sensitive.fb.appId)
    .appSecret(sensitive.fb.appSecret)
    .handleAuthCallbackError(function (req, res) {
        return res.redirect("/");
    })
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

/** 
 * Routes
 **/
app.get('/', function(req, res) {
    if (req.loggedIn) {
        return res.redirect("/chat");
    }
    res.render('index', { title: 'Babbler - Chat to random people on Facebook!' });
});

app.get('/chat', function(req, res) {
    if (req.loggedIn) {
        var userId = req.session.auth.facebook.user.id;
        
        return models.User.findOne({ profile_id: userId }, function (err, user) {
            if (err) { return res.end('Database error.'); }

            return res.render('chat', {
                title: 'Babbler - Chat to random people on Facebook!',
                layout: '_chat',
                currentUser: user,
                online: io.sockets.clients().length
            });
        });
    }
    // Else redirect to home
    return res.redirect("/");
});

app.get('/admin', function(req, res) {
    req.end();
});

/** 
 * Socket.IO
 **/
var socketPool = []; // Sockets requesting partners

partnerPairingService.poll(socketPool); // Service runs continuously, pairing available sockets.

// Initial authorization for a connecting socket
// Returns callback (null, true) if auth was succesful
io.set('authorization', function (handshake, callback) {
    if (handshake.headers.cookie) {
        handshake.cookie = parseCookie(handshake.headers.cookie);
        handshake.sessionID = handshake.cookie['express.sid'];

        return sessionStore.get(handshake.sessionID, function (err, session) {
            if (err || !session) { return callback('Invalid session', false); }
            
            try {
                // Catch nescessary as session may exist 
                // but facebook auth data may not exist
                var userId      = session.auth.facebook.user.id,
                    accessToken = session.auth.facebook.accessToken;
                
                return models.User.findOne({ profile_id: userId }, function (err, user) {
                    if (err) { throw new Error('Db error'); }

                    handshake.fb_user     = user; // Set fb user data in the users socket.handshake
                    handshake.accessToken = accessToken; // Set access token, socket may need to make API calls
                    
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
    io.enable('browser client minification');  // send minified client
    io.enable('browser client etag');          // apply etag caching logic based on version number
    io.enable('browser client gzip');          // gzip the file
    io.set('log level', 1);
});

// Emit to all sockets the number of connected sockets
var usersOnline = setInterval(function () {
    io.sockets.emit('update:UsersOnline', io.sockets.clients().length - 1);
}, 1000 * 60); // Every minute

io.sockets.on('connection', function (socket) {

    // Checks if user has a profile picture
    // Downloads one if nescessary and returns the updated user model.
    socket.on('init', function (data, res) {
        var userId = socket.handshake.fb_user.profile_id;
        var accessToken = socket.handshake.accessToken;
        
        models.User.findOne({ profile_id: userId }, function (err, user) {
            if (err) { return res(err); }

            // Set socket to listen on a room named after their _id
            // Any chat responses from chat sessions will be sent to this room
            socket.join(user._id);
            
            // Check if user is new / has no profile picture
            if (!user.pic_large_url) {
                return profilePicService.getProfilePictureUrl(accessToken, userId, function (err, pictureURL) {
                    if (err) { return res(err); }

                    user.pic_large_url = pictureURL;
                    user.save();

                    socket.handshake.fb_user.pic_large_url = pictureURL; // Fix socket handshake as it originally had no picture
                    res(null, socket.handshake.fb_user);
                });
            }
            res(null, socket.handshake.fb_user);
        });
    });

    // Client is requesting their collection of private chat sessions
    socket.on('read:ChatSessionCollection', function (data, res) {
        // Find all chat sessions for this user
        // Exclude messages
        models.ChatSession.find({ 
            'participants._id' : socket.handshake.fb_user._id 
        }, { 'messages' : 0 }, function (err, sessions) {
            if (err || !sessions) { return res([]); }
            res(sessions);
        });
    });

    // Client is requesting old messages for a private chat session
    socket.on('read:MessageCollection', function (data, res) {
        models.ChatSession.findOne({ $and: [
            { _id : data.session },
            { 'participants._id' : socket.handshake.fb_user._id }
        ]}, { 'messages' : 1 }, function (err, session) {
            if (err || !session) { return res([]); }

            res(session.messages.slice(-30)) // Cap at 30 most recent messages
        });
    });

    // Client is requesting a random partner
    socket.on('create:RandomChatSession', function () {
        socketPool.push(socket); // Add socket to socket pool
    });
    
    // Client has sent a new message
    socket.on('create:Message', function (message, res) {
        socket.broadcast.to(message.partner).emit('new:Message', message);
        res();

        // If the message belongs to a private session it needs to be persisted
        if (!message.is_random) {
            var session = message.session;

            // Optimize insert
            delete message.partner;
            delete message.session;
            delete message.is_random;

            // Insert message
            models.ChatSession.collection.update({ $and: [
                { '_id' : session },
                { 'participants._id' : socket.handshake.fb_user._id }
            ]}, { $push : { 'messages' : message } });
        }
    });

    // User has sent or is accepting a friend request
    socket.on('update:FriendStatus', function (data) {
        // Validate
        if (isNaN(data.state) && data.state > 3 && data.state < 0) { return; }

        return socket.get('RandomSession', function (err, session) {
            // Validation
            if (err || !session) { return; }

            // TO-DO: validate the state

            // User has accepted the friend request
            // Create friendship
            if (data.state === 3) {
                var new_session = new models.ChatSession({
                    _id: guidGenerator.create(),
                    participants: session.participants,
                    button_state: 3 // User pair are friends
                });

                // Save new session in database
                new_session.save(function(err){
                    if (err) { return; }

                    // Inform user pair
                    socket.broadcast.to(session.partner).emit('new:PrivateChatSession', new_session);
                    socket.emit('new:PrivateChatSession', new_session);
                });
            }

            socket.broadcast.to(session.partner).emit('update:FriendStatus', data);
        });
    });
    
    socket.on('create:TypingStatus', function (typing, res) {
        socket.broadcast.to(typing.partner).emit('new:TypingStatus', typing);
        res();
    });

    socket.on('delete:ChatSession', function (session, res) {
        socket.broadcast.to(session.partner).emit('delete:ChatSession', session);
        res();

        // If the session is private, delete it in the database
        if (!session.is_random) {
            models.ChatSession.collection.remove({ $and: [
                { _id : session._id },
                { 'participants._id' : socket.handshake.fb_user._id }
            ]});
        }
    });
    
    socket.on('disconnect', function () {
        var i;

        // If the socket is in a random room, end the chat session
        socket.get('RandomSession', function (err, session) {
            if (err || !session) { return; }
            socket.broadcast.to(session.partner).emit('delete:ChatSession', session);
        });

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