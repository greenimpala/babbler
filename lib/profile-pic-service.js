// Module dependencies.
var models        = require('../lib/models'),
	https         = require('https'),
	http          = require('http'),
	fs            = require('fs'),
	guidGenerator = require('../lib/guid-generator'),
	Buffers       = require('../lib/buffer-helper'),
	knox          = require('../lib/knox-custom');
	sensitive     = require('../lib/sensitive');

var s3Client = knox.createClient({
    key:    sensitive.s3.key,
    secret: sensitive.s3.secret,
    bucket: sensitive.s3.bucket
});

var updateProfilePictures = function(accessToken, userId, callback) {

	getBigProfilePictureImagePath(accessToken, function (err, imagePath) {
		if (err) { return callback(err); }
		
		getProfilePicAndUploadToS3(imagePath, userId, function (err, pictureURL) {
			callback(err, pictureURL);
		});
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

var getProfilePicAndUploadToS3 = function (fullURL, userId, callback) {
	var regexResult = fullURL.match("https?:\/\/(.*?.net|.com)(.*)"),
		imgHost     = regexResult[1],
		imgPath     = regexResult[2];
	
	// Download picture from URL
	http.get({
		host: imgHost,
		path: imgPath
	}, function (res) {
	    var imageBuffer = new Buffers();

	    res.on('data', function (chunk) {
	        imageBuffer.push(chunk);
	    });

		res.on('end', function (err) {
			if (err) { return callback(err); }
			
			// Find this user in database
			return models.User.findOne({ profile_id: userId }, function (err, user) {
				if (err) { return callback(err); }
				
				// Generate image title
				var imageTitle = user.pic_large || guidGenerator.create(true) + '_big.jpg';

				// Upload image to S3
				return s3Client.putBuffer(imageBuffer.toBuffer(), '/profile_pictures/' + imageTitle, function (err) {
					if (err) { return callback(err); }
					
					// Update user model
					user.pic_large = imageTitle;
					user.pic_large_url = 'http://s3-eu-west-1.amazonaws.com/babbler-chat/profile_pictures/' + imageTitle;
					
					user.save(function (err) {
						if (!err) {
							console.log("Updated profile picture for user " + user.profile_id);
						}
						callback(err, user.pic_large_url);
					});
				});
			});
		});
	}).on('error', function (err) {
		return callback(err);
	});
};

exports.updateProfilePictures = updateProfilePictures;