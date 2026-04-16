#include <node_api.h>

#include <errno.h>
#include <linux/capability.h>
#include <linux/sched.h>
#include <seccomp.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>

static bool g_filter_loaded = false;

static napi_value throw_seccomp_error(napi_env env, const char* prefix, int rc) {
  char message[256];
  const int error_code = rc < 0 ? -rc : errno;
  const char* reason = strerror(error_code);
  snprintf(message, sizeof(message), "%s: %s", prefix, reason != NULL ? reason : "unknown error");
  napi_throw_error(env, NULL, message);
  return NULL;
}

static int add_rule_if_supported(scmp_filter_ctx ctx, const char* syscall_name) {
  const int syscall_number = seccomp_syscall_resolve_name(syscall_name);
  if (syscall_number == __NR_SCMP_ERROR) {
    return 0;
  }

  return seccomp_rule_add(ctx, SCMP_ACT_ERRNO(EPERM), syscall_number, 0);
}

static int add_clone_process_only_rule_if_supported(scmp_filter_ctx ctx) {
  const int syscall_number = seccomp_syscall_resolve_name("clone");
  if (syscall_number == __NR_SCMP_ERROR) {
    return 0;
  }

  /*
   * Thread creation keeps CLONE_THREAD set, while process-like clone calls do not.
   * We only deny clone() when it is used without CLONE_THREAD so libuv/worker threads
   * continue to function under the filter.
   *
   * clone3() is intentionally left unrestricted here because its first argument is a
   * pointer to struct clone_args; classic seccomp rules cannot inspect the pointed
   * flags field to distinguish thread creation from process creation safely.
   */
  return seccomp_rule_add(
    ctx,
    SCMP_ACT_ERRNO(EPERM),
    syscall_number,
    1,
    SCMP_A0(SCMP_CMP_MASKED_EQ, CLONE_THREAD, 0)
  );
}

static napi_value apply_no_spawn_filter(napi_env env, napi_callback_info info) {
  napi_value result = NULL;
  scmp_filter_ctx ctx = NULL;
  const char* blocked_syscalls[] = {
    "fork",
    "vfork",
    "execve",
    "execveat"
  };

  if (g_filter_loaded) {
    napi_get_boolean(env, true, &result);
    return result;
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    return throw_seccomp_error(env, "Failed to enable no_new_privs before seccomp load", errno);
  }

  ctx = seccomp_init(SCMP_ACT_ALLOW);
  if (ctx == NULL) {
    return throw_seccomp_error(env, "Failed to initialize seccomp filter", errno);
  }

  for (size_t index = 0; index < sizeof(blocked_syscalls) / sizeof(blocked_syscalls[0]); index += 1) {
    const int rc = add_rule_if_supported(ctx, blocked_syscalls[index]);
    if (rc != 0) {
      seccomp_release(ctx);
      return throw_seccomp_error(env, "Failed to add blocked seccomp syscall rule", rc);
    }
  }

  {
    const int rc = add_clone_process_only_rule_if_supported(ctx);
    if (rc != 0) {
      seccomp_release(ctx);
      return throw_seccomp_error(env, "Failed to add blocked clone seccomp syscall rule", rc);
    }
  }

  if (seccomp_load(ctx) != 0) {
    seccomp_release(ctx);
    return throw_seccomp_error(env, "Failed to load seccomp filter", errno);
  }

  seccomp_release(ctx);
  g_filter_loaded = true;
  napi_get_boolean(env, true, &result);
  return result;
}

static int drop_all_capabilities_now(void) {
  struct __user_cap_header_struct header;
  struct __user_cap_data_struct data[2];

  memset(&header, 0, sizeof(header));
  memset(&data, 0, sizeof(data));

  header.version = _LINUX_CAPABILITY_VERSION_3;
  header.pid = 0;

  if (prctl(PR_SET_KEEPCAPS, 0, 0, 0, 0) != 0) {
    return -errno;
  }

  if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0) {
    return -errno;
  }

  if (syscall(SYS_capset, &header, &data) != 0) {
    return -errno;
  }

  return 0;
}

static napi_value drop_all_capabilities(napi_env env, napi_callback_info info) {
  napi_value result = NULL;
  const int rc = drop_all_capabilities_now();
  if (rc != 0) {
    return throw_seccomp_error(env, "Failed to drop process capabilities", rc);
  }

  napi_get_boolean(env, true, &result);
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value function = NULL;
  napi_status status = napi_create_function(
    env,
    "applyNoSpawnFilter",
    NAPI_AUTO_LENGTH,
    apply_no_spawn_filter,
    NULL,
    &function
  );
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create seccomp addon export");
    return NULL;
  }

  status = napi_set_named_property(env, exports, "applyNoSpawnFilter", function);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to export seccomp addon function");
    return NULL;
  }

  function = NULL;
  status = napi_create_function(
    env,
    "dropAllCapabilities",
    NAPI_AUTO_LENGTH,
    drop_all_capabilities,
    NULL,
    &function
  );
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create capability drop export");
    return NULL;
  }

  status = napi_set_named_property(env, exports, "dropAllCapabilities", function);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to export capability drop function");
    return NULL;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
