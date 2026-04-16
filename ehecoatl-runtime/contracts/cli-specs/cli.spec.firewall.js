// ehecoatl-runtime/contracts/cli-specs/cli.spec.firewall.js


'use strict';

const { group } = require(`../context.js`);

module.exports = {
  ABOUT: {
    label: "Firewall CLI spec",
    description: "Firewall-focused operational commands exposed through the CLI contract",
    contractClass: "SERVICE.CLI.SPEC"
  },
  prefix: "firewall",
  groupsAllowed: [
    group.internalScope
  ],
  COMMANDS: [
    {
      command: "newtork_wan_block",
      old_command: null,
      PARAMS: [
        {
          prefix: ["on", "off"],
          optional: false,
          default: null,
          description: "Enable or remove the per-user inbound TCP filter chain for the target process owner",
          shapes: ["{username} [process-label] [input-chain]"]
        },
      ],
      ABOUT: {
        label: "WAN Network Block",
        description: "Builds deterministic INPUT and OUTPUT TCP chains for the target process owner, allowing loopback traffic and rejecting non-loopback WAN traffic for that user-owned surface"
      },
    },
    {
      command: "newtork_local_proxy",
      old_command: null,
      PARAMS: [
        {
          prefix: ["on", "off"],
          optional: false,
          default: null,
          description: "Enable or remove the per-user loopback-only allowlist for tenant internal proxy ports",
          shapes: ["{username}[:{port}[,{port}...]]"]
        },
      ],
      ABOUT: {
        label: "Local Network Single Port Open",
        description: "Restricts the target user's loopback TCP traffic to only the explicitly allowed local proxy ports, typically the tenant internal ports in the 14000+ range"
      },
    },
  ],
};
