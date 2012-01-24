/*global jQuery, $, io, window, console */

$(function () {
	window.Babbler = (function () {
		var	appStatus			= 'idle',
			currentUser			= null,
			convoStatus			= 'empty',
			userTyping			= false,
			typingTimeout		= null,
			animSpeed			= 'fast',
			socket				= io.connect('/'),
			btnNewPartner		= $('#btn-new-partner'),
			btnEndChat			= $('#btn-end-chat'),
			initialMessage		= $('#message-initial'),
			searchMessage		= $('#message-searching'),
			nooneFoundMessage	= $('#message-noone-found'),
			updateMessage		= $('#message-update'),
			initErrorMessage	= $('#message-init-fail'),
			partnerIdentity		= $('#partner-identity'),
			textArea			= $('#text'),
			chatWrapper			= $('#chat-area-wrapper'),
			conversation		= $('#conversation-actual'),
			convoScroller		= $('#conversation'),
			miniProfilePic		= $('#mini-profile-pic'),
			partnerTyping		= $('#is-typing'),
			settingsDropdown    = $('.nav-dropdown'),
			settingsButton      = $('#settings'),
			usersOnline         = $('#users-online'),
			miniProfilePicSrc	= '';

		var Audio = {

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
			
		var addMessageToChatArea = function (text, person, image) {
			var newGroupText = '<div class="message-group"><img src="' + image + '" alt=""><div class="messages"><div class="message-single"></div></div></div>';
			
			// Add elements
			if (convoStatus === 'empty') {
				conversation.append(newGroupText);
				if (person === 'partner') { Audio.play('pop'); }
			} else if (convoStatus === 'user' && person === 'user') {
				conversation.find('.messages').last().append('<div class="message-single"></div>');
			} else if (convoStatus === 'partner' && person === 'user') {
				conversation.append('<div class="message-spacer"></div>');
				conversation.append(newGroupText);
				Audio.play('pop');
			} else if (convoStatus === 'user' && person === 'partner') {
				conversation.append('<div class="message-spacer"></div>');
				conversation.append(newGroupText);
			} else if (convoStatus === 'partner' && person === 'partner') {
				conversation.find('.messages').last().append('<div class="message-single"></div>');
			}

			// Add the message text
			conversation.find(".message-single:last").text(text);
			
			convoStatus = person;
			convoScroller.scrollTop(99999);
		};

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
			
			partnerTyping.hide();
			partnerIdentity.hide(animSpeed);
			btnEndChat.hide();
			
			socket.emit('endChat');
		});
		
		textArea.keypress(function (e) {
			if (appStatus !== 'chatting') { 
				e.preventDefault();
				return;
			}
			clearTimeout(typingTimeout);
					
            if (e.keyCode === 13) { // Enter pressed		
				var textValue = $.trim(textArea.val());
				
                e.preventDefault();
                if (textValue.length < 1 || textValue.length > 1000) { return; }
				
				socket.emit('sendMessage', { body: textValue });				
				userTyping = false;
                addMessageToChatArea(textValue, 'user', miniProfilePicSrc);
				textArea.focus();
                textArea.val("");
                
                // Easter egg
                if (textValue === '#feelyourunning') { Audio.play('ben'); }
            } else {
				typingTimeout = setTimeout(function () {
	                socket.emit('sendTypingUpdate', false);
					userTyping = false;
	            }, 5000);

				if (!userTyping) {
					userTyping = true;
					socket.emit('sendTypingUpdate', true);
				}
			}
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
			partnerTyping.find('span').html(currentUser.first_name + ' is typing...');
			
			btnNewPartner.show();
			btnEndChat.show();
			searchMessage.hide(animSpeed);
			partnerIdentity.fadeIn(animSpeed, function () {
				chatWrapper.fadeIn(animSpeed);
			});
		});
		
		socket.on('newMessage', function (data) {
			if (appStatus !== 'chatting') { return; }
			
			partnerTyping.hide();
			var message = data.body;
			addMessageToChatArea(message, 'partner', currentUser.pic_large_url);
		});
		
		socket.on('partnerTyping', function (isTyping) {
			if (isTyping) {
				partnerTyping.show();
			} else {
				partnerTyping.hide();
			}
		});
		
		socket.on('partnerDisconnect', function () {
			if (appStatus !== 'chatting') { return; }
			
			appStatus = 'idle';
			convoStatus = 'empty';

			partnerTyping.hide();
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

		socket.emit('init'); // Start the connection
	}());
});