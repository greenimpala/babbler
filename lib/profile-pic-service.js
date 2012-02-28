// Module dependencies.
var models        = require('../lib/models'),
	https         = require('https'),
	sensitive     = require('../lib/sensitive');

var getProfilePictureUrl = function(accessToken, userId, callback) {
	getBigProfilePictureImagePath(accessToken, function (err, imagePath) {
			callback(err, imagePath);
	});
};

var getBigProfilePictureImagePath = function (accessToken, callback) {
	// Get profile pictures album path
	https.get({
		host: 'graph.facebook.com',
		path: '/me/albums?access_token=' + accessToken
	}, function (res) {
		var data = '';
		res.setEncoding('utf8');
		
		res.on('data', function (chunk) {
			data += chunk;
		});
		
		res.on('end', function (err) {
			if (err || data == undefined) { return callback(err); }

			var albums  = (JSON.parse(data)).data,
				albumId = null,
				i       = 0;
			
			// We have all albums, search for profile picture album
			for (i = 0; i < albums.length; i += 1) {
				if (albums[i].name === 'Profile Pictures') {
					albumId = albums[i].id;
					break;
				}
			}
			if (!albumId) { return callback(new Error('No profile pictures album?')) };
			
			// We have the profile picture album id, 
			// Get current profile picture url
			https.get({
				host: 'graph.facebook.com',
				path: '/' + albumId + '/photos?access_token=' + accessToken
			}, function (res) {
				var data = '';
				res.setEncoding('utf8');

				res.on('data', function (chunk) {
					data += chunk;
				});

				res.on('end', function (err) {
					if (err) { return callback(err); }
					
					var profilePictures = (JSON.parse(data)).data;

					if (!profilePictures || !profilePictures[0]) { 
						return callback(new Error('No profile picture.')); 
					}
					
					callback(null, profilePictures[0].source);
				});
			});
		});
	}).on('error', function (err) {
		return callback(err);
	});
};

exports.getProfilePictureUrl = getProfilePictureUrl;