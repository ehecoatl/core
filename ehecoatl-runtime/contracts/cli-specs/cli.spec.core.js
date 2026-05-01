// ehecoatl-runtime/contracts/cli-specs/cli.spec.core.js


'use strict';


const { group, tenantRoot } = require(`../context.js`);

module.exports = {
  ABOUT: {
    label: `Core CLI spec`,
    description: `Supervision command surface for service lifecycle, service-level inspection, and custom login management`,
    contractClass: `SERVICE.CLI.SPEC`
  },
  prefix: `core`,
  groupsAllowed: [
    `root`,
    group.superScope
  ],
  COMMANDS: [
    {
      command: `deploy tenant`,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `target tenant environment alias to create`,
          shapes: [`@{domain}`]
        },
        {
          prefix: [`-t`, `--tenant-kit`],
          optional: false,
          default: null,
          description: `tenant kit folder or zip source to scaffold into the new tenant environment; the .zip extension is optional; missing kits fall back to customTenantKits and https://github.com/ehecoatl/tenant-kit-{kit_name}.git; top-level app_<name>/ folders are auto-deployed as embedded apps`,
          shapes: [`{kit_name}`]
        },
      ],
      AFTER_CLI: {
        description: `executed after this command, in this case for director registry refresh`,
        COMMANDS: [
          `ehecoatl core rescan tenants`
        ]
      },
      ABOUT: {
        label: `Create and register a new tenant environment`,
        description: `Creates a new tenant environment using a tenant kit; top-level app_<name>/ folders in the tenant kit are deployed as apps`
      }
    },
    {
      command: `rescan tenants`,
      PARAMS: [],
      ABOUT: {
        label: `Force immediate tenant registry rescan`,
        description: `Triggers a director rescan immediately and waits for completion`
      }
    },
    {
      command: `delete tenant`,
      old_command: null,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `target tenant environment alias to remove`,
          shapes: [
            `@{domain}`,
            `@{tenant_id}`
          ]
        }
      ],
      ABOUT: {
        label: `Delete a tenant environment`,
        description: `Removes a previously deployed tenant environment and its registered apps`
      }
    },
    {
      command: `list`,
      PARAMS: [],
      ABOUT: {
        label: `List tenants`,
        description: `Returns the tenants currently registered in the service`
      }
    },
    {
      command: `start`,
      PARAMS: [],
      ABOUT: {
        label: `Start the Ehecoatl service`,
        description: `Starts the installed systemd unit for the service`
      }
    },
    {
      command: `stop`,
      PARAMS: [],
      ABOUT: {
        label: `Stop the Ehecoatl service`,
        description: `Stops the installed systemd unit for the service`
      }
    },
    {
      command: `restart`,
      PARAMS: [],
      ABOUT: {
        label: `Restart the Ehecoatl service`,
        description: `Restarts the installed systemd unit for the service`
      }
    },
    {
      command: `status`,
      PARAMS: [],
      ABOUT: {
        label: `Inspect service status`,
        description: `Returns systemd status information for the installed service`
      }
    },
    {
      command: `log`,
      PARAMS: [],
      ABOUT: {
        label: `Inspect service logs`,
        description: `Streams the recent service logs from journalctl`
      }
    },
    {
      command: `generate login`,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `custom login username to create`,
          shapes: [`{username}`]
        },
        {
          prefix: [`--password`],
          optional: true,
          default: null,
          description: `optional password for the new login; omit to keep the account password-locked`,
          shapes: [`{password}`]
        },
        {
          prefix: [`--scope`],
          optional: false,
          default: null,
          description: `scope selector to stack on the new login; repeat this flag to add more than one scope`,
          shapes: [
            `super`,
            `@{domain}`,
            `@{tenant_id}`,
            `{appname}@{domain}`,
            `{appname}@{tenant_id}`
          ]
        }
      ],
      ABOUT: {
        label: `Create a managed human login`,
        description: `Creates a managed shell login with /home/{username}, stacked scope groups, and a scoped ~/ehecoatl workspace`
      }
    },
    {
      command: `delete login`,
      PARAMS: [
        {
          prefix: null,
          optional: false,
          default: null,
          description: `managed login username to remove`,
          shapes: [`{username}`]
        },
        {
          prefix: [`--purge-home`],
          optional: true,
          default: null,
          description: `also remove /home/{username} when deleting the login`,
          shapes: null
        }
      ],
      ABOUT: {
        label: `Delete a managed human login`,
        description: `Deletes a managed shell login previously created by the core CLI`
      }
    }
  ]
};
