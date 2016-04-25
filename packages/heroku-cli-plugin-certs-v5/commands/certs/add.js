'use strict';

let co      = require('co');
let cli     = require('heroku-cli-util');

let error               = require('../../lib/error.js');
let readFile            = require('../../lib/read_file.js');
let endpoints           = require('../../lib/endpoints.js');
let ssl_doctor          = require('../../lib/ssl_doctor.js');
let display_warnings    = require('../../lib/display_warnings.js');
let certificate_details = require('../../lib/certificate_details.js');

function* getMeta(context, heroku) {
  if (context.flags.type === 'endpoint') {
    return endpoints.meta(context.app, 'ssl');
  } else if (context.flags.type === 'sni' || ! (yield endpoints.hasAddon(context.app, heroku))) {
    return endpoints.meta(context.app, 'sni');
  } else {
    error.exit(1, 'Must pass either --type with either \'endpoint\' or \'sni\'');
  }
}

function* getFiles(context) {
  let files = yield {
    crt: readFile(context.args.CRT),
    key: readFile(context.args.KEY)
  };

  let crt, key;
  if (context.flags.bypass) {
    crt = files.crt;
    key = files.key;
  } else {
    let res = JSON.parse(yield ssl_doctor('resolve-chain-and-key', [files.crt, files.key]));
    crt = res.pem;
    key = res.key;
  }

  return {crt, key};
}

function* run(context, heroku) {
  let meta = yield getMeta(context, heroku);

  let files = yield getFiles(context);

  let cert = yield cli.action(`Adding SSL certificate to ${context.app}`, {}, heroku.request({
    path: meta.path,
    method: 'POST',
    body: {certificate_chain: files.crt, private_key: files.key},
    headers: {'Accept': `application/vnd.heroku+json; version=3.${meta.variant}`}
  }));

  cli.log(`${context.app} now served by ${cert.cname}`);
  certificate_details(cert);
  display_warnings(cert);
}

module.exports = {
  topic: '_certs',
  command: 'add',
  args: [
    {name: 'CRT', optional: false},
    {name: 'KEY', optional: false},
  ],
  flags: [
    {name: 'bypass', description: 'bypass the trust chain completion step', hasValue: false},
    {name: 'type', description: 'type to create, either \'sni\' or \'endpoint\'', hasValue: true},
  ],
  description: 'Add an SSL certificate to an app.',
  needsApp: true,
  needsAuth: true,
  run: cli.command(co.wrap(run)),
};
