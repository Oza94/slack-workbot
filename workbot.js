'use strict';

var Slack   = require('slack-client');
var argv    = require('yargs').argv;
var request = require('request');
var async   = require('async');
var moment  = require('moment');
var btoa    = require('btoa');

var slack = new Slack(argv.token);
var MS_DAY = 86400000;
moment.locale('fr');

// configuration
var urlExceptions = [
  'https://drive.google.com',
  'https://docs.google.com',
  'https://github.com',
  'http://stash.rednet.io',
  'http://jira.rednet.io',
  'http://stackoverflow.com',
  'https://rednetio.slack.com'
];

var stashUrl = 'http://stash.rednet.io';
var stashProjectId = 'MEEM';
var repositories = ['api', 'auth', 'frontend', 'www'];
// end of configuration

function handleRequestError(err) {
  console.error(err.message);
}

function getPullRequestsForRepoFunc(repo) {
  return function (cb) {
    var url = stashUrl + '/rest/api/1.0/projects/' + stashProjectId + 
      '/repos/' + repo + '/pull-requests';
    var authorization = 'Basic ' + btoa(argv.jira_username + ':' + argv.jira_password);

    request.get({
      url: url,
      headers: {Authorization: authorization}
    }, function (err, res, body) {
      if (err) return handleRequestError(err);
      if (typeof body === 'string') body = JSON.parse(body);

      var pullRequests = body.values.filter(function (pr) {
        return pr.open;
      });

      cb(pullRequests);
    });
  };
}

function getOpenPullRequestsMessage(summon, cb) {
  var flatten = [];

  var funcs = repositories.map(function (repo) {
    return getPullRequestsForRepoFunc(repo);
  });

  async.series(funcs, function (results) {
    // flatten two-dim array
    flatten = flatten.concat.apply(flatten, results);
    if (!flatten.length) return cb(null);

    var fistSentence = summon ?
      'Quelqu\'un m\'a invoqué alors voici les pull request(s) ouverte(s). ' :
      'Vous vous permettez de glander sur le web maintent?? ';

    var messageArray = [
      fistSentence, 'Il reste encore ', flatten.length, ' pull request(s) ouverte(s)',
      ' sur les projets ' + repositories.join(', ') + '.\n\n'
    ];

    var prMessages = flatten.map(function (pr) {
      return ' * ' + pr.title + ' crée ' + moment(pr.createdDate).fromNow() 
        + ' (' + stashUrl + '/' + pr.link.url + ')' +'\n';
    });

    messageArray = messageArray.concat(prMessages);
    messageArray.push('\n\nHop Hop Hop! Au boulot!!! :angry:')

    cb(messageArray.join(''));
  });
}

function validateText(text) {
  if (text.indexOf('http://') !== -1 || text.indexOf('https://') !== -1) {

    var exceptionsMatched = urlExceptions.filter(function (url) {
      return text.indexOf(url) !== -1;
    });

    if (!exceptionsMatched.length) return false;
  }

  return true;
}

function isSummonSentence(text) {
  var regexp = /(peux|peut|pouvoir|pouvons).*(glander|joueur|ne\srien\sfaire)/i;

  return regexp.test(text);
}

slack.on('message', function (message) {
  if (message.type !== 'message' || !message.text) {
    return;
  }

  var summonMode = isSummonSentence(message.text);

  if (validateText(message.text) && !summonMode) {
    return console.log('message "', message.text, '" is VALID, nothing to do.');
  }

  getOpenPullRequestsMessage(summonMode,
    function (msg) {
      var channel = slack.getChannelGroupOrDMByID(message.channel);

      if (msg) {
        console.log('message "', message.text, '" is NOT VALID, sending reminder...');
        channel.send(msg);
      } else {
        console.log('message "', message.text, '" is NOT VALID but there is no pending PR, nothing to do.');
        if (summonMode) {
          channel.send('Quelqu\'un m\'a invoqué mais il n\'y a pas de pull request en attente! Bien joué et bonne détente!');
        }
      }
    });
});

slack.on('error', handleError);

function handleError(err) {
  if (err === 'invalid_auth') {
    console.error('Invalid token, go grab a valid one!')
    process.exit(1);
  }

  console.error(err);
}

slack.login();
