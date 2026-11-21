'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rankAddresses, isLocalHostHeader, joinUrlFor } = require('../src/network');

const v4 = (address, internal = false) => ({ family: 'IPv4', address, internal });

test('WLAN-Adapter vor virtuellen Adaptern, Loopback und Link-Local fallen weg', () => {
  const ranked = rankAddresses({
    lo: [v4('127.0.0.1', true)],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    docker0: [v4('172.17.0.1')],
    'WLAN': [v4('192.168.178.23')],
    'Ethernet 2': [v4('169.254.10.2')],
    en5: [{ family: 'IPv6', address: 'fe80::1', internal: false }],
  });
  assert.equal(ranked[0].address, '192.168.178.23');
  assert.ok(!ranked.some((r) => r.address.startsWith('127.') || r.address.startsWith('169.254.')));
  assert.equal(ranked.at(-1).name.startsWith('VirtualBox') || ranked.at(-1).name === 'docker0', true);
});

test('Nur Aufrufe über localhost bekommen die LAN-Adresse', () => {
  assert.equal(isLocalHostHeader('localhost:3000'), true);
  assert.equal(isLocalHostHeader('127.0.0.1:3000'), true);
  assert.equal(isLocalHostHeader('[::1]:3000'), true);
  assert.equal(isLocalHostHeader('192.168.1.5:3000'), false);
  assert.equal(isLocalHostHeader('quiz.example.de'), false);
});

test('Spieler-Adresse: PUBLIC_URL gewinnt, sonst LAN, sonst eigene Adresse', () => {
  const addresses = [{ name: 'WLAN', address: '192.168.1.5' }];
  assert.equal(joinUrlFor({ publicUrl: 'https://quiz.example.de/', hostHeader: 'localhost:3000', port: 3000, addresses }), 'https://quiz.example.de');
  assert.equal(joinUrlFor({ publicUrl: '', hostHeader: 'localhost:3000', port: 3000, addresses }), 'http://192.168.1.5:3000');
  assert.equal(joinUrlFor({ publicUrl: '', hostHeader: '192.168.1.5:3000', port: 3000, addresses }), null);
  assert.equal(joinUrlFor({ publicUrl: '', hostHeader: 'localhost:3000', port: 3000, addresses: [] }), '');
});
