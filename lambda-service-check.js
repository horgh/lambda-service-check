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

// Settings begin here.

// Hostname to monitor. It should have A record(s).
const HOSTNAME = 'irc.summercat.com';

// Port to connect to on each IP.
const PORT = 7000;

// Check validity of TLS certificates or not.
const CHECK_CERTIFICATES = false;

// Timeout on connections (connect, idle time) (milliseconds)
const TIMEOUT = 10000;

// Greeting to look for.
const GREETING = 'NOTICE AUTH';

// Whether to log verbosely (such as successes).
const VERBOSE = true;

// End settings section.

const dns = require('dns');
const net = require('net');
const tls = require('tls');

// Track IPs we received the correct greeting from.
const IPS_WITH_GREETING = [];

// Track hosts/IPs we reported errors on. This is so we do so only once.
const HOSTS_REPORTED = [];

// Report that the service is down.
//
// id may be a hostname or an IP. why is a reason to include.
const service_is_down = function(id, why) {
	for (var i = 0; i < HOSTS_REPORTED.length; i++) {
		if (HOSTS_REPORTED[i] === id) {
			return;
		}
	}

	HOSTS_REPORTED.push(id);

	console.log(id + ": " + why.trim());
};

// Connect to the IP and check its liveliness.
const check_ip = function(ip, port, check_certificates, timeout, greeting,
	verbose) {
	const client = net.createConnection({
		'host': ip,
		'port': port,
		'rejectUnauthorized': check_certificates,
	});

	client.setTimeout(timeout);

	client.on('close', function() {
		// Report it's down unless we saw the greeting.
		const index = IPS_WITH_GREETING.findIndex(function(e) {
			return e === ip;
		});

		if (index === -1) {
			service_is_down(ip, "greeting not found");
		}
	});

	client.on('connect', function() {
		connect_tls_and_get_greeting(ip, client, check_certificates, greeting,
			verbose);
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

// Setup a TLS session on the given socket. Try to retrieve the greeting.
const connect_tls_and_get_greeting = function(ip, socket, check_certificates,
	greeting, verbose) {
	const client = tls.connect({
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

		service_is_down(ip, "unexpected greeting");
		socket.end();
	});

	client.on('error', function(err) {
		service_is_down(ip, "TLS error: " + err.message);
		socket.end();
	});
};

// Run checks on the configured hostname.
const check_host = function(hostname, port, check_certificates, timeout,
	greeting, verbose) {
	dns.lookup(hostname,
	 	{
			'family': 4,
			'all':    true
		},
	 	function(err, ips, family) {
			if (err) {
				service_is_down(hostname, "DNS error: " + err.code);
				return;
			}

			// ips is an array of objects, each with property address and family.

			for (var i = 0; i < ips.length; i++) {
				const ip = ips[i].address;
				check_ip(ip, port, check_certificates, timeout, greeting, verbose);
			}
		}
	);
};

check_host(HOSTNAME, PORT, CHECK_CERTIFICATES, TIMEOUT, GREETING, VERBOSE);
