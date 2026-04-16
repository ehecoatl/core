'use strict';

const fs = require(`node:fs`);

function readPasswdEntries() {
  return fs.readFileSync(`/etc/passwd`, `utf8`).split(`\n`);
}

function readGroupEntries() {
  return fs.readFileSync(`/etc/group`, `utf8`).split(`\n`);
}

function resolveUserId(userName) {
  const entry = readPasswdEntries().find((line) => line.startsWith(`${userName}:`));
  if (!entry) throw new Error(`Unable to resolve uid for user "${userName}"`);
  const uid = Number(entry.split(`:`)[2]);
  if (!Number.isInteger(uid)) throw new Error(`Invalid uid for user "${userName}"`);
  return uid;
}

function resolveGroupId(groupName, fallbackUserName = null) {
  const entry = readGroupEntries().find((line) => line.startsWith(`${groupName}:`));
  if (entry) {
    const gid = Number(entry.split(`:`)[2]);
    if (Number.isInteger(gid)) return gid;
  }

  if (fallbackUserName) {
    const passwdEntry = readPasswdEntries().find((line) => line.startsWith(`${fallbackUserName}:`));
    if (passwdEntry) {
      const gid = Number(passwdEntry.split(`:`)[3]);
      if (Number.isInteger(gid)) return gid;
    }
  }

  throw new Error(`Unable to resolve gid for group "${groupName}"`);
}

module.exports = {
  resolveUserId,
  resolveGroupId
};

Object.freeze(module.exports);
