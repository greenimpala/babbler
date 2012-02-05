// Module dependencies.
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
                online: io.sockets.clients().length + 1 // +1 to account for this user
            });
        });
    }
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
    io.set("polling duration", 20); 
    io.set("browser client minification", true);
    io.set("close timeout", 8);
    io.set('log level', 1);
});

// Emit to all sockets the number of connected sockets
var usersOnline = setInterval(function () {
    io.sockets.emit('update:UsersOnline', io.sockets.clients().length);
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
            if (!user.pic_large) {
                return profilePicService.updateProfilePictures(accessToken, userId, function (err, pictureURL) {
                    if (err) { return res(err); }

                    socket.handshake.fb_user.pic_large_url = pictureURL; // Fix socket: originally had no picture.
                    res(null, socket.handshake.fb_user);
                });
            }
            res(null, socket.handshake.fb_user);
        });
    });

    // Client is requesting their collection of private chat sessions
    socket.on('read:ChatSessionCollection', function (data, res) {
        // Test response
        res([]);
    });

    // Client is requesting a random partner
    socket.on('create:RandomChatSession', function () {
        socketPool.push(socket); // Add socket to socket pool
    });
    
    socket.on('create:Message', function (message, res) {
        socket.broadcast.to(message.partner).emit('new:Message', message);
        res();
    });
    
    socket.on('create:TypingStatus', function (typing, res) {
        socket.broadcast.to(typing.partner).emit('new:TypingStatus', typing);
        res();
    });

    socket.on('delete:ChatSession', function (session, res) {
        socket.broadcast.to(session.partner).emit('delete:ChatSession', session);
        res();
    });
    
    socket.on('disconnect', function () {
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