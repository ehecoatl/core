{
  "targets": [
    {
      "target_name": "ehecoatl_seccomp",
      "sources": [
        "src/seccomp-addon.c"
      ],
      "libraries": [
        "-lseccomp"
      ],
      "cflags": [
        "-std=c11"
      ]
    }
  ]
}
