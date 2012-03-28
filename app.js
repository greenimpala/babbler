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
 * Session Store
 **/
sessionStore = new MongoStore({ 
    host           : sensitive.db.host, 
    port           : sensitive.db.port, 
    username       : sensitive.db.user, 
    password       : sensitive.db.pass, 
    db             : sensitive.db.database,
    clear_interval : (60 * 60) * 4 // Clear old sessions every four hours
});
mongoose.connect(sensitive.db.url);

/** 
 * Authorisation
 **/
everyauth.facebook
    .scope('user_photos')
    //.myHostname('http://www.babblerchat.com')
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

/** 
 * Configuration
 **/
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
    app.use(express.favicon());
    app.use(everyauth.middleware());
    app.use(express.methodOverride());
    app.use(app.router);
    app.use(express.static(__dirname + '/public', { maxAge: 2500000000 })); // Cache static assets for 1 month
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
var title = "Babbler - Chat to random people on Facebook!";

app.get('/', function(req, res) {
    if (req.loggedIn) {
        return res.redirect("/chat");
    }
    res.render('index', { 'title': title });
});

app.get('/chat', function(req, res) {
    if (req.loggedIn) {
        var userId = req.session.auth.facebook.user.id;
        
        return models.User.findOne({ profile_id: userId }, { profile_id: 0 },  function (err, user) {
            if (err) { return res.end('Database error.'); }

            return res.render('chat', {
                'title': title,
                'layout': '_chat',
                'currentUser': user,
                'online': io.sockets.clients().length
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
var socket_pool = []; // Sockets requesting partners

partnerPairingService.poll(socket_pool); // Service runs continuously, pairing available sockets.

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
                var userId  = session.auth.facebook.user.id
                  , accessToken = session.auth.facebook.accessToken;
                
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

            // Set socket as online
            user.online_status = true;
            user.save();

            // Set socket to listen on a room named after their _id
            // Any chat responses from chat sessions will be sent to this room
            socket.join(user._id);
            
            // Check if user is new / has no profile picture
            if (!user.pic_large_url) {
                
                // Get an initial profile picture
                return profilePicService.getProfilePictureUrl(accessToken, function (err, pictureURL) {
                    if (err) { return res(err); }

                    user.pic_large_url = pictureURL;
                    user.save();

                    // Fix socket handshake data, originally had no picture
                    socket.handshake.fb_user.pic_large_url = pictureURL;
                    res(null, socket.handshake.fb_user);
                });
            }
            res(null, socket.handshake.fb_user);
        });
    });

    // Client is requesting their collection of private chat sessions
    socket.on('read:ChatSessionCollection', function (data, res) {
        var socket_id = socket.handshake.fb_user._id.toString();

        // Return all chat sessions for this user
        models.ChatSession.find({ 
            'participants' : socket_id
        }, { 'messages' : 0 })
        .populate('participants', { profile_id: 0 })
        .run(function (err, sessions) {
            if (err || !sessions) { return res([]); }

            // Return sessions
            res(sessions);

            // Inform all friends that this user is now online
            var length = sessions.length;

            for (var i = 0; i < length; i++) {
                // Get partner
                var partner = sessions[i].participants[0]._id.toString() === socket_id ?
                                    sessions[i].participants[1] : sessions[i].participants[0];

                var partner_id = partner._id.toString();

                // Socket request 
                socket.broadcast.to(partner_id).emit('update:OnlineStatus', {
                    'session' : sessions[i]._id,
                    'status' : true
                }); 
            }
        });
    });

    // Client is requesting old messages for a private chat session
    socket.on('read:MessageCollection', function (data, res) {
        models.ChatSession.findOne({ $and: [
            { _id : data.session },
            { 'participants' : socket.handshake.fb_user._id }
        ]}, { 'messages' : 1 }, function (err, session) {
            if (err || !session) { return res([]); }

            res(session.messages.slice(-80)) // Limit number sent
        });
    });

    // Client is requesting a random partner
    socket.on('create:RandomChatSession', function () {
        socket_pool.push(socket); // Add socket to socket pool
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
                { 'participants' : socket.handshake.fb_user._id }
            ]}, { $push : { 'messages' : message } });
        }
    });

    // User has sent or is accepting a friend request
    socket.on('update:FriendStatus', function (data) {
        // Validate
        if (isNaN(data.state) && data.state > 3 && data.state < 0) return;

        return socket.get('RandomSession', function (err, session) {
            // Validation
            if (err || !session) return;

            // TO-DO: validate if state == 3, a haxor could compromise and 'force' a friend request

            // User has accepted the friend request
            // Create friendship
            if (data.state === 3) {
                var new_session = new models.ChatSession({
                    _id: guidGenerator.create(),
                    participants: [session.participants[0]._id, session.participants[1]._id],
                    button_state: 3 // User pair are friends
                });

                // Save new session in database
                new_session.save(function(){
                    // Get the saved session and inform both sockets
                    models.ChatSession.findOne({ _id : new_session._id })
                        .populate('participants', { profile_id: 0 })
                        .run(function(err, session){
                            if (err || !session) return;

                            socket.broadcast.to(session.partner).emit('new:PrivateChatSession', session);
                            socket.emit('new:PrivateChatSession', session);
                        });
                });
            }
            // Inform partner of change
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
                { 'participants' : socket.handshake.fb_user._id }
            ]});
        }
    });
    
    socket.on('disconnect', function () {
        // Set the user as offline
        var socket_id = socket.handshake.fb_user._id.toString();

        // TO-DO: Shouldn't have to use 'collection' for the update
        models.User.collection
            .update(
            { profile_id : socket.handshake.fb_user.profile_id },
            { $set: { online_status : false }});

        // If the socket is in a random room, end the chat session
        socket.get('RandomSession', function (err, session) {
            if (err || !session) { return; }

            socket.broadcast.to(session.partner).emit('delete:ChatSession', session);
        });

        // If the socket is waiting to be paired up, remove them
        var i;
        for (i = 0; i < socket_pool.length; i += 1) {
            if (socket_pool[i] === socket) {
                socket_pool.splice(i, 1);
                return;
            }
        }

        // Inform all friends that this socket is now offline
        models.ChatSession.find({ 
            'participants' : socket_id
        }, { 'participants' : 1 })
        .populate('participants')
        .run(function (err, sessions) {

            if (err || !sessions) { return; }

            // Inform all friends that this user is now offline
            var length = sessions.length;

            for (var i = 0; i < length; i++) {
                // Get partner
                var partner = sessions[i].participants[0]._id.toString() === socket_id ?
                                 sessions[i].participants[1] : sessions[i].participants[0];

                if (!partner.online_status) { continue; } // Continue if partner is offline

                // Emit online status
                socket.broadcast.to(partner._id.toString()).emit('update:OnlineStatus', {
                    'session' : sessions[i]._id,
                    'status' : false
                });
            }
        });

    });
});

var port = process.env.PORT || 3000;
app.listen(port);