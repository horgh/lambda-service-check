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

/* jshint node: true */
/* jshint esversion: 6 */

"use strict";

// Hostname to monitor. It should have A record(s).
const hostname = 'irc.summercat.com';

// Port to connect to on each IP.
const port = 7000;

// Check validity of TLS certificates or not.
const check_certificates = false;

// Timeout on connections (connect, idle time) (milliseconds)
const timeout = 10000;

// Greeting to look for.
const greeting = 'NOTICE AUTH';

// Whether to log verbosely (such as successes).
const verbose = true;

// End settings section.

const dns = require('dns');
const net = require('net');
const tls = require('tls');

// Track hosts we report errors on. This is so we do so only once.
const hosts_reported = [];

// Report that the service is down.
//
// id may be a hostname or an IP. why is a reason to include.
const service_is_down = function(id, why) {
	for (var i = 0; i < hosts_reported.length; i++) {
		if (hosts_reported[i] === id) {
			return;
		}
	}

	hosts_reported.push(id);

	console.log(id + ": " + why);
};

// Connect to the IP and check its liveliness.
const check_ip = function(ip) {
	const client = net.createConnection({
		'host': ip,
		'port': port,
		'rejectUnauthorized': check_certificates,
	});

	client.setTimeout(timeout);

	var got_greeting = false;
	var reported_error = false;

	client.on('close', function() {
		if (!got_greeting) {
			service_is_down(ip, "greeting not found");
		}
	});

	client.on('connect', function() {
		const sec_client = tls.connect({
			'socket': client,
			'rejectUnauthorized': check_certificates
	 	});

		var buf = new Buffer(0);

		sec_client.on('data', function(data) {
			if (buf.length >= greeting.length) {
				return;
			}

			buf = Buffer.concat([buf, data]);
			if (buf.length < greeting.length) {
				return;
			}

			if (buf.toString().substr(0, greeting.length) === greeting) {
				got_greeting = true;
				if (verbose) {
					console.log(ip + ": received greeting");
				}
				client.end();
				return;
			}

			service_is_down(ip, "unexpected greeting");
			client.end();
		});
	});

	client.on('error', function(err) {
		service_is_down(ip, "error: " + err.message);
		client.destroy();
	});

	client.on('timeout', function() {
		service_is_down(ip, "timeout");
		client.destroy();
	});
};

// Run checks on the configured hostname.
const check_host = function() {
	dns.lookup(hostname,
	 	{
			'family': 4,
			'all': true
		},
	 	function(err, ips, family) {
			if (err) {
				service_is_down(hostname, "DNS error: " + err.code);
				return;
			}

			// ips is an array of objects, each with property address and family.
			for (var i = 0; i < ips.length; i++) {
				const ip = ips[i].address;
				check_ip(ip);
			}
		}
	);
};

check_host();
