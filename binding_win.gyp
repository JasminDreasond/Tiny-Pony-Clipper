{
  "targets": [
    {
      "target_name": "uinput_gamepad",
      "libraries": [
        "../deps/ViGEmClient/lib/setupapi.lib",
        "../deps/ViGEmClient/lib/ViGEmClient.lib"
      ],
      "sources": [ "src/native/uinput_gamepad.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "deps/ViGEmClient/include"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}