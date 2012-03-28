// Module dependencies.
var models    		= require('../lib/models'),
	locale_helper   = require('../lib/locale-helper'),
	mongoose  		= require('mongoose');

var authoriseAndGetPromise = function(fbData, promise){
	return models.User.findOne({ profile_id: fbData.id }, function(err, user){
		if(err) {
			return promise.fulfill(["Error connecting to database"]);
		}
		
		if (user) {
			// User exists, return it
 			return promise.fulfill(user);
		} else {
			// User does not exist, authorize new user	
			if (!fbData.verified) {
				return promise.fulfill("You're Facebook account is not verified.")
			}
					
			var new_user = new models.User({
				profile_id: fbData.id,
				first_name: fbData.first_name,
				gender: fbData.gender,
				locale: fbData.locale,
				location: locale_helper.localeToCountry(fbData.locale)
			});
			
			return new_user.save(function(err){
				if(!err){
					console.log("Authorised new user with name: " + new_user.first_name);
					return promise.fulfill(new_user);
				}
				console.log(new Error("Error with db whilst creating new user"));
				return promise.fulfill(["Error with db whilst creating new user"]);
			});
		}
	});
}

exports.authoriseAndGetPromise = authoriseAndGetPromise;