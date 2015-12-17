var config = require("./config.json");

var token = config.botToken,
    connectionString = config.connectionString,
    statDetailsLink = config.statDetailsLink;

var Bot = require("node-telegram-bot-api"),
    bot = new Bot(token, { polling: true }),
    Massive = require("massive"),
    db = Massive.connectSync({ connectionString: connectionString }),
    SimpleBot = require('simple-telegram-bot'),
    simpleBot = new SimpleBot(bot, db.users),
    sitestats = require('./sidearm-sitestats.js');

var agent = require("webkit-devtools-agent");
agent.start({
    port:9999,
    bind_to:'0.0.0.0'
});

var fire = "\ud83d\udd25";
var snowflake = "\u2744\ufe0f";

simpleBot.on("chatstarted", function(chat){

    console.log("Chat started");

    function sendHelp(){
        chat.send([
                "You can send messages like:",
                "'/top 10' to see the top 10 active user sites",
                "'/threshold 100' to set your alert threshold",
                "'/above 100' to show all sites with 100 active users or more",
                "'/search medaille' to search by hostname",
                "'/stop' to stop receiving alerts",
                "'/start' to start receiving alerts",
                "'/help' to see this text"
            ].join("\n"));
    }

    function unicodeEscape(str) {
      for (var result = '', index = 0, charCode; !isNaN(charCode = str.charCodeAt(index++));) {
        result += '\\u' + ('0000' + charCode.toString(16)).slice(-4);
      }
      return result;
    }

    chat.on("text", function(e){
        var text = e.text;
        console.log(unicodeEscape(text));
    });

    chat.on("command:start", function(e) {
        chat.setting("active", true);
        simpleBot.broadcast(e.message.chat.first_name + " " + e.message.chat.last_name + " started");
    });

    chat.on("command:stop", function(e){
        chat.setting("active", false);
        simpleBot.broadcast(e.message.chat.first_name + " " + e.message.chat.last_name + " stopped");
    });

    chat.on("command:broadcast", function(e) { simpleBot.broadcast(e.text); });
    
    chat.on("command:help", sendHelp);

    chat.on("command:check", checkActive);

    chat.on("command:threshold", function(e) {
        return e.prompt("What would you like your *new* alert threshold to be?", {
                reply_markup: {
                    keyboard: [
                        ["1000", "750", "500"],
                        ["400", "300", "250"],
                        ["200", "100", "50"],
                    ],
                    one_time_keyboard: true
                }
            })
            .then(function(value){
                return chat.setting("threshold", value)
                    .done(function(value){
                        chat.send("Alert threshold set to " + value + " active users", {
                            reply_markup: {
                                hide_keyboard: true
                            }
                        });
                    });
            });
    });

    chat.on("command:top", function(e){
        return e.prompt("How many?", {
                reply_markup: {
                    keyboard: [
                        [ "100", "50", "30"],
                        [ "20",  "10", "5"]
                    ],
                    one_time_keyboard: true
                }
            })
            .then(function(numberOfResults){
                return sitestats.getActiveUsers()
                    .then(function(lastReadings){
                        var topNReadings = lastReadings.slice(0, parseInt(numberOfResults, 10));
                        chat.send(readingsToString(topNReadings, "Top " + numberOfResults + ":"), {
                            disable_web_page_preview:true,
                            reply_markup: {
                                hide_keyboard: true
                            }
                        });
                    })
            });
    });

    chat.on("command:above", function(e){
        return e.prompt("How many active?")
            .then(function(above){
                var aboveValue = parseInt(above, 10);
                return sitestats.getActiveUsers()
                    .then(function(lastReadings){
                        var topNReadings = lastReadings.filter(function(target){
                            return target.last > aboveValue;
                        });
                        chat.send(readingsToString(topNReadings, "At least " + aboveValue + ":"), {
                            disable_web_page_preview:true
                        });
                    })
            });
    });

    chat.on("command:search", function(e) {
        return e.prompt("What would you like to search for?")
            .then(function(query){
                return sitestats.getActiveUsers()
                    .then(function(lastReadings){
                        return lastReadings.filter(function(target) {
                            return target.target.toLowerCase().indexOf(query.toLowerCase()) > -1;
                        });
                    })
                    .then(function(filteredReadings){
                        chat.send(readingsToString(filteredReadings, "Results:"), {
                            disable_web_page_preview: true
                        });
                    });
            });
    });

    chat.on("command:settings", function(){
        chat.send("Your settings: \n" + Object.keys(chat.settings).map(function(k){
            return k + ": " + chat.settings[k];
        }).join("\n"));
    })
});


var previousReadings = {};
function checkActive(){
    return sitestats.getActiveUsers()
        .then(function(lastReadings) {
            return simpleBot.listAllChats()
                .then(function(users){
                    users.forEach(function(user){
                        user.settings = user.settings || {};
                        var threshold = user.settings.threshold || 300;
                        var userActive = user.settings.active !== false;

                        if (!userActive) {
                            console.log(user.first_name + " " + user.last_name + " not active");
                            return;
                        }

                        var newlyHighReadings = [],
                            newlyLowReadings = [],
                            highReadings = [];

                        lastReadings.forEach(function(target) {
                            var previousReadingForTarget = (previousReadings[target.target] || 0);

                            var isAboveThreshold = target.last > threshold;
                            var wasAboveThreshold = previousReadingForTarget > threshold;

                            if (isAboveThreshold) {
                                if (wasAboveThreshold){
                                    console.log(target.target + " is and was above threshold");
                                    
                                    var numberOfHundredsAboveThreshold = Math.floor((target.last - threshold)/100);
                                    var numberOfHundredsPreviouslyAboveThreshold = Math.floor((previousReadingForTarget - threshold)/100);
                                    
                                    if (numberOfHundredsAboveThreshold > numberOfHundredsPreviouslyAboveThreshold){
                                        newlyHighReadings.push(target);
                                    }
                                } else {
                                    newlyHighReadings.push(target);
                                }

                                highReadings.push(target);
                            }
                            else {
                                if (wasAboveThreshold) {
                                    console.log(target.target + " was above threshold but isn't anymore");
                                    newlyLowReadings.push(target);
                                }
                            }
                        });

                        if (newlyHighReadings.length > 0 || newlyLowReadings.length > 0) {
                            var messageParts = [];

                            if (highReadings.length > 0) {
                                messageParts.push(readingsToString(highReadings, null, fire, false));
                            }
                            if (newlyLowReadings.length > 0) {
                                messageParts.push(readingsToString(newlyLowReadings, null, snowflake, false));
                            }

                            messageParts.push(statDetailsLink);

                            var message = messageParts.join("\n");

                            simpleBot.getOrCreateChatById(user.id).send(message, {
                                disable_web_page_preview: true
                            });
                        }
                    });
                    
                    previousReadings = lastReadings.reduce(function(accum, target){
                        accum[target.target] = target.last;
                        return accum;
                    }, {});
                });
        });
}

function readingsToString(highReadings, title, prefix, includeLink){
    prefix = prefix ? prefix + " " : "";
    var titles = title ? [title] : [];
    includeLink = includeLink !== false;
    var links = includeLink ? [statDetailsLink] : [];
    
    var message = titles
        .concat(
            highReadings
                .map(function(target){
                    return prefix + target.target.replace(/_/g, ".") + ": " + Math.ceil(target.last) + " active users";
                })
        )
        .concat(
            links
        )
        .join("\n");

    return message;
}

checkActive();
setInterval(checkActive, 1*60*1000);
