//
// This is a lambda function to monitor liveliness of services.
//
// It behaves this way:
// - Given a hostname, look up its A records.
// - For every IP:
//   - Connect to each IP on a given port (TCP).
//   - Start a TLS connection.
//   - Check we see an expected banner/greeting.
// - If any of these steps fail, report there is a problem with the IP.
//
// I report problems using Amazon SNS.
//
// My use case: I have a small IRC network. I want to know if one or more of
// the servers in its DNS round robin become inaccessible. At one point a
// server was up and apparently fine, but it was not able to accept
// connections. This program is to monitor for such cases.
//
// Tests:
// - Self signed certificate and certificate checks enabled.
// - Open port without TLS.
// - Timeout.
// - Port open but nothing running.
//

/* jshint node: true */
/* jshint esversion: 6 */

"use strict";

const dns = require('dns');
const net = require('net');
const tls = require('tls');
const AWS = require('aws-sdk');
const config = require('./config.js');

AWS.config.region = config.aws_region;

// Track IPs we received the correct greeting from.
const IPS_WITH_GREETING = [];

// Track hosts/IPs we reported errors on. This is so we do so only once.
const HOSTS_REPORTED = [];

// Report that the service is down.
//
// id may be a hostname or an IP. why is a reason to include.
const service_is_down = function(sns_arn, id, why) {
	for (var i = 0; i < HOSTS_REPORTED.length; i++) {
		if (HOSTS_REPORTED[i] === id) {
			return;
		}
	}

	HOSTS_REPORTED.push(id);

	const msg = id + ": " + why.trim();

	const sns = new AWS.SNS();
	sns.publish(
		{
			'Message':  msg,
			'TopicArn': sns_arn
		},
		function(err, data) {
			if (err) {
				console.log(err);
				return;
			}
		}
	);

	console.log(msg);
};

// Connect to the IP and check its liveliness.
const check_ip = function(
	hostname,
	ip,
	port,
	check_certificates,
	timeout,
	greeting,
	verbose,
	sns_arn
) {
	const client = net.createConnection({
		'host': ip,
		'port': port
	});

	client.setTimeout(timeout);

	client.on('close', function() {
		// Report it's down unless we saw the greeting.
		const index = IPS_WITH_GREETING.findIndex(function(e) {
			return e === ip;
		});

		if (index === -1) {
			service_is_down(sns_arn, ip, "greeting not found");
		}
	});

	client.on('connect', function() {
		connect_tls_and_get_greeting(hostname, ip, client, check_certificates,
			greeting, verbose, sns_arn);
	});

	client.on('error', function(err) {
		service_is_down(sns_arn, ip, "error: " + err.message);
		client.destroy();
	});

	client.on('timeout', function() {
		service_is_down(sns_arn, ip, "timeout");
		client.destroy();
	});
};

// Setup a TLS session on the given socket. Try to retrieve the greeting.
const connect_tls_and_get_greeting = function(
	hostname,
	ip,
	socket,
	check_certificates,
	greeting,
	verbose,
	sns_arn
) {
	const client = tls.connect({
		host:                 hostname,
		'socket':             socket,
		'rejectUnauthorized': check_certificates
	});

	var buf = new Buffer(0);

	client.on('data', function(data) {
		// If we've seen enough to know whether greeting is present then there is
		// nothing more to do.
		if (buf.length >= greeting.length) {
			return;
		}

		buf = Buffer.concat([buf, data]);
		if (buf.length < greeting.length) {
			return;
		}

		if (buf.toString().substr(0, greeting.length) === greeting) {
			IPS_WITH_GREETING.push(ip);

			if (verbose) {
				console.log(ip + ": received greeting");
			}

			client.end();
			return;
		}

		service_is_down(sns_arn, ip, "unexpected greeting");
		socket.end();
	});

	client.on('error', function(err) {
		service_is_down(sns_arn, ip, "TLS error: " + err.message);
		socket.end();
	});
};

// Run checks on the configured hostname.
const check_host = function(
	hostname,
	port,
	check_certificates,
	timeout,
	greeting,
	verbose,
	sns_arn,
	callback
) {
	var checked_ips = [];
	dns.lookup(hostname,
	 	{
			'family': 4,
			'all':    true
		},
	 	function(err, ips, family) {
			if (err) {
				service_is_down(sns_arn, hostname, "DNS error: " + err.code);
				return;
			}

			// ips is an array of objects, each with property address and family.

			for (var i = 0; i < ips.length; i++) {
				const ip = ips[i].address;
				check_ip(hostname, ip, port, check_certificates, timeout, greeting,
					verbose, sns_arn);
				checked_ips.push(ip);
			}

			callback(null, {
				checked_ips: checked_ips,
				hostname:    config.hostname,
				port:        config.port
			});
		}
	);
};

// Lambda handler function.
exports.handler = function(event, context, callback) {
	check_host(config.hostname, config.port, config.check_certificates,
		config.timeout, config.greeting, config.verbose, config.sns_arn,
		callback);
};

if (config.run_locally) {
	check_host(config.hostname, config.port, config.check_certificates,
		config.timeout, config.greeting, config.verbose, config.sns_arn,
		function(err, result) {
			console.log(JSON.stringify(result));
		});
}
