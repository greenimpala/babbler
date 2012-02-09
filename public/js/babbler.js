/*
 ____   
| ___ \     | |   | |   | |          
| |_/ / __ _| |__ | |__ | | ___ _ __ 
| ___ \/ _` | '_ \| '_ \| |/ _ \ '__|
| |_/ / (_| | |_) | |_) | |  __/ |   
\____/ \__,_|_.__/|_.__/|_|\___|_|  
_____________________________________

@title     Babbler
@author    Stephen Bradshaw
@contact   @st3redstripe (Twitter)
@version   0.03

*/

$(function () {
    window.socket;

    /**
     * Configuration
     **/
    Backbone.Model.prototype.idAttribute = "_id";

    window.Config = {
        ANIM_SPEED: 100, // Speed of jQuery animations
        has_focus: true
    };

    /** 
     * Wrapper for playing audio with jPlayer
     * Method play plays the file with the given string
     **/
    window.AudioModule = {
        elem0: $("#jplayer-pop"),
        elem1: $("#jplayer-easteregg"),
        files: [],

        initialisePopSound: function(){
            var obj = { name: "pop" };

            obj.sound = this.elem0.jPlayer({
                swfPath: "/audio",
                ready: function () {
                    $(this).jPlayer("setMedia", { mp3: "/audio/pop.mp3" });
                },
                supplied: "mp3",
                volume: 0.5,
                preload: 'auto'
            })
            
            this.files.push(obj); 
        },

        initialliseEasterEgg: function(){
            var obj = { name: "ben" };

            obj.sound = this.elem1.jPlayer({
                swfPath: "/audio",
                ready: function () {
                    $(this).jPlayer("setMedia", { mp3: "/audio/ben.mp3" });
                },
                supplied: "mp3",
                volume: 0.5,
                preload: 'auto'
            })  

            this.files.push(obj);
        },

        play: function(file) {
            var files  = this.files
              , length = files.length
              , i;
            
            for (i = 0; i < length; i += 1) {
                if (files[i].name === file) {
                    files[i].sound.jPlayer('stop').jPlayer('play');
                    return;
                }
            }
        },

        init: function(){
            this.initialisePopSound();
            this.initialliseEasterEgg();
            return this;
        }
    }.init();

    /** 
     * Models / Collections
     **/

    var UserModel = Backbone.Model.extend({
        
    });
        
    // A single chat message
    var MessageModel = Backbone.Model.extend({
        url: 'Message',

        parse: function (data) {
            if (!data) { return; }
            data.datetime = new Date(data.datetime);
            return data;
        }
    });

    var TypingStatusModel = Backbone.Model.extend({
        url: 'TypingStatus',
        defaults: {
            user_typing    : false,
            partner_typing : false
        }
    });

    var SettingsModel = Backbone.Model.extend({
        defaults: {
            chat_sounds : false
        }
    });
    
    // A collection of messages within a chatsession
    var MessageCollection = Backbone.Collection.extend({
        url: "MessageCollection",
        model: MessageModel
    });

    var ChatSessionModel = Backbone.Model.extend({
        url: 'ChatSession',

        defaults: {
            is_random: false,
            display: false,
            button_state: 0 // The friend button
        },

        initialize: function () {
            this.set({
                typing_model  : new TypingStatusModel(),
                messages      : new MessageCollection()
            });
        },

        parse: function (data) {
            // Accertain the partner from the list of participants
            var partnerAttributes = data.participants[0]._id === User.id ? data.participants[1] : data.participants[0];

            // Create the partner and add to attribute hash
            data.partner = new UserModel(partnerAttributes);

            delete data.participants; 
            return data;
        },

        // Called when a session is deleted
        // Only need the session id and partner id
        toJSON: function(){
            return {
                _id: this.id,
                is_random: this.get("is_random"),
                partner: this.get("partner").id  
            };
        }
    });

    var ChatSessionCollection = Backbone.Collection.extend({
        url: 'ChatSessionCollection',
        model: ChatSessionModel
    });

    /** 
     * Override for Backbone.sync
     * Emits a socket request to the server
     * Format: 'socket.emit(<method>:<model type>, <model.toJSON()> or <options.data>)'
     **/
    Backbone.sync = function(method, model, options) {
        var model_type = _.isFunction(model.url) ? model.url(model) : model.url; // Get model URL 

        if (!model_type) { throw new Error("Sync called without a URL"); }

        // If we are performing a CRUD operation, send the model to the server
        // Otherwise send options.data
        var data = (method === "create" || method === "update" 
                    || method === "delete") ? model.toJSON() : options.data;

        // Send request via socket
        socket.emit(method + ":" + model_type, data, function(res) {
            // Call success and return any data that the server sent
            options.success(res);
        });
    };

    /**
     * Modal dialogue that appears when a user click 'remove' for a chat session
     **/
    var RemoveSessionView = Backbone.View.extend({
        el: $('#lightbox-container'),
        lb_background: $('#lightbox'),

        events: {
            "click #lb-continue" : "continue",
            "click #lb-close"    : "close"  
        },

        display: function (session) {
            this.lb_background.show();
            this.$el.show();

            this.session = session;
        },

        continue: function () {
            this.close();
            this.session.destroy();
        },

        close: function () {
            this.$el.hide();
            this.lb_background.hide();
        }
    });

    /**
     * Resonsible for a single chat session
     * Listens for changes on an instance of ChatSessionModel
     **/
    var ChatSessionView = Backbone.View.extend({
        className: 'hidden', // Ensure session is initially hidden
        template: $('#template-chat-session').html(), // Cache main template
        message_template: $('#template-chat-message').html(), // Cache message template

        events: {
            "keypress #text" : "handleTextAreaKeypress",
            "hover #picture" : "handlePictureHover"
        },

        initialize: function() {
            _.bindAll(this, 'render', 'handleTextAreaKeypress', 'handlePictureHover');

            this.model.on("change:display", this.display, this);
            this.model.on("destroy", this.remove, this);

            this.model.get("messages").on("add", this.addMessage, this);
            this.model.get("messages").on("reset", this.reRenderMessages, this);

            this.model.get("typing_model").on('change:partner_typing', this.handlePartnerTypingChange, this);
            this.model.get("typing_model").on('change:user_typing', this.handleUserTypingChange, this);

            this.model.get("messages").fetch({ data : { session: this.model.id } });
        },

        addMessage: function(message) {
            var message_index = this.model.get("messages").indexOf(message)
              , picture = message.get("sender") === User.id ? User.get("pic_large_url") : this.model.get("partner").get("pic_large_url")
              , template_data = { // Construct template
                    'body'    : message.get("body"),
                    'picture' : picture
                };

            if (message_index === 0) {
                // This is the first message in the chat area
                // Create a new message from the template
                var template = Mustache.render(this.message_template, template_data);
                this.$('#conversation-actual').append(template);
            } else {
                // There is more than one message in the DOM
                // Get the previous message
                var previous_message = this.model.get("messages").at(message_index - 1);

                if (previous_message.get("sender") !== message.get("sender")) { 
                    // The last message in the DOM was sent from a different user
                    // Create a new message from the template
                    var template = Mustache.render(this.message_template, template_data);
                    this.$('#conversation-actual').append(template);
                } else { 
                    // The last message in the DOM is from the same user
                    // Add it to their existing template
                    this.$('#conversation-actual .messages:last')
                        .append('<div class="message-single"></div>');
                    // We have to insert the body after to prevent HTML injection
                    this.$('#conversation-actual .message-single:last')
                        .text(message.get("body"));
                }   
            }
            // Fix scroll height
            this.$('#conversation').scrollTop(99999);
        },

        display: function () {
            if (this.model.get("display")) { // Show session
                if (CurrentSession) { // If there is a current session
                    CurrentSession.set({ display : false });
                }

                this.$el.removeClass('hidden');
                CurrentSession = this.model;

                this.$('#conversation').scrollTop(99999); // Fix scroll height
                this.$el.find('#text').focus(); // Force keyboard focus to textarea
            } else { // Hide session
                this.$el.addClass('hidden');
            }
        },

        /** 
         * Called when older messages are loaded from the server
         * Need to clear messages from the DOM, resort collection and add all
         **/
        reRenderMessages: function (messages) {
            var self = this;

            // Remove
            self.$('#conversation-actual .message-group').remove();

            // TODO: Resort

            // Add
            messages.each(function (message) {
                self.addMessage(message);
            });
        },

        handleTextAreaKeypress: function(e) {
            var text = e.target.value
              , self = this;

             if (e.keyCode === 13) { // Enter pressed, send if valid
                e.preventDefault();

                if (text.length < 1 || text.length > 600) { return; } // Validate length

                // Create and send the new message
                this.model.get("messages").create({
                    'sender'    : User.id,
                    'partner'   : this.model.get("partner").id,
                    'session'   : this.model.id,
                    'is_random' : this.model.get("is_random"),
                    'body'      : text,
                    'datetime'  : new Date()
                });

                // Ensure user is no longer set as 'typing'
                this.model.get("typing_model").set({ user_typing: false });

                e.target.value = ""; // Reset text-area
            } else { // User typing

                // Set a timeout to change user_typing = false 
                // Called if user stops typing for 5 seconds
                clearTimeout(this.typing_timeout);
                this.typing_timeout = setTimeout(function () {
                    self.model.get("typing_model").set({ user_typing: false });
                }, 5000);

                self.model.get("typing_model").set({ user_typing: true });
            }
        },

        /**
         * Update the DOM to show whether partner is typing
         **/
        handlePartnerTypingChange: function (model) {
            var is_typing = model.get('partner_typing');

            if (is_typing) {
                $(this.partner_typing_el).show();
            } else {
                $(this.partner_typing_el).hide();
            }
        },

        /** 
         * Updates the server on whether the user is typing
         **/
        handleUserTypingChange: function (model) {
            model.save({
                session: this.model.id,
                partner: this.model.get("partner").id
            });
        },

        handlePictureHover: function () {
            this.$el.find('#picture').toggleClass('expand');  
        },

        remove: function () {
            clearTimeout(this.typing_timeout); // Clear typing timeout
            $(this.el).remove();

            if (this.model === CurrentSession) {
                CurrentSession = null;
            }
        },

        /** 
         * Method called once to create a new chat session
         **/
        renderOnce: function() {
            var template = Mustache.render(this.template, this.model.get("partner").toJSON()); // Template result

            this.$el.html(template); // Update el

            // Create and add friend button
            var button_view = new FriendButtonView({ model: this.model });
            this.$el.find('#partner-identity').append(button_view.render().el);

            this.partner_typing_el = this.$('#is-typing'); // Cache el for partner typing

            return this;
        }
    });

    /**
     * Responsible for the 'Friend Request' button
     **/
    var FriendButtonView = Backbone.View.extend({
        // @ChatSessionModel.button_state
        // 0 - Default
        // 1 - User has sent a request
        // 2 - Partner has sent a request
        // 3 - Pair are friends
        tagName: "div",

        className: "button green",

        events: {
            "click" : "handleButtonClick"
        },

        initialize: function () {
            _.bindAll(this, "handleButtonClick");

            this.model.on("change:button_state", this.render, this)
        },

        handleButtonClick: function () {
            switch (this.model.get("button_state")) {
                case 0 :
                    // Send friend request
                    socket.emit("update:FriendStatus", {
                        session : this.model.id,
                        state: 2
                    });
                    this.model.set({ button_state: 1 });
                    break;
                case 2 :
                    // Accept friend request
                    socket.emit("update:FriendStatus", {
                        session : this.model.id,
                        state: 3
                    });
                    this.model.set({ button_state: 3 });
                    break;
            };
        },

        render: function () {
            var message;

            switch (this.model.get("button_state")) {
                case 0 :
                    message = "Friend Request";
                    break;
                case 1 :
                    message = "Request Sent";
                    break;
                case 2 :
                    message = "Accept Request";
                    break;
                case 3 :
                    message = "Friends";
                    break;
            };
            this.$el.text(message);

            return this;
        }
    });

    /**
     * Responsible for a chat session in the friends dropdown
     **/
    var FriendsListItemView = Backbone.View.extend({
        tagName: 'li',

        template: $('#template-friends-list').html(),

        events: {
            "click" : "display",
            "click p.remove" : "deleteSession"
        },

        initialize: function () {
            _.bindAll(this, 'deleteSession');

            this.model.get("messages").on("add", this.render, this);
            this.model.get("messages").on("reset", this.handleReset, this)
            this.model.get("typing_model").on('change:partner_typing', this.handlePartnerTypingChange, this);
            this.model.on("destroy", this.remove, this);
        },

        display: function () {
            this.model.set({ "display" : true });
        },

        render: function (message) {
            if (message) {
                var ending = message.get("body").length > 25 ? "..." : ""
                  , body = message.get("body").substring(0, 25) + ending
                  , date = message.get("datetime").toTimeString().substring(0, 5);
            };

            var template_data = {
                'picture'    : this.model.get("partner").get("pic_large_url"),
                'first_name' : this.model.get("partner").get("first_name"),
                'body'       : body || "",
                'date'       : date || ""
            };

            var template = Mustache.render(this.template, template_data);
            $(this.el).html(template);

            return this;
        },

        handlePartnerTypingChange: function (model) {
            var is_typing = model.get('partner_typing');

            if (is_typing) {
                this.$el.find('.typing').show();
            } else {
                this.$el.find('.typing').hide();
            }
        },

        handleReset: function () {
            var message = this.model.get("messages").last();
            if (message) {
                this.render(message);
            }
        },

        remove: function () {
            $(this.el).remove();
        },

        deleteSession: function (e) {
            e.stopPropagation();

            // If random session, destroy immediately
            if (this.model.get("is_random")) {
                this.model.destroy();
            } else { // User is removing a friend, dispay a model confirm box
                RemoveSessionModal.display(this.model);
            }
        }
    });

    /**
     * Friends dropdown box
     **/
    var FriendsListView = Backbone.View.extend({
        el: $('#header'),

        current_session: null,

        events: {
            "click #friends" : "handleIconClick"
        },

        initialize: function () {
            _.bindAll(this, 'addOne', 'addRandom', 'handleIconClick', 
                'restoreRandomMessage', 'restorePrivateMessage');

            ChatSessions.on('add', this.addOne);
            RandomSessions.on('add', this.addRandom);
            RandomSessions.on('remove', this.restoreRandomMessage);
            ChatSessions.on('remove', this.restorePrivateMessage);
        },

        addOne: function (session) {
            this.$('#friends-dropper .empty-message:eq(1)').hide();
            var view = new FriendsListItemView({ model: session });
            this.$('#friends-dropper ul:eq(1)').append(view.render().el);
        },

        addRandom: function (session) {
            var view = new FriendsListItemView({ model: session });
            this.$('#friends-dropper .empty-message:eq(0)').hide();
            this.$('#friends-dropper ul:eq(0)').append(view.render().el);
        },

        handleIconClick: function () {
            this.$('#friends-dropper').toggleClass("hidden");
            this.$('#friends').toggleClass("pressed");
        },

        restoreRandomMessage: function () {
            this.$('#friends-dropper .empty-message:eq(0)').show();
        },

        restorePrivateMessage: function () {
            if (ChatSessions.length === 0) {
                this.$('#friends-dropper .empty-message:eq(1)').show();
            }
        }
    });


    /** 
     * Monitors blur/focus events on the window
     * Changes the pages title attribute
     **/
    var TitleView = Backbone.View.extend({
        el: $(window),

        title: $('title'),

        default_title: "Babbler - Chat to random people on Facebook!",

        events: {
            "blur" : "handleBlur",
            "focus": "handleFocus",
            "resize" : "handleResize"
        },

        initialize: function () {
            _.bindAll(this, 'handleFocus', 'handleBlur', 'newMessagesFlash')
        },

        handleFocus: function () {
            window.Config.has_focus = true;
            $(this.title).html(this.default_title);
        },

        handleBlur: function () {
            window.Config.has_focus = false;
        },

        newMessagesFlash: function () {
            $(this.title).html("New message!");
        },

        handleResize: function () {
            
        }
    });

    /** 
     * Responsible for overall application behaviour
     * Listens for and handles server socket requests
     **/
    var AppView = Backbone.View.extend({
        el: $('body'),
        is_searching: false,

        events: {
            "click #btn-new-partner" : "requestNewPartner"
        },

        initialize: function () {
            _.bindAll(this, 'createChatSession', 'requestNewPartner', 'endChat');
            var self = this;

            /* Global views/models */
            window.ChatSessions = new ChatSessionCollection();
            window.RandomSessions = new ChatSessionCollection();
            window.FriendsList = new FriendsListView();
            window.RemoveSessionModal = new RemoveSessionView();
            window.TitleHandler = new TitleView();
            window.CurrentSession = null; // Holds the currently displayed session

            /* Bindings */
            ChatSessions.on('add', this.createChatSession);
            RandomSessions.on('add', this.createChatSession);

            /* Socket IO */

            socket.on('new:Message', function (message) {
                var chat_session = ChatSessions.get(message.session) 
                                    || RandomSessions.get(message.session);;

                // If sessions exists, add the message
                if (chat_session) {
                    message.datetime = new Date(message.datetime); // Create object
                    chat_session.get("messages").add(message);
                    chat_session.get("typing_model").set({ partner_typing : false });

                    // If window is not in focus, change the <title> to inform user
                    if (!window.Config.has_focus) {
                        TitleHandler.newMessagesFlash();
                    }
                }
            });

            socket.on('new:PrivateChatSession', function (data) {
                var partnerAttributes = data.participants[0]._id === 
                    User.id ? data.participants[1] : data.participants[0];

                // Create the partner and add to attribute hash
                data.partner = new UserModel(partnerAttributes);

                delete data.participants; 

                ChatSessions.add(new ChatSessionModel(data));

            });

            socket.on('new:TypingStatus', function (typing) {
                var chat_session = ChatSessions.get(typing.session) 
                                    || RandomSessions.get(typing.session);

                // If sessions exists, set typing status
                if (chat_session) {
                    chat_session.get("typing_model")
                        .set({ partner_typing: typing.user_typing });
                }
            });

            socket.on('update:FriendStatus', function (data) {
               var chat_session = RandomSessions.get(data.session);
               
               if (chat_session) {
                   chat_session.set({ button_state : data.state });
               } 
            });

            socket.on('delete:ChatSession', function (session) {
                var chat_session = ChatSessions.get(session._id) 
                                    || RandomSessions.get(session._id);

                if (chat_session) {
                    chat_session.destroy();
                }
            });

            socket.on('new:RandomPartner', function (session) {
                if (RandomSessions.length > 0) { return; } // There is already a random session in place

                self.is_searching = false;
                $('#btn-new-partner').html("New Partner");

                // Accertain the partner from the list of participants
                var partnerAttributes = session.participants[0]._id === 
                    User.id ? session.participants[1] : session.participants[0];

                // Create the partner and add to attribute hash
                session.partner = new UserModel(partnerAttributes);
                delete session.participants; 
                random_session = new ChatSessionModel(session);

                RandomSessions.add(random_session);
                random_session.set({ display: true }); // Force display this session
            });

            socket.on('update:UsersOnline', function (users) {
                if (isNaN(users)) { return; }

                $('#users-online strong').html(users);
            });

            /* Initialization */

            this.$('#mini-profile-pic').html('<img src="' + User.get("pic_large_url") + '" style="height: 28px; width: 28px" />');
            this.$('#message-update').fadeOut(Config.ANIM_SPEED);

            ChatSessions.fetch({ add: true }); // Grab all the users private chat sessions / friends list
        },

        createChatSession: function(session) {
            var view = new ChatSessionView({ model: session }); // Create view from session
            this.$('#chat-sessions-container').append(view.renderOnce().el); // Render and add element to DOM
        },

        requestNewPartner: function () {
            if (this.is_searching) { return; } // Disallow multiple searches

            this.is_searching = true;

            // End any random session that may exist
            if (CurrentSession && CurrentSession.get("is_random")) {
                CurrentSession.destroy();
            }

            socket.emit('create:RandomChatSession');

            this.$('#btn-new-partner').html("Searching...");
        },

        endChat: function () {
            // Find the random chat session
            var session = ChatSessions.find(function(session) {
                return session.get("is_random") === true;
            });

            session.destroy();
        }
    });

    // Start a socket connection with server
    socket = io.connect('/');

    socket.on('connect', function () {
        // The socket connected succesfully

        // If the app has already launched, don't reload
        // Occurs when the socket connection drops and re-connects
        if (window.App) {
            console.log("Reconnected to server.");
            socket.emit('init', function () {
                ChatSessions.fetch({ add: true });
            }); // Re-initialise server
            return;
        }

        // Request initialization
        socket.emit('init', null, function (err, user) {
            if (err) { // Profile picture could not be downloaded
                alert("Profile picture could not be downloaded. Do you have one? Refresh page to try again.");
                return;
            }

            window.User = new UserModel(user);
            window.App = new AppView(); // Begin
        });
    });

});