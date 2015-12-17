var config = require("./email-myself-config.json");

var token = config.botToken,
	connectionString = config.connectionString,
	fromAddress = config.fromAddress;

var Bot = require("node-telegram-bot-api"),
    bot = new Bot(token, { polling: true }),
    Massive = require("massive"),
    db = Massive.connectSync({ connectionString: connectionString }),
    SimpleBot = require('simple-telegram-bot'),
    simpleBot = new SimpleBot(bot, db.users),
    _ = require("lodash"),
    nodemailer = require('nodemailer'),
    ses = require('nodemailer-ses-transport'),
    transporter = nodemailer.createTransport(ses({
	    accessKeyId: config.awsAccessKeyId,
	    secretAccessKey: config.awsAccessKeySecret
	}));

simpleBot.on("chatstarted", function(chat){

	function promptForEmail(){
		return chat.prompt("What is your email address?")
			.then(function(email){
				if (email.indexOf("@") > -1) {
					chat.setting("email", email);
				} else {
					return promptForEmail();
				}
			});
	}

	if (!chat.settings.email){
		promptForEmail();
	} else {
		chat.send("Your message will be sent to " + chat.settings.email + " after you stop sending for 1 minute");
	}

	chat.on("command:setEmail", function(message){
		return message.prompt("What is your email address?")
			.then(function (email) {
				if (email.indexOf("@") > -1) {
					chat.setting("email", email);
				} else {
					return promptForEmail();
				}
			});
	})

	var buffer = [];
	chat.on("text", function(message){
		buffer.push(message.text);
		sendEmail();
	});

	var sendEmail = _.debounce(function sendEmail(){
		var message = buffer.join("\n");
		transporter.sendMail({
		    from: fromAddress,
		    to: chat.settings.email,
		    subject: buffer[0],
		    text: message
		});
		chat.send("Email sent");
		console.log("email sent: \n" + message);
		buffer = [];
	}, 1*60*1000);
	
});