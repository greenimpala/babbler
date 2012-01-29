/*global jQuery, $, io, window, console */

$(function () {
    var socket;

    var UserModel = Backbone.Model.extend({
        profile_id: '',
        first_name: '',
        gender: '',
        pic_large: '',
        pic_large_url: '',
    });
        
    // A single chat message
    var MessageModel = Backbone.Model.extend({
        defaults: {
            datetime: new Date()
        }
    });

    var TypingStatusModel = Backbone.Model.extend({
        defaults: {
            user_typing: false,
            partner_typing: false
        }
    });

    // A collection of messages within a chatsession
    var MessageCollection = Backbone.Collection.extend({
        model: MessageModel,
    });

    var ChatSessionCollection = Backbone.Collection.extend({
        model: ChatSessionModel,
    });

    var FriendsListCollection = Backbone.Collection.extend({
        model: UserModel
    });

    var ChatSessionModel = Backbone.Model.extend({
        partner: null,
        messages: new MessageCollection(),
        typing_model: new TypingStatusModel()
    });

    // Resonsible for a single chat session
    // Model: ChatSessionModel
    var ChatSessionView = Backbone.View.extend({
        //className: 'hidden', // Ensure session is initially hidden
        template: $('#template-chat-session').html(), // Cache template

        events: {
            "keypress #text": "sendMessageOnEnter"
        },

        initialize: function() {
            _.bindAll(this, 'addMessage', 'render', 'sendMessageOnEnter', 'sendIsTyping', 'updateTypingStatus');

            this.model.messages.bind('add', this.addMessage);
            this.model.typing_model.bind('change:partner_typing', this.updateTypingStatus);
            this.model.typing_model.bind('change:user_typing', this.sendIsTyping);
        },

        addMessage: function(message) {
            // TODO: insert element then use .text() to prevent html
            this.$('#conversation-actual').append(message.get("body"));
            this.$('#conversation').scrollTop(9999);
        },

        sendMessageOnEnter: function(e) {
            var text = e.target.value;

            if (e.shiftKey) { // User wants a new line
                return;
            } else if (e.keyCode === 13) { // Enter pressed
                e.preventDefault();
                if (text.length < 1) { return; }

                // Create the new message
                var message = new MessageModel({
                    body: text,
                    socketio_room: this.model.get("socketio_room")
                });

                this.model.messages.add(message); // Add to local messages
                socket.emit('send-message', message.toJSON()); // Send to server

                this.model.typing_model.set({ user_typing: false }, { silent: true });
                this.$('#conversation').scrollTop(99999);
                e.target.value = "";
            } else { // User typing
                var self = this;

                // Set a timeout to change user_typing = false 
                // Called if user stops typing for 5 seconds
                clearTimeout(this.typing_timeout);
                this.typing_timeout = setTimeout(function () {
                    self.model.typing_model.set({ user_typing: false });
                }, 5000);

                this.model.typing_model.set({ user_typing: true });
            }
        },

        // Update the DOM to show whether partner is typing
        updateTypingStatus: function () {
            var is_typing = this.model.typing_model.get('partner_typing');

            if (is_typing) {
                $(this.partner_typing_el).show();
            } else {
                $(this.partner_typing_el).hide();
            } 
        },

        // Updates the server on whether the user is typing
        sendIsTyping: function () {
            var is_typing = this.model.typing_model.get('user_typing');

            if (is_typing) {
                console.log("User is typing..");
                socket.emit('typing-update', is_typing);
            } else {
                console.log("User stopped typing..")
                socket.emit('typing-update', is_typing);
            }
        },

        // Method called once to create a new chat session
        render: function() {
            var element = Mustache.render(this.template, this.model.partner.toJSON()); // Template result
            $(this.el).html(element); // Update el

            // Cache element for partner typing
            this.partner_typing_el = this.$('#is-typing');

            return this;
        }
    });

    var RandomChatSessionModel = ChatSessionModel.extend({});

    // Responsible for overall application behaviour
    // Listens for and handles server socket requests
    var AppView = Backbone.View.extend({
        el: $('body'),

        user: null, // This user
        settings: null, // Users settings

        random_chat_session: null, // Instance of a ChatSessionCollection
        private_chat_sessions: new ChatSessionCollection(), // Instance of a ChatSessionModel
        friends_list: new FriendsListCollection(), // Users friends list

        initialize: function() {
            _.bindAll(this, 'createChatSession');
            var self = this;

            // Bindings
            this.private_chat_sessions.bind('add', this.createChatSession);

            // Socket IO
            socket.on('new-message', function (data) {
                // delegate
            });

            socket.on('partner-typing', function (data) {
                
            });   
            
                    






            // TEST
            var chatsession = new ChatSessionModel({ 
                socketio_room: 123
            });
            chatsession.partner = new UserModel({ first_name: "Douglas" });
            this.private_chat_sessions.add(chatsession)
            chatsession.messages.add(new MessageModel({ body: "hey" }));
            chatsession.typing_model.set({ partner_typing: true });
        },

        createChatSession: function(session) {
            var view = new ChatSessionView({ model: session }); // Create model

            this.$('#chat-sessions-container').append(view.render().el); // Render and add element to DOM
        }
    });


    socket = io.connect('/'); // Initialise server connection

    socket.on('connect', function () {
        // The socket connected succesfully, request initialization
        socket.emit('init'); 

        socket.on('init-success', function(environment) {
            // Socket initialized succesfully

            // environment - data for setting up the initial environment:
            // environment.user       - this user
            // environment.settings   - users settings
            // environment.sessions   - private sessions that have unread messages
            // environment.notifs     - number of notifications

            var App = new AppView(environment); // Start the app
        });
    });

    /** END BACKBONE RE-WRITE **/
/*

    var ChatSessionView = function () {
        var self         = this,
            current_user = null;

        this.requestPartner = function () {
            if (this.app_status === 'searching') { return; }
            this.app_status = 'searching';
            console.log("Requesting new partner");
            
            btnNewPartner.hide();
            btnEndChat.hide();
            chatWrapper.hide(animSpeed);
            partnerIdentity.hide(animSpeed);
            nooneFoundMessage.hide(animSpeed);
            initialMessage.hide(animSpeed);
            searchMessage.fadeIn(animSpeed);
            
            if (current_user) { socket.emit('endChat'); }
            socket.emit('requestPartner');
        };
    };

    var AudioModule = {
        _elem0: $("#jplayer-pop"),
        _elem1: $("#jplayer-easteregg"),
        _files: [],

        _initialisePopSound: function(){
            var _obj = { name: "pop" };

            _obj.sound = this._elem0.jPlayer({
                swfPath: "/audio",
                ready: function () {
                    $(this).jPlayer("setMedia", { mp3: "/audio/pop.mp3" });
                },
                supplied: "mp3",
                volume: 0.5,
                preload: 'auto'
            })
            
            this._files.push(_obj); 
        },

        _initialliseEasterEgg: function(){
            var _obj = { name: "ben" };

            _obj.sound = this._elem1.jPlayer({
                swfPath: "/audio",
                ready: function () {
                    $(this).jPlayer("setMedia", { mp3: "/audio/ben.mp3" });
                },
                supplied: "mp3",
                volume: 0.5,
                preload: 'auto'
            })  

            this._files.push(_obj);
        },

        play: function(file) {
            var files = this._files;
            
            for (var i = 0; i < files.length; i += 1) {
                if (files[i].name === file) {
                    files[i].sound.jPlayer('stop').jPlayer('play');
                    return;
                }
            }
        },

        init: function(){
            this._initialisePopSound();
            this._initialliseEasterEgg();
            return this;
        }
    }.init();

    settingsButton.click(function () {
        $(this).toggleClass('pressed');
        settingsDropdown.toggle();
    });

    btnNewPartner.click(function () {
        if (appStatus === 'searching') { return; }
        appStatus = 'searching';
        
        btnNewPartner.hide();
        btnEndChat.hide();
        chatWrapper.hide(animSpeed);
        partnerIdentity.hide(animSpeed);
        nooneFoundMessage.hide(animSpeed);
        initialMessage.hide(animSpeed);
        searchMessage.fadeIn(animSpeed);
        
        if (currentUser) { socket.emit('endChat'); }
        socket.emit('requestPartner');
    });

    btnEndChat.click(function () {
        if (appStatus !== 'chatting') { return; }
        appStatus = 'idle';
        

        partnerIdentity.hide(animSpeed);
        btnEndChat.hide();
        
        socket.emit('endChat');
    });

    socket.on('noPartnerFound', function () {
        appStatus = 'idle';
        
        searchMessage.hide(animSpeed);
        nooneFoundMessage.show(animSpeed);
        btnNewPartner.hide();
    });

    socket.on('connectedToPartner', function (data) {
        if (appStatus !== 'searching') { return; }

        appStatus = 'chatting';
        convoStatus = 'empty';
        
        conversation.empty();
        textArea.val('');
        userTyping = false;
        
        currentUser = data.user;
        
        partnerIdentity.find('#img-container').html('<img src="' + currentUser.pic_large_url + '" alt="" id="picture" />');
        partnerIdentity.find('#partner-name').html("You're chatting to " + currentUser.first_name);
        
        btnNewPartner.show();
        btnEndChat.show();
        searchMessage.hide(animSpeed);
        partnerIdentity.fadeIn(animSpeed, function () {
            chatWrapper.fadeIn(animSpeed);
        });
    });

    socket.on('partnerDisconnect', function () {
        if (appStatus !== 'chatting') { return; }
        
        appStatus = 'idle';
        convoStatus = 'empty';

        conversation.append('<div class="message-single info">Partner has disconected</div>');
        convoScroller.scrollTop(99999);
        btnEndChat.hide();
        partnerIdentity.hide(animSpeed);
    });

    socket.on('initFailed', function () {
        updateMessage.hide(animSpeed, function () {
            initErrorMessage.fadeIn(animSpeed);
        });
    });

    socket.on('initSuccess', function (picture) {
        miniProfilePicSrc = picture;
        miniProfilePic.html('<img width="28px" height="28px" src="' + picture + '" alt="" />');
        btnNewPartner.show();
        
        updateMessage.hide(animSpeed);
        initialMessage.fadeIn(animSpeed);
    });

    socket.on('usersOnline', function (users) {
        if (!isNaN(users)) { // If valid number
            usersOnline.find("strong").text(users);
        }
    });

    socket.socket.on('error', function (reason) {
        console.log("Error handshaking." + reason);
    });

    socket.emit('init'); // Start init tasks
    */
});