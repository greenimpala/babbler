// Module dependencies.
var models    = require('../lib/models'),
	mongoose  = require('mongoose')

var authoriseAndGetPromise = function(fbData, promise){
	return models.User.findOne({ profile_id: fbData.id }, function(err, user){
		if(err) {
			return promise.fulfill(["Error connecting to database"]);
		}
		
		if (user) {
			console.log("Authorised existing user with name: " + user.first_name);
 			return promise.fulfill(user);
		} else {			
			var newUser = new models.User({
				profile_id: fbData.id,
				first_name: fbData.first_name,
				gender: fbData.gender
			});
			
			return newUser.save(function(err){
				if(!err){
					console.log("Authorised new user with name: " + newUser.first_name);
					return promise.fulfill(newUser);
				}
				console.log(new Error("Error with db whilst creating new user"));
				return promise.fulfill(["Error with db whilst creating new user"]);
			});
		}
	});
}

exports.authoriseAndGetPromise = authoriseAndGetPromise;