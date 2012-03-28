// Module dependencies.
var models        = require('../lib/models'),
	https         = require('https'),
	sensitive     = require('../lib/sensitive'),
	Buffers 	  = require('../lib/buffer-helper');
	guid     	  = require('../lib/guid-generator');
	knox		  = require('knox');

var s3_client = knox.createClient({
	key: sensitive.s3.key,
	secret: sensitive.s3.secret,
	bucket: sensitive.s3.bucket,
	endpoint: 'babbler-chat.s3-external-3.amazonaws.com'
});

var getProfilePictureUrl = function(accessToken, callback) {
	getBigProfilePictureImagePath(accessToken, function (err, imagePath) {
		if (err) { callback(err); }

		uploadToS3(imagePath, function(err, finalPath) {
			callback(err, finalPath);
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
			if (!albumId) { return callback(new Error('No profile pictures album.')) };
			
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

var uploadToS3 = function (imagePath, callback) {
	var image_path = imagePath.split('.net')[1];
	var image_host = imagePath.split('/')[2];

	https.get({
		host: image_host,
		path: image_path
	}, function (res) {
		var data = new Buffers();

		res.on('data', function (chunk) {
			data.push(chunk);
		});

		res.on('end', function (err) {
			if (err) { return callback(err); }

			// Do actual upload and return S3 image path
			doUpload(data.toBuffer(), function (err, finalPath) {
				return callback(err, finalPath)
			});
		});
	});
};

var doUpload = function (buffer, callback) {
	var name = guid.create(true);

	var req = s3_client.put('/img/' + name + '.jpg', {
		'Content-Length': buffer.length,
		'Content-Type' : 'image/jpeg'
	});
	req.on('response', function (res) {
		if (200 === res.statusCode) {
			return callback(null, req.url);
		}
		// Else error uploading to S3
		return(new Error("Could not upload to S3."));
	});
	req.end(buffer);
}

exports.getProfilePictureUrl = getProfilePictureUrl;